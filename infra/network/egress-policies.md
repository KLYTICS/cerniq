# CERNIQ — Network egress policies

> Direction: **outbound** — CERNIQ API / worker → external services.
> See [`ingress.md`](./ingress.md) for inbound.

## Summary

CERNIQ reaches a small, named set of external services in production. The
list is short on purpose: every new outbound destination is a new
supply-chain risk. Webhooks are the one exception — those URLs are
**user-controlled**, which makes them an SSRF risk by default and the
single most important egress concern in this document.

## Allowed destinations

| Destination                 | Purpose                                    | Endpoint                                   | Trust         |
| --------------------------- | ------------------------------------------ | ------------------------------------------ | ------------- |
| Postgres (Railway internal) | Application data (incl. audit chain)       | Railway private DNS, port 5432             | Trusted       |
| Redis (Railway internal)    | Cache + BullMQ queues                      | Railway private DNS, port 6379             | Trusted       |
| Stripe                      | Billing + Stripe webhooks (dual-direction) | `api.stripe.com:443`                       | Trusted       |
| Sentry                      | Error + performance telemetry              | `sentry.io:443` and project subdomain      | Trusted       |
| OpenTelemetry collector     | Traces + metrics                           | OTLP/HTTP, operator-configured endpoint    | Trusted       |
| Customer webhooks           | Event delivery                             | **operator-supplied URL per subscription** | **Untrusted** |

Anything not on this list should be denied or alerted on. In Phase 3, an
outbound proxy + DNS pinning enforces that programmatically; in v1 it's
audit-after-the-fact.

## The SSRF threat (webhooks)

Webhook URLs are stored on the customer's `WebhookSubscription` rows in
Postgres. The subscriber controls the URL. Without explicit defenses,
the BullMQ delivery worker
([`../../apps/api/src/modules/webhooks/webhook.delivery.ts`](../../apps/api/src/modules/webhooks/webhook.delivery.ts))
is a confused deputy that will happily make requests to:

- `http://169.254.169.254/...` — cloud metadata service.
- `http://10.0.0.1/...`, `http://127.0.0.1:5432/...`, `http://localhost:6379/...` — internal services on the same VPC / box.
- `http://[::1]/...`, `http://[fc00::1]/...` — IPv6 link-local / ULA.
- `http://api.stripe.com/...` — pretending to be a trusted destination, in case any internal logic compares URLs by string.

Any one of these is enough to read CERNIQ internals or pivot.

### Required mitigations (defense in depth)

1. **At subscribe time** — `webhooks.service.ts` validates the URL on
   `POST /v1/webhooks`:
   - Scheme must be `https://` (no `http`, no `ftp`, no `file`, no `gopher`).
   - Host must resolve only to public addresses (reject any A / AAAA in
     the IETF "special-use" ranges below).
   - Host MUST NOT be an IP literal in the same ranges.
   - Reject if the URL is longer than a sensible cap (e.g. 2048 chars).
2. **At delivery time** — `webhook.delivery.ts` revalidates the URL
   (DNS-pinning the resolved address before connect, or using an HTTP
   client that exposes a "connect IP" hook). This is the
   **TOCTOU defense**: a hostname can resolve to public at subscribe
   time and to private at delivery time, so we re-resolve and re-check.
3. **Per-call timeout** — already 5 s per attempt. Keep it.
4. **Response body cap** — already 2 KiB; do not increase.
5. **HMAC signature** — `X-CERNIQ-Signature: t=<ts>,v1=<hmac-sha256>`.
   This protects the receiver, not us, but completes the model.

### Disallowed IP ranges (refuse at subscribe AND at delivery)

| CIDR              | Why                                             |
| ----------------- | ----------------------------------------------- |
| `0.0.0.0/8`       | "this network"                                  |
| `10.0.0.0/8`      | RFC 1918 private                                |
| `100.64.0.0/10`   | CGNAT                                           |
| `127.0.0.0/8`     | loopback                                        |
| `169.254.0.0/16`  | link-local incl. cloud metadata service         |
| `172.16.0.0/12`   | RFC 1918 private                                |
| `192.0.0.0/24`    | IETF assignments                                |
| `192.0.2.0/24`    | TEST-NET-1                                      |
| `192.168.0.0/16`  | RFC 1918 private                                |
| `198.18.0.0/15`   | benchmarking                                    |
| `198.51.100.0/24` | TEST-NET-2                                      |
| `203.0.113.0/24`  | TEST-NET-3                                      |
| `224.0.0.0/4`     | multicast                                       |
| `240.0.0.0/4`     | reserved                                        |
| `::1/128`         | IPv6 loopback                                   |
| `fc00::/7`        | IPv6 unique-local                               |
| `fe80::/10`       | IPv6 link-local                                 |
| `::ffff:0:0/96`   | IPv4-mapped IPv6 (close the IPv4-via-IPv6 hole) |

> **Status of the SSRF check in code today**: not yet implemented. The
> webhook delivery worker
> ([`../../apps/api/src/modules/webhooks/webhook.delivery.ts`](../../apps/api/src/modules/webhooks/webhook.delivery.ts))
> sends to whatever URL the row holds. The validating helper should live
> at `apps/api/src/common/security/url-allowlist.ts` (does not exist
> yet). Tracked as **TODO M-008-ssrf** in the next session pickup of
> [`../../docs/SESSION_HANDOFF.md`](../../docs/SESSION_HANDOFF.md).
> Until then, customer-controlled webhook URLs are an active SSRF risk.
> Treat this as a **release blocker** before opening webhooks to
> non-internal customers.

### Even more paranoid (Phase 3)

- All outbound HTTP via a forward proxy (e.g. internal Squid + an
  allowlist for trusted destinations); the proxy refuses to connect to
  private IPs unconditionally.
- DNS-over-HTTPS to a hardened resolver, no fallback.
- The proxy logs every connect; observability collects them as the
  authoritative egress audit feed.

## Allowed destinations — concrete

The application-layer code that touches each destination already exists
or is scheduled:

- Postgres / Redis: configured via `DATABASE_URL` / `REDIS_URL` in
  `apps/api/src/config/`. Internal Railway DNS — never reaches the
  public internet.
- Stripe: `apps/api/src/modules/billing/` (M-011 scaffolded). HTTPS
  client should pin to `api.stripe.com`; do not allow runtime override.
- Sentry / OTel: configured via `SENTRY_DSN` and OTLP env variables.
  Both are fixed at deploy time.

## Cross-references

- [`../../docs/SECURITY.md`](../../docs/SECURITY.md) § 2 (trust
  boundaries) and § 9 (threat scenarios).
- [`../../docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md) — webhook
  SSRF will become a new row when the mitigation lands.
- [`../../apps/api/src/modules/webhooks/`](../../apps/api/src/modules/webhooks/)
  — where the SSRF check belongs.
