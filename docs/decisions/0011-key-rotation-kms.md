# ADR-0011 — Key rotation via KMS adapter; signingKeyId stamped on every signed event

**Status**: accepted
**Date**: 2026-05-02
**Deciders**: sid=enterprise-backbone-arch (operator: erwin)
**Supersedes**: none

## Context

OKORO Phase 0 ships with two long-lived signing keys held in env vars:

- `AUDIT_ED25519_PRIVATE_KEY_B64` — signs every audit event in the
  hash chain (retention: 7 years per OD-004).
- `JWT_ED25519_PRIVATE_KEY_B64` — signs policy JWTs (lifetime: ≤ policy
  expiresAt, max 90 days per spec).

Two problems with the current state:
1. **No `signingKeyId` on signed records.** When we rotate, every audit
   event signed under the old key cannot be verified by a third party
   that has only fetched the new key from `/.well-known/audit-signing-key`.
   The well-known endpoint must serve a *list* keyed by `kid`, and every
   event must record which `kid` signed it.
2. **No KMS abstraction.** Env-held private keys are fine for dev and
   single-region prod, but enterprise customers expect HSM-backed keys
   (AWS KMS, GCP Cloud KMS, Azure Key Vault, HashiCorp Vault). Building
   that integration retroactively after we have customers is painful.

This ADR establishes both the data-model commitment and the operational
contract for key rotation, before customer deployment so it costs nothing.

## Decision

1. **Add `signingKeyId` to every cryptographically-signed record** —
   `AuditEvent.signingKeyId`, `AgentPolicy.signedTokenKeyId`. Migration
   is owned by M-026 (peer holds `migrations/**`). Backfill for
   pre-existing records: `signingKeyId = "kid-genesis-v1"` (the only
   key used in Phase 0).
2. **`/.well-known/audit-signing-key` returns a key SET, not a single
   key.** Shape (RFC 7517 JWKS):
   ```json
   { "keys": [
     { "kid": "kid-2026-05-01", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "sig", "alg": "EdDSA", "validFrom": "2026-05-01T00:00:00Z", "validUntil": null },
     { "kid": "kid-genesis-v1", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "sig", "alg": "EdDSA", "validFrom": "2026-04-01T00:00:00Z", "validUntil": "2026-05-01T00:00:00Z" }
   ]}
   ```
   Old keys remain published forever (audit chain verifiability is
   forever; `validUntil` only marks when signing stopped).
3. **`KmsAdapter` interface.** Defined in
   `apps/api/src/common/crypto/crypto.bootstrap.ts`. Three operations:
   - `getActiveKey(purpose: 'AUDIT' | 'JWT' | 'WEBHOOK'): Promise<{ kid, publicKey, sign(msg) }>`
   - `getKeyByKid(kid): Promise<{ publicKey } | null>` (verify-side lookup)
   - `listKeys(purpose): Promise<KeyMetadata[]>` (powers the JWKS endpoint)
   The adapter never exposes raw private key material to OKORO code; all
   signing goes through `sign(msg)` which may be a local Ed25519 op or
   a remote KMS call.
4. **Adapters shipped, in priority order:**
   - `InMemoryKmsAdapter` (default, dev) — reads from env vars.
   - `AwsKmsAdapter` (M-023) — `kms:Sign` API with `EdDSA`.
   - `GcpKmsAdapter` (M-029) — Cloud KMS asymmetric sign.
   - `VaultTransitAdapter` (M-030) — HashiCorp Vault transit/sign.
   - `AzureKeyVaultAdapter` (M-031) — Key Vault sign with Ed25519 (when GA).
5. **Rotation cadence (operator decision OD-007):**
   - Audit signing key: every 12 months, on-demand on suspected compromise.
   - JWT signing key: every 6 months. Tokens issued under old key remain
     valid until natural expiry (max 90 days), then old key drops out
     of accepting set.
   - Both rotations: `okoro-cli kms rotate <purpose>` (M-027).
6. **Rotation never breaks audit-chain verifiability.** Test in
   `apps/api/test/key-rotation.spec.ts` (M-026): sign 100 events under
   key A, rotate, sign 100 more under key B, verify all 200 from JWKS.

## Consequences

### Positive
- Compromised key = 1-hour incident, not a 7-year audit-chain rewrite.
- Enterprise procurement gets the answer they want: "yes, we use your KMS."
- SOC2 CC6.1 (logical access — cryptographic key management) becomes
  a 1-paragraph control with KMS evidence, not a 20-page custom story.
- New algorithms (PQ migration, ADR-0013) drop in as new `kid`s without
  touching the audit chain shape.

### Negative
- KMS adapters are I/O — local sign latency goes from ~50 µs (in-process
  Ed25519) to ~5–20 ms (KMS round-trip). Mitigation: `JwtSigner` caches
  the active key in-memory for `JWT` purpose (signing is hot); `AuditSigner`
  keeps the cache too but invalidates on `kid` change. The verify hot path
  doesn't sign anything, only verifies — verify is local.
- Adapter surface = 3 cloud providers minimum to claim "enterprise
  ready." Each takes ~1 dev-week.
- Two-key validation period during rotation (typically 24 hours): both
  old and new keys accepted for verify, only new for sign. Window must
  be observable — adds metric `okoro.kms.rotation.dual_active_seconds`.

### Neutral
- `crypto.bootstrap.ts` becomes the canonical place to fetch a signer.
  Existing `Ed25519Util` and `JwtUtil` continue to exist for raw crypto;
  they no longer hold private keys directly.
- Webhook signing keys (per-RP, customer-rotatable) reuse the same
  adapter shape but with `purpose: 'WEBHOOK'` and a per-RP `kid` namespace.

## Alternatives considered

### Alt A: Single rotating env var, never publish old keys
Considered. Rejected: third-party verifiability of historical audit
events is non-negotiable per SOC2 CC7.2.

### Alt B: PKCS#11 / hardware HSM only, no software KMS
Too heavy for self-hosted dev / open-source distribution. Hardware HSM
goes in via the `Vault*HsmAdapter` (M-032, deferred).

### Alt C: Per-tenant signing keys
Tempting for blast-radius isolation. Rejected for v1: every relying party
would need to discover N JWKS endpoints. Single OKORO-wide signing key
per `purpose`, with `principalId` recorded inside the signed payload, is
the standard pattern (matches Auth0, Cognito, Okta).

## How to reverse this decision

If KMS proves operationally heavier than expected, drop back to env-var
keys for self-hosted distros. Cloud-hosted OKORO keeps KMS. Concretely:
the `KmsAdapter` stays; the `InMemoryKmsAdapter` becomes the default
again; documentation removes the cloud-KMS recommendation. No data
migration needed.

If `signingKeyId` proves wasteful (it won't — it's a 24-byte string),
nothing reverses cleanly. Treat as forever-decision.

## References

- RFC 7517 — JSON Web Key (JWK).
- AWS KMS Sign API: https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html
- Vault Transit: https://developer.hashicorp.com/vault/api-docs/secret/transit
- ADR-0005 — Audit-chain canonicalization (signingKeyId is a sibling
  of canonical payload, NOT inside it — kid changes don't break chain).
- WORK_BOARD M-026 (signingKeyId migration), M-023 (AwsKmsAdapter).
- OPERATOR_DECISIONS § OD-007 (rotation cadence pending operator sign-off).
