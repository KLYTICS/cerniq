# `@aegis/cf-verify`

Cloudflare Worker port of `POST /v1/verify`. **Phase 3 deliverable** —
gated behind $5K AEGIS MRR per the Revenue-Gate doctrine.

## Status

Scaffold. The current `src/index.ts` forwards every request to the origin
and adds an `X-AEGIS-Edge: forward` header. This is intentional — it lets
us:

1. Wire up the deploy pipeline before optimizing.
2. Observe edge routing in production with zero behavioral risk.
3. Cut over to KV-backed verification incrementally per region.

## Phase 3 milestones

- [ ] **M1 — Pure forward** (this scaffold)
- [ ] **M2 — KV trust cache**: read `trust:{agentId}` from KV, fall through to origin
- [ ] **M3 — Edge signature verify**: do Ed25519 verification at edge using `verify.algorithm.ts`
- [ ] **M4 — Edge spend counters**: Durable Objects + atomic increments, KV materialization
- [ ] **M5 — Origin fallback as exception**: edge handles 95%+ of traffic in <80ms p99

## Deploy (locked)

```bash
# Deploy is intentionally broken until Phase 3 unlocks.
pnpm deploy
# → "Phase 3 only — gated behind $5K AEGIS MRR. Edit me when ready."
```

When unlocking:

1. Provision KV namespace: `npx wrangler kv:namespace create TRUST_KV`
2. Replace `REPLACE_ME_AT_DEPLOY` in `wrangler.toml`
3. `wrangler secret put AEGIS_FALLBACK_API_KEY`
4. `wrangler secret put AEGIS_AUDIT_PUBLIC_KEY_B64`
5. Replace the `pnpm deploy` script body in `package.json`
6. `wrangler deploy --env production`

## Architecture invariant

**The verify hot path must remain framework-free.** This worker imports
the same `verify.algorithm.ts` that `apps/api/src/modules/verify/` does;
neither file may import from `@nestjs/*`, `@prisma/client`, or `bullmq`.
See `docs/ARCHITECTURE.md` § 2.
