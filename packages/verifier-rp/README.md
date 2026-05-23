# @okoro/verifier-rp

Offline verifier for OKORO agent tokens. Drop into any HTTP server — Express,
Fastify, Hono, Cloudflare Workers, Vercel Edge, Bun, Deno — and verify
agent-presented tokens locally with sub-millisecond hot-path latency.

## Install

```bash
pnpm add @okoro/verifier-rp
# Optional, only install the runtime you use:
pnpm add express     # if using @okoro/verifier-rp/express
pnpm add fastify     # if using @okoro/verifier-rp/fastify
pnpm add hono        # if using @okoro/verifier-rp/hono
```

## Quickstart (Express)

```ts
import express from 'express';
import { OkoroVerifier } from '@okoro/verifier-rp';
import { okoroGuard } from '@okoro/verifier-rp/express';

const verifier = new OkoroVerifier({
  baseUrl: 'https://api.okoroapp.com/v1',
  getAgentPublicKey: async (agentId) => myAgentRegistry.lookup(agentId),
});

const app = express();
app.post('/charge', okoroGuard({ verifier }), (req, res) => {
  // req.okoro is the typed VerifyOutcomeSuccess.
  res.json({ chargedFor: req.okoro.agentId });
});
```

## How it works

`@okoro/verifier-rp` performs the entire verification offline:

1. **Parse** the compact JWS. Reject anything that isn't `alg=EdDSA`.
2. **Time-bound check** against `iat` / `exp` with a 5 s clock skew tolerance.
3. **Resolve the verifying key.**
   - Tokens issued by OKORO itself (policy tokens) carry a `kid` in the JOSE
     header. We look the kid up in the JWKS at `https://<okoro>/.well-known/jwks.json`,
     cached in-process for 1 hour with stale-while-revalidate semantics.
   - Tokens signed by an agent's own key (request tokens) do not carry a `kid`.
     For these you supply a `getAgentPublicKey(agentId): Promise<Uint8Array>`
     callback. This is typically wired to your own database where you stored
     the agent's public key at registration time.
4. **Ed25519 verify** via `@noble/ed25519` (same library OKORO uses to sign).
5. **Replay check** against an in-memory LRU keyed on `jti`. The cache TTL is
   the token's remaining lifetime + skew.
6. **Revocation check** against `/v1/agents/:agentId/status`, cached for 30 s.
   Webhook handlers can call `verifier.invalidateAgent(agentId)` to invalidate
   immediately on `okoro.agent.revoked`.
7. **Scope / spend check** against the relying-party-supplied request context.

The hot path after warm-up is pure-CPU Ed25519 verification — no network
round-trip — typically sub-millisecond per request on commodity hardware.

### Resolving agent keys

OKORO's public `/v1/agents/:id/status` endpoint deliberately does not return
the public key, so you cannot rely on the revocation cache for key material.
Wire `getAgentPublicKey` to whichever store you trust:

- Your own database, populated at agent registration time, **or**
- A short-lived cache in front of an authenticated OKORO endpoint, **or**
- A per-agent JWKS endpoint exposed by your platform.

The verifier throws a `ConfigError` at construction time if you don't supply
this callback — there is no silent default.

### Pluggable replay cache

The default replay cache is in-memory LRU. For multi-instance deployments,
implement the `ReplayCache` interface and pass it via `replayCache`:

```ts
import type { ReplayCache } from '@okoro/verifier-rp';

class RedisReplayCache implements ReplayCache {
  constructor(private redis: RedisClient) {}
  async has(jti: string) {
    return (await this.redis.exists(`jti:${jti}`)) === 1;
  }
  async set(jti: string, ttl: number) {
    await this.redis.set(`jti:${jti}`, '1', 'EX', ttl);
  }
  async delete(jti: string) {
    await this.redis.del(`jti:${jti}`);
  }
  async size() {
    return -1;
  }
}

const verifier = new OkoroVerifier({
  getAgentPublicKey,
  replayCache: new RedisReplayCache(redis),
});
```

## Security model

This package follows the OKORO threat model defined in `docs/THREAT_MODEL.md`
(repository root). Key properties:

- **Offline verification** — no OKORO round-trip on the hot path. The only
  network calls are JWKS refresh (≤ once per hour) and revocation lookup
  (≤ once per 30 s per agent).
- **Replay defense** — every verified token's `jti` is cached. A token can
  be verified at most once per process; multi-instance deployments need a
  shared `ReplayCache` (see above).
- **No silent failures** — invalid tokens return a structured `VerifyOutcome`
  with a typed `DenialReason`. The verifier only throws on infrastructure or
  configuration errors (network unreachable, malformed config).
- **No information leak on failure** — replay detection collapses to
  `INVALID_SIGNATURE` on the wire by default, so an attacker can't tell
  whether their forged signature was caught by Ed25519 verification or by
  the replay cache.
- **Constant-time signature verification** — provided by `@noble/ed25519`.
- **Public-key-only** — this package never sees a private key. It can only
  verify, never sign.

For the full threat model and key-rotation runbook, see
`docs/THREAT_MODEL.md` in the OKORO repo.

## Status

Phase 1, version 0.1.0. API is stable but not yet semver-locked. We will
publish `1.0.0` once `/v1` OKORO API is GA.

## License

MIT — see `LICENSE`.
