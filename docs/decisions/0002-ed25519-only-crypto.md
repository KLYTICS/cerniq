# ADR-0002 — Ed25519-only cryptography

**Status**: accepted
**Date**: 2026-05-01

## Context

CERNIQ performs three cryptographic operations:

1. **Agent identity signatures** — every outbound agent request is
   signed with the agent's private key; `/v1/verify` validates against
   the registered public key.
2. **CERNIQ-issued policy JWTs** — when a developer creates a policy,
   CERNIQ returns a signed JWT that the agent attaches to outbound
   tokens.
3. **Audit chain signatures** — every audit event is signed by CERNIQ
   so third parties can verify the chain offline.

We need one curve for all three so the public-key surface is uniform
(one JWKS at `/.well-known/jwks.json`, one library, one set of
operational concerns).

## Decision

**Ed25519 only** for every signing operation. Implementations:

- `@noble/ed25519` for the byte-level primitives (sign, verify,
  generateKeypair).
- `jose` is referenced in some SDK code but the API hot path uses a
  hand-rolled compact JWT (header `{ "alg": "EdDSA" }`) to avoid the
  jose dependency on the verify hot path. CI runs a parity test
  ensuring the hand-rolled implementation matches `jose` byte-for-byte.

We **do not** use:

- **RSA** — slower, larger keys, no benefit for our use case.
- **ECDSA secp256k1** — solid but ecosystem lock-in to crypto-currency
  tooling; ed25519 is the modern default.
- **HS256 / HMAC JWTs** — symmetric secrets force every relying party
  to share a key, killing the third-party verifier story.

Key encoding everywhere: **base64url** (RFC 4648 § 5), no padding.

## Consequences

### Positive

- Single codepath for all signing — auditing the crypto surface = one
  library, one curve.
- Ed25519 has well-understood properties: deterministic signatures
  (same input → same signature, useful for audit chain reproducibility),
  no malleability, fast verification (~50 µs/op on commodity hardware).
- 32-byte keys + 64-byte signatures = small wire format, friendly to
  edge environments.

### Negative

- Quantum-vulnerable. Post-quantum migration is a known future task —
  see ADR planned for Q4 2026 (covered as a project memo by sid=3e2203ee
  in the 2026 audit-and-landscape sprint).
- Some legacy enterprise IAM systems (older Okta deployments, SAP) have
  thinner Ed25519 support; we'll need to bridge with HSM tooling for
  Enterprise tier customers.

### Neutral

- The `kid` derivation (`first 16 chars of base64url(sha256(publicKey))`)
  is locked — see `scripts/generate-cerniq-keys.ts:deriveKid`. Changing
  the derivation is a breaking change for relying parties caching by kid.

## Alternatives considered

### Alt A: RS256 + ES256 hybrid (AWS / GCP-style)

Lets us serve enterprise customers whose IAM only speaks RSA. Rejected
because (a) it doubles the audit surface, (b) we can bridge with HSM
adapters at the Enterprise tier without changing the protocol, and (c)
ed25519 wins on every modern relevance metric.

### Alt B: BLS12-381 (for chain aggregation)

Aggregate signatures could compress the audit chain dramatically.
Rejected: too exotic, no deployment urgency, locks us into pairing-based
crypto whose tooling story is much less mature.

## How to reverse this decision

Three places need to change to add a second curve:

1. `apps/api/src/common/crypto/*` — add per-curve dispatch.
2. `packages/sdk-ts/src/crypto.ts` — add per-curve verifier.
3. `apps/api/prisma/schema.prisma` `AgentIdentity.publicKey` becomes
   `(curve, publicKey)` tuple.

The JWT envelope already supports it via the `alg` header — no wire
break.

## References

- @noble/ed25519: https://github.com/paulmillr/noble-ed25519
- RFC 8032 (Ed25519): https://datatracker.ietf.org/doc/html/rfc8032
- `apps/api/src/common/crypto/ed25519.util.ts`
- `apps/api/src/common/crypto/jwt.util.ts`
- `scripts/generate-cerniq-keys.ts`
