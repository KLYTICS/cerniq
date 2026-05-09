# KMS module

Implements ADR-0011: every cryptographically signed record in AEGIS
(audit events, policy JWTs, webhook bodies) flows through a `KmsAdapter`.
Adapters never expose private key material — all signing happens
through `sign(msg)`.

## Adapters

| Adapter | Pattern | Sign latency | When to pick |
|---|---|---|---|
| `InMemoryKmsAdapter` | env-held keypair | ~50 µs | dev, single-region prod, OSS distros |
| `AwsKmsAdapter` | envelope encryption | ~50 µs (post-unwrap) | AWS-native deployments until KMS GAs `EDDSA` |
| `GcpKmsAdapter` | native `EC_SIGN_ED25519` | ~10–20 ms | GCP-native; HSM-backed |
| `VaultTransitAdapter` | native `transit/sign ed25519` | ~5–15 ms | self-hosted / sovereign |

## Selection

`AEGIS_KMS_PROVIDER` env: `in-memory` (default) | `aws` | `gcp` | `vault`.

The cloud-adapter wiring (which SDK client to construct, which keys to
register) is intentionally NOT in `kms.module.ts` — it lives in
`app.module.ts` so the cloud SDKs aren't pulled into unit-test bundles.

## Files

- `aws-kms.adapter.ts` + spec — envelope-encryption pattern
- `gcp-kms.adapter.ts` + spec — native Cloud KMS `asymmetricSign`
- `vault-transit.adapter.ts` + spec — Vault transit `sign` with retry
- `kms.module.ts` — registers active adapter from env

## Reference

- ADR-0011: `docs/decisions/0011-key-rotation-kms.md`
- Crypto bootstrap: `apps/api/src/common/crypto/crypto.bootstrap.ts`
- WORK_BOARD: M-023 / M-029 / M-030 / M-031 (Azure)
