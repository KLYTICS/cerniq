# `apps/api/src/modules/audit/compression/` — audit storage compression

**WORK_BOARD**: M-036 · **ADR**: 0015 · **Operator gate**: OD-017

## What this directory is

The kernel of AEGIS's three-tier audit storage design (hot Postgres →
warm Parquet + zstd → cold Parquet + zstd at higher compression). Every
emitted Parquet file is paired with a *signed manifest* that anchors
the file's contents into two independent chains:

1. **Row chain** — the existing per-`AuditEvent` signature chain.
   The manifest carries `firstChainHashB64Url` / `lastChainHashB64Url`
   to pin its first and last rows into the live chain.
2. **Manifest chain** — `prevManifestHashB64Url` points at the prior
   manifest in the same tenant slice, so an auditor can verify the
   integrity of an entire compressed corpus offline using only the
   AEGIS audit pubkey.

See `docs/decisions/0015-audit-storage-compression.md` for the full
rationale, threat model, and rejected alternatives.

## What ships in Phase 0 (this drop)

Pure, framework-free, dependency-free kernel:

| File                          | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `manifest.types.ts`           | Body + signed-manifest type contract; constants.                       |
| `manifest.canonical.ts`       | RFC-8785-style canonicalization; sign + verify (Ed25519).              |
| `manifest.canonical.spec.ts`  | Parity vs `AuditChainUtil.canonicalize`; sign/verify round-trip.       |
| `manifest.chain.ts`           | Manifest chain hash, row-chain anchor, structural chain-walk.          |
| `manifest.chain.spec.ts`      | All documented tamper modes detected.                                  |
| `README.md`                   | This file.                                                             |

**Not in Phase 0** (gated on **OD-017** acceptance):

- `parquet-writer.ts`, `zstd.codec.ts` — needs `@dsnp/parquetjs` +
  `@mongodb-js/zstd` (or the native-CLI fallback). New deps require
  operator sign-off per root CLAUDE.md.
- `object-store.adapter.ts` (S3 / R2 / GCS) — needs operator's storage
  choice.
- `compression.service.ts`, `compression-checkpoint.repo.ts` — needs
  the additive `AuditEvent.seq BIGSERIAL` column + two new tables;
  migration policy requires operator review.
- `compression-cron.worker.ts`, `scripts/audit-compress.ts`,
  `scripts/audit-restore.ts` — operational layer.
- `apps/api/test/audit-compression.e2e-spec.ts` — end-to-end.

## Why the kernel is framework-free

- The manifest types + canonicalizer + chain walker are reused by
  `packages/verifier-rp` (browser + edge runtimes — no Nest), so a
  third-party relying party can offline-verify a manifest tarball
  with the same code AEGIS uses to write them.
- Decoupling the kernel from Nest also means the parity spec runs as
  a plain vitest unit test under `pnpm --filter @aegis/api test`
  without booting the application container.

## Parity invariant

`manifest.canonical.canonicalJson` must produce byte-identical output
to `apps/api/src/common/crypto/audit-chain.util.ts → AuditChainUtil.canonicalize`.
The `manifest.canonical.spec.ts` cross-tests this property over a
fixed set of representative shapes plus a sample manifest body. **Do
not edit this algorithm without simultaneously editing the audit-chain
util and re-running the parity spec.**

`manifest.chain.rowChainAnchor` likewise mirrors
`AuditChainUtil.prevHash` for the `(id, sig)` branch — same spec
guards it.

## Verification (Phase 0)

Narrowest:

```sh
pnpm --filter @aegis/api test -- compression/manifest
```

Broader:

```sh
pnpm --filter @aegis/api typecheck
pnpm --filter @aegis/api test
```

## Coordination notes

This kernel deliberately does **not** modify:

- `apps/api/src/modules/audit/audit.service.ts` (M-037 / hot append path).
- `apps/api/src/common/crypto/audit-chain.util.ts` (M-037 shared signer).
- `apps/api/src/modules/audit/audit.module.ts` (Nest wiring — gated on
  OD-017 so the compressor wiring lands with its dependencies).
- `apps/api/prisma/schema.prisma` and any migration (gated on OD-017).

`pnpm install` is intentionally not touched in Phase 0.
