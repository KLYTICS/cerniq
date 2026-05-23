# infra/cloudflare — Phase 3 edge verify

Phase 1 deploys nothing here. This directory holds the deployment skeleton
for the **Phase 3** Cloudflare Workers cutover of `/v1/verify`. The actual
worker source is owned by the peer Claude session at `workers/cf-verify/`
— do not duplicate code here.

The plan recap and KV / Durable Object choices are in
`docs/ARCHITECTURE.md` § 2 and § 4. This README is the operator runbook.

---

## Files

| File                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `wrangler.template.toml` | Skeleton wrangler config — name, routes, KV bindings, env vars. NO secrets. |

---

## Phase 3 entry checklist

Do not start the cutover until ALL of these are green:

1. **Verify hot path is framework-free.** `verify.algorithm.ts` has zero
   `@nestjs/*`, `@prisma/client`, or `bullmq` imports. CI enforces this
   with a lint rule (M-005 acceptance criterion).
2. **Origin p99 verify latency is measured for 7 days straight.** The
   Grafana dashboard at
   `infra/observability/grafana-dashboards/cerniq-verify-latency.json`
   gives us this number. Without a baseline, we can't tell whether the
   edge cut over actually helped.
3. **Cache hit rate at origin Redis is > 90 % for `agent:` and `policy:`
   keys** for the same 7-day window. If it isn't, the edge KV cache will
   miss at the same rate and you'll just be moving the latency spike,
   not removing it.
4. **Operator approval on Workers Paid plan ($5/mo)** — required for KV
   beyond the free tier and for Durable Objects.

---

## Bootstrap

```sh
# From repo root, after `wrangler login`:
cd workers/cf-verify
cp ../../infra/cloudflare/wrangler.template.toml ./wrangler.toml

# Create the KV namespaces — output the ids and paste them into wrangler.toml.
wrangler kv:namespace create TRUST_SCORE_CACHE
wrangler kv:namespace create TRUST_SCORE_CACHE --preview
wrangler kv:namespace create POLICY_CACHE
wrangler kv:namespace create POLICY_CACHE --preview

# Push the public key (the worker only verifies — NEVER deploy a private key here):
JWT_PUB=$(railway variables get --service cerniq-api JWT_ED25519_PUBLIC_KEY_B64)
echo "$JWT_PUB" | wrangler secret put JWT_ED25519_PUBLIC_KEY_B64

# Generate + push the origin fallback bearer token:
openssl rand -hex 32 | tee /tmp/origin-token | wrangler secret put ORIGIN_FALLBACK_TOKEN
# Then paste /tmp/origin-token into the API service's env var
# `EDGE_FALLBACK_TOKEN` so the origin can authenticate the worker's
# fallback requests. Shred the file after.

# Deploy
wrangler deploy
```

---

## Verify deployment

After the worker shows up in `wrangler deployments list`:

```sh
EDGE="https://cerniq.<your-domain>"

# 1. The worker is on a route — `cf-ray` header confirms Cloudflare handled it
curl -sI "$EDGE/v1/verify" | grep -i "cf-ray\|server: cloudflare"
# Failure: route pattern in wrangler.toml does not match the request hostname.
# Fix: re-check `pattern` and `zone_name` and that DNS is proxied (orange cloud).

# 2. Public key smoke test — worker rejects an unsigned token with 200 + denialReason
curl -sX POST "$EDGE/v1/verify" \
  -H "X-CERNIQ-Verify-Key: $VERIFY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"token":"not.a.real.jwt","action":"read"}' | jq '.denialReason'
# Expected: "INVALID_SIGNATURE" (or "AGENT_NOT_FOUND" if the algorithm fails fast).
# Failure: the worker is hitting origin on every request — KV not bound, OR
# the algorithm fell through to the origin proxy. Check `wrangler tail`.

# 3. KV namespaces are reachable
wrangler kv:key list --binding TRUST_SCORE_CACHE | head -3
# Failure: id mismatch in wrangler.toml. Re-run `wrangler kv:namespace list`
# and reconcile.

# 4. Worker analytics dataset is being written
wrangler tail --format=pretty | head -20
# Make a real verify request and watch for `[VERIFY_ANALYTICS] write` lines.
```

---

## Rollback

The verify path runs at the edge AND at origin (origin remains available
on `api.cerniq.<domain>/v1/verify`). To roll back:

```sh
# Pause routing — DNS-level. Toggling the route's "enabled" state is faster
# than redeploying.
wrangler deployments list
wrangler rollback <previous-deployment-id>

# If a worker bug is forging denials, take the route OFFLINE entirely:
# Cloudflare dashboard → Workers Routes → toggle the CERNIQ verify routes.
# Origin will receive the traffic with no client changes (clients hit the
# same hostname; the route just stops intercepting).
```

The relying party SDK MUST tolerate either path returning the verify
response — they are byte-identical because both share the same algorithm
module. If they ever diverge in production, treat it as a SEV-1.

---

## What does NOT live here

- Worker source code → `workers/cf-verify/src/`
- KV sync workers (origin → edge cache push) → `apps/api/src/modules/edge-sync/`
- Terraform for namespaces / routes (Phase 3.1) → `infra/cloudflare/terraform/`
  (not yet present; tracked under M-013)
