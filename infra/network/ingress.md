# AEGIS — Network ingress

> Direction: **inbound** — public internet → Cloudflare → Railway edge → API.
> See [`egress-policies.md`](./egress-policies.md) for outbound.

## Topology

```
   Public internet
        │
        │  TLS 1.3 / 1.2 (Cloudflare default cipher suite)
        ▼
   Cloudflare (WAF + DDoS + rate limit)
        │
        │  HTTPS, signed Cloudflare → origin via mTLS (Phase 3)
        ▼
   Railway edge (proxies to service container)
        │
        │  HTTP, internal
        ▼
   AEGIS API (NestJS / Express, port 4000)
        │
        ├── Postgres   (Railway internal DNS only, not public)
        └── Redis      (Railway internal DNS only, not public)
```

## Trusted proxies

- **Cloudflare** terminates TLS for the public hostname and forwards to
  Railway. Cloudflare is the boundary at which `X-Forwarded-For` is set
  to the real client IP.
- **Railway edge** appends to `X-Forwarded-For`. The API container is the
  third hop.

`apps/api/src/main.ts` must call `app.set('trust proxy', N)` so Express
trusts exactly the proxies above and not arbitrary hops. **N = 2** in
production (Cloudflare + Railway edge). Misconfiguring this is how rate
limits and audit IPs get spoofed — keep this in step with the deployment
topology and re-check after any platform change.

> If the deployment ever moves off Cloudflare (e.g. direct-to-Railway
> for a private region), drop `N` accordingly. The
> [`../../docs/DR_RUNBOOK.md`](../../docs/DR_RUNBOOK.md) "region outage"
> playbook calls this out.

## TLS

- **Versions**: TLS 1.3 preferred, 1.2 minimum. TLS 1.0/1.1 are
  disabled at the Cloudflare zone level.
- **HSTS**: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
  Helmet is configured globally in `apps/api/src/main.ts`; Cloudflare
  adds a second copy of HSTS at the edge (defense in depth).
- **Certificate authority**: Cloudflare Universal SSL in v1.

## Authentication at the edge

- Every API request must carry `X-AEGIS-API-Key` (full) or
  `X-AEGIS-Verify-Key` (verify-only) **except** the routes listed in
  [`../../docs/SECURITY.md`](../../docs/SECURITY.md) § 2 (health, root,
  docs, agent status, `.well-known/*`).
- The `ApiKeyGuard` populates `req.principal` and runs before any
  controller handler.

## Rate limiting

Two layers, both already documented in
[`../../docs/SECURITY.md`](../../docs/SECURITY.md) § 7:

| Layer            | Rule                                                            | Where enforced                                |
|------------------|-----------------------------------------------------------------|-----------------------------------------------|
| Cloudflare WAF   | 10000 req/min per IP, hard cap (credential-stuffing prevention) | Cloudflare zone rule — operator wires.        |
| API throttler    | 1000 verify/min per API key, 120/min for non-verify endpoints   | `@nestjs/throttler` at the controller layer.  |

For `/v1/verify` specifically, the operator-recommended Cloudflare WAF rule:

> Path matches `/v1/verify` AND request method is `POST` →
> rate limit at **1000 rps burst, 50 rps sustained per source IP**, with
> a 10-second block on breach.

Operator wires this in the Cloudflare dashboard or via the Cloudflare
API. We don't commit a Cloudflare-Terraform module yet — that arrives in
Phase 3 alongside `workers/cf-verify/`.

## Block patterns

Cloudflare WAF custom rules — block requests where:

- URI ends with `.git`, `.env`, `.pem`, `.key`, `.swp`, `.bak`, `.sql`.
- URI contains `/.git/`, `/.env`, `/.aws/`, `/.ssh/`.
- User-Agent matches well-known scanner fingerprints (Cloudflare's
  managed bot list covers most of these).

## What goes wrong if this is misconfigured

| Misconfig                                | Symptom                                      | Threat-model row                  |
|------------------------------------------|----------------------------------------------|-----------------------------------|
| `trust proxy` value too high             | Spoofable client IP in audit logs + ratelimit | Adjacent to T1 (token theft)      |
| HSTS missing                             | Downgrade attack window during cert rotation | T2 (MitM)                         |
| Cloudflare WAF disabled                  | DDoS reaches origin                          | T4 ([`../../docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md))           |
| API key guard bypass                     | Cross-tenant data exposure                   | T7 + invariant #5 (`CLAUDE.md`)   |
