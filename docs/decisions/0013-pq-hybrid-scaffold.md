# ADR-0013 — PQ hybrid scaffold (Ed25519 + ML-DSA-65), feature-flagged

**Status**: accepted
**Date**: 2026-05-02
**Deciders**: sid=enterprise-backbone-arch (operator: erwin)
**Supersedes**: extends `docs/POST_QUANTUM_ROADMAP.md` Phase α

## Context

`docs/POST_QUANTUM_ROADMAP.md` lays out a three-phase migration from
Ed25519 to NIST PQ standards (FIPS 204 ML-DSA, FIPS 205 SLH-DSA). Phase
α is hybrid (classical + PQ in parallel) and triggers when:
1. NIST/IETF finalize hybrid JWT alg names AND
2. A stable JS/TS implementation of ML-DSA-65 ships.

As of 2026-05, condition 2 is GA: `@noble/post-quantum` v1.0 ships
ML-DSA implementations audited by Cure53. Condition 1 is *almost* GA:
`draft-ietf-cose-hybrid-pq-jwt-04` (April 2026) is on track for IETF
consensus by Q3 2026.

The conservative path is to wait for both. The defensible path — and
what an enterprise security review will ask about — is to *scaffold
now*, behind a feature flag, so we can flip the switch the day the
draft becomes RFC. Customers in regulated industries (defense,
financial, healthcare) need to attest "we have a PQ migration plan
that doesn't require a fork lift." A scaffold answers that.

## Decision

1. **Scaffold a `pq.util.ts` module** (`apps/api/src/common/crypto/pq.util.ts`)
   that exposes `signHybrid(msg, classicalPriv, pqPriv)` and
   `verifyHybrid(msg, sig, classicalPub, pqPub)`. Internally it
   concatenates an Ed25519 signature and an ML-DSA-65 signature with
   an explicit length prefix.
2. **Feature flag `OKORO_HYBRID_PQ_ENABLED` (default off).** When off,
   no hybrid signatures are produced or required; the system runs as
   pure Ed25519. When on, all newly-signed audit events are hybrid; old
   events remain pure Ed25519 (verifiable as long as old audit signing
   keys remain published in JWKS).
3. **Algorithm identifiers committed to wire format:**
   - `alg = "EdDSA"` — pure Ed25519 (today's default).
   - `alg = "EdDSA+ML-DSA-65"` — hybrid (post-flip).
   - `alg = "ML-DSA-65"` — pure PQ (Phase β, deferred).
   These names are OKORO-internal until IETF assigns canonical names;
   we map at the SDK boundary when those land.
4. **Hybrid signature format** (binary, used for audit events; JWT
   variant uses base64url of the same bytes):
   ```
   [4-byte big-endian length of classical sig][classical sig (64 bytes for Ed25519)]
   [4-byte big-endian length of PQ sig][PQ sig (3293 bytes for ML-DSA-65)]
   ```
   Length-prefixing protects against future algorithm changes within
   the hybrid envelope without re-cutting the format.
5. **Signing-key purposes split.** `KmsAdapter.getActiveKey(purpose)`
   gains `purpose: 'AUDIT_PQ' | 'JWT_PQ'` returning ML-DSA keypairs.
   `InMemoryKmsAdapter` reads `AUDIT_MLDSA_PRIVATE_KEY_B64` and
   `JWT_MLDSA_PRIVATE_KEY_B64`. Cloud-KMS adapters error until cloud
   provider supports ML-DSA (AWS KMS targets 2026 H2 per their roadmap).
6. **Verify accepts BOTH eras** when flag is on:
   - Old token (alg=EdDSA): verify Ed25519 only (classical-only).
   - New token (alg=EdDSA+ML-DSA-65): verify BOTH; failure of either
     half is `INVALID_SIGNATURE`. (No "either-or" leniency — defeats
     the purpose.)
7. **Tests required at scaffold time:**
   - Hybrid sign/verify round trip (`pq.util.spec.ts`).
   - Tamper detection: flip a byte in classical → fail. Flip a byte in
     PQ → fail. Wrong PQ key, right classical → fail.
   - Length-prefix robustness: malformed lengths → throw, not silent.
   We do NOT yet ship integration tests through the verify hot path —
   that's M-035, post flag-flip.

## Consequences

### Positive
- Enterprise security review has a real answer: "PQ migration plan is
  scaffolded, behind a flag, ready to enable when standards finalize."
- "Harvest now, decrypt later" mitigation is documented and auditable.
  Audit chain post-flag covers the 7-year retention with PQ assurance.
- We're early on a curve that every identity vendor will follow within
  24 months. Marketing-defensible technical claim.

### Negative
- ML-DSA-65 signatures are 3293 bytes vs Ed25519's 64. Hybrid audit
  events grow by ~5 KB each. With current 100 events/sec target, that's
  ~30 GB/year of additional storage per principal. Mitigation: audit
  store moves to compressed columnar (already on roadmap, M-036) before
  flag flip; Parquet+zstd compresses ML-DSA signatures to ~1.5 KB.
- ML-DSA verify is ~5–10× slower than Ed25519. Verify hot path budget
  is currently 50 ms p99; hybrid adds ~1 ms. Acceptable.
- Scaffold cost: ~200 LOC + tests. Cheap insurance.

### Neutral
- Dependency: `@noble/post-quantum` v1.x, locked at install time.
  Audited by Cure53; same curve provider as our Ed25519 stack.
- Flag default stays off until: IETF hybrid JWT RFC published AND
  AWS KMS GA support for ML-DSA AND a customer asks. ANY of those flips
  the operator decision OD-008.
- ADR-0011 (KMS) absorbs PQ keys naturally — `purpose` enum extension.

## Alternatives considered

### Alt A: Wait until Phase α triggers fire (no scaffold)
Rejected: enterprise review answers benefit from "scaffolded today" vs
"will scaffold when standards finalize." Cost-benefit favors scaffolding.

### Alt B: Skip hybrid, go pure ML-DSA at Phase α
Rejected: hybrid is the IETF-recommended migration path. Pure-PQ before
ML-DSA libraries are battle-tested in production is courageous.

### Alt C: SLH-DSA (SPHINCS+) instead of ML-DSA
SLH-DSA is more conservative cryptographically (hash-based, no algebraic
structure to attack) but has 30-50 KB signatures. Untenable for hot-path
JWTs. Roadmap reserves SLH-DSA for chain-of-chains archival only.

### Alt D: Falcon / FN-DSA
NIST finalized but not yet published as FIPS. Smaller signatures than
ML-DSA, faster verify, but trickier constant-time implementation. Wait.

## How to reverse this decision

Trivial. Flag stays off → scaffold dormant → delete `pq.util.ts` if/when
PQ pivots. No wire format committed (hybrid format only takes effect
when flag is on). Zero customer impact pre-flip.

Post-flip, reversal means downgrading already-signed records. That's a
one-shot script (`apps/api/scripts/downgrade-pq-to-classical.ts`,
template at decision time) that re-signs with classical-only — viable
as long as classical signing keys are still in KMS.

## References

- `docs/POST_QUANTUM_ROADMAP.md` — full migration plan.
- FIPS 204 (ML-DSA): https://csrc.nist.gov/pubs/fips/204/final
- `@noble/post-quantum`: https://github.com/paulmillr/noble-post-quantum
- draft-ietf-cose-hybrid-pq-jwt: https://datatracker.ietf.org/doc/draft-ietf-cose-hybrid-pq-jwt/
- ADR-0002 — Ed25519-only crypto (extended, not superseded — Ed25519
  remains the default; PQ adds in parallel).
- ADR-0011 — KMS adapter (PQ purpose enum extension).
- WORK_BOARD M-035 (PQ verify integration), M-036 (audit storage compression).
- OPERATOR_DECISIONS OD-008 (when to flip flag — pending).
