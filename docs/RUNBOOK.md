# OKORO — Operations Runbook

> **On-call?** This document covers local development and routine
> operations. For SEV-1/SEV-2 incidents (chain integrity break, KMS
> rotation, mass agent revocation, JWKS outage, p99 SLA breach, GDPR
> redaction, region rollout), see [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md).

## Local development

```bash
pnpm install
cp .env.example .env
pnpm db:up                 # Postgres 16 + Redis 7 in Docker
pnpm db:migrate            # Apply Prisma schema
pnpm dev                   # API → http://localhost:4000 (docs at /docs)
pnpm dev:dashboard         # Dashboard → http://localhost:3000
```

## Issuing the first API key (manual, until /principals lands)

```bash
# Replace EMAIL and LABEL.
docker compose exec postgres psql -U okoro -d okoro <<'SQL'
WITH p AS (
  INSERT INTO "Principal" (id, email, "emailVerified")
  VALUES ('p_root', 'erwin@klytics.io', true)
  ON CONFLICT (email) DO UPDATE SET "emailVerified" = true
  RETURNING id
)
SELECT id FROM p;
SQL
```

Then in a Node REPL (or a one-shot script under `apps/api/scripts/`):

```ts
import { ApiKeyService } from './src/modules/auth/api-key.service';
// instantiate via Nest test bed or directly with PrismaService + AppConfigService
const { plaintextKey } = await apiKeys.issue('p_root', 'first-key', 'FULL');
console.log(plaintextKey); // store this — it is the only display
```

A future PR adds `apps/api/scripts/bootstrap-principal.ts` that does both.

## Common failures

### `Configuration validation failed`
`AppConfigService` rejected the env. Inspect the error — it lists every missing/invalid var. Most common: `DATABASE_URL` or `REDIS_URL` missing.

### Verify returns `INVALID_SIGNATURE` for an obviously good token
- Check the `publicKey` registered on the agent matches the private key the agent is using.
- Confirm the SDK is on the same major version as the API; token shape is forward-compatible but not reverse.
- `okoro_vk_` keys can call `/verify`; `okoro_sk_` can also. Wrong key on `/agents/register` → 401, not a verify failure.

### BATE recompute lag
Phase 1 recomputes inline after each ingest (synchronous trigger inside `BateService.ingestSignal`). Latency >100 ms is a signal volume issue → bump to BullMQ worker (Phase 2 backlog Epic 9).

### `/health/ready` reports degraded
- `database: false` → check `DATABASE_URL`, run `pnpm db:migrate`.
- `redis: false` → check `REDIS_URL`, ensure docker compose service is running.

## Deploying to Railway (Phase 1 path)

`railway.json` declares the build + start commands. Required env:

```
NODE_ENV=production
DATABASE_URL=...                    # Railway Postgres plugin
REDIS_URL=...                       # Railway Redis plugin
AUDIT_SIGNING_KEY_B64=...           # generated with: openssl genrsa -out k.pem 4096 && base64 -i k.pem | tr -d '\n'
JWT_ED25519_PRIVATE_KEY_B64=...     # generate with the SDK and persist; never reuse a dev key in prod
JWT_ED25519_PUBLIC_KEY_B64=...
ENABLE_SWAGGER=false
```

Health check path is `/v1/health/ready`. Restart policy is `ON_FAILURE` with 5 retries.

## Releasing the SDK

```bash
cd packages/sdk-ts
pnpm build && pnpm test
pnpm version patch          # or minor / major
pnpm publish --access public
```

CI must run on every SDK PR. Before public launch, add `provenance: true` to the publish step (Sigstore) — see backlog under "Cross-cutting concerns / Security".
