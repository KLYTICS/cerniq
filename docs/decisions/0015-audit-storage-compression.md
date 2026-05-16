# ADR-0015 — Audit storage compression (Parquet + zstd)

**Status**: proposed
**Date**: 2026-05-11
**Deciders**: operator (Erwin Kiess-Alfonso) — see OD-017
**Closes**: WORK_BOARD M-036 design phase; unblocks ADR-0013 flag-flip prereqs

## Context

The AEGIS audit chain is the single most important durability surface in
the platform. Today every `AuditEvent` lives in Postgres for the lifetime
of the tenant's retention window — 365 days on paid tiers, 7 years on
Enterprise (per ADR-0014 + OD-004). At Phase-1 commercial scale that table
becomes the largest, hottest, and most expensive shape in the database,
yet the rows themselves are read rarely after the first 7 days
(operator dashboards, compliance exports, incident forensics, redactions).

Three downstream commitments lean on cold-storage existing:

1. **ADR-0013** PQ-hybrid scaffold — the hybrid signature roughly doubles
   audit-row bytes. Without compression, the Postgres footprint roughly
   doubles too.
2. **OD-004** 7-year retention floor on Enterprise — open-ended Postgres
   growth makes the unit economics in `docs/finance/AEGIS_Financial_Model_v1.xlsx`
   diverge from reality.
3. **THREAT_MODEL_v2 §4.3** RFC-8785-style canonical hashing — third-party
   auditors need an *offline-verifiable* artifact of the chain. A Postgres
   dump satisfies legal but not "give an auditor a tarball they can verify
   on their laptop." Parquet + manifest does.

This ADR records the compression design and the explicit operator gates
that block its implementation.

## Decision

Adopt a three-tier architecture for audit rows:

| Tier | Age          | Store                                     | Codec      | Query              |
| ---- | ------------ | ----------------------------------------- | ---------- | ------------------ |
| Hot  | 0–7 days     | Postgres (`AuditEvent`)                   | none       | live dashboard/SQL |
| Warm | 7d–90d       | Object store (S3-compat) `audit/v1/...`   | zstd L3    | Athena/Trino       |
| Cold | >90d         | Same prefix, separate lifecycle class     | zstd L19   | restore on demand  |

Each emitted Parquet file is paired with a signed JSON **manifest**. The
manifest carries the chain anchors (`firstChainHash`, `lastChainHash`),
the file digest (`parquetSha256`), and `prevManifestHash` — yielding a
second, independent chain over manifests that anchors into the existing
row chain. A third-party verifier needs only:

1. `/.well-known/audit-signing-key` (public Ed25519 JWKS-style).
2. The manifest list.
3. The Parquet files.

Tampering:

- Mutate one row inside a Parquet → `parquetSha256` mismatch.
- Delete a manifest → next manifest's `prevManifestHash` mismatch.
- Reorder manifests → both chains break.
- Re-sign a forged manifest → invalid against the published pubkey.

Signing reuses `AuditSignerService` (M-037-aware: KMS-backed when wired,
env-fallback otherwise). The manifest stamps `signingKeyId` at sign time,
so key rotation mid-corpus is verifiable end-to-end.

Tenant isolation is **hybrid-sliced**: enterprise principals get
per-tenant files; smaller tenants share a `global` slice. Every row
carries `principalId` so row-group statistics enable Athena/Trino
predicate pushdown even inside `global`. The signed payload's
`principalId` remains the authority — the Parquet column is an index.

### Library choice (proposed, gated on OD-017)

- **Parquet writer**: `@dsnp/parquetjs` (maintained fork of parquetjs-lite,
  MIT, zero native deps, supports zstd via pluggable codec).
- **zstd**: `@mongodb-js/zstd` (prebuilt N-API, levels 1–22). Fallback
  `AEGIS_AUDIT_COMPRESS_ZSTD_IMPL=native-cli` spawns `zstd` CLI for
  environments that forbid N-API.
- **Object store**: S3-compatible (Railway → AWS S3 or Cloudflare R2),
  abstracted behind `ObjectStoreAdapter` so dev/test runs against a
  local FS adapter.

### Schema additions (proposed, gated on OD-017)

A single additive migration:

1. `AuditEvent.seq BIGSERIAL` — monotonic sequence column, required for
   compaction to read in deterministic order. Backfilled in a one-shot
   script (covered separately).
2. `AuditCompressionManifest` — manifest registry (one row per emitted
   Parquet file).
3. `AuditCompressionCheckpoint` — `last_sealed_seq_per_slice` watermark.

**Migrations remain append-only after deploy** (CLAUDE.md root invariant);
this ADR records the *proposed* migration so the operator can sign off
before it lands.

### Phasing

This ADR is shipping **Phase 0 — Kernel** only:

- `apps/api/src/modules/audit/compression/manifest.types.ts`
- `apps/api/src/modules/audit/compression/manifest.canonical.ts`
- `apps/api/src/modules/audit/compression/manifest.canonical.spec.ts`
- `apps/api/src/modules/audit/compression/manifest.chain.ts`
- `apps/api/src/modules/audit/compression/manifest.chain.spec.ts`
- `apps/api/src/modules/audit/compression/README.md`

Phase 0 introduces:

- No new runtime dependencies.
- No schema or migration changes.
- No Nest module registration (the kernel is framework-free; the
  manifest types and pure functions can be unit-tested under
  `pnpm --filter @aegis/api test` without a Nest container).
- No object-store wiring.

Phase 0 deliberately covers the *signature-bearing core* of the design
so the cryptographic decisions are reviewable and verifiable today, and
the supply-chain / schema / infrastructure choices remain explicitly
operator-gated under OD-017.

### Phase 1 (gated on OD-017 acceptance)

- Add deps (`@dsnp/parquetjs`, `@mongodb-js/zstd`), `parquet-writer.ts`,
  `zstd.codec.ts`, `object-store.adapter.ts` (FS + S3 impls),
  `compression-batch.policy.ts`.

### Phase 2 (gated on OD-017 + schema review)

- Add `AuditEvent.seq` and the two new tables in a single Prisma
  migration. Backfill script. `compression.service.ts`,
  `compression-checkpoint.repo.ts`.

### Phase 3 (gated on Phase 2 + operator runbook review)

- `compression-cron.worker.ts`, `scripts/audit-compress.ts`,
  `scripts/audit-restore.ts`, full e2e in `apps/api/test/`.

## Invariant preservation

Map to root CLAUDE.md invariants:

| Invariant                                | How preserved                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #3 audit events are append-only + signed | Compressor never deletes. A separate retention sweeper (out of scope) deletes only past `last_sealed_seq_per_slice` AND past the contracted retention floor.                            |
| #3 audit hash-chain                      | Compressor is a serializer, not a notary. It reads rows in `seq` order, recomputes nothing, and signs the **manifest** with `AuditSignerService` (same key family as the row chain).   |
| #5 tenant isolation                      | Hybrid slicing; row-level `principalId` belt-and-braces; explicit parity test that Tenant A's parquet contains zero foreign rows.                                                       |
| #4 no silent failures                    | Object-store failures abort the seal (no manifest INSERT, checkpoint unmoved, retried on next cron). Each failure emits a typed metric label.                                          |
| #2 verify portability                    | The compressor never touches the verify hot path. Manifest verification (`verifyManifestSignature`) is a pure function with no Nest deps — directly usable from `verifier-rp` later.   |

## Consequences

Positive:

- Audit corpus becomes auditor-portable: a tarball + the well-known
  pubkey is an offline verifiable audit set.
- Postgres `AuditEvent` is bounded — 7d × write rate, not 7y.
- ADR-0013 PQ-hybrid flag flip becomes affordable on disk.
- Athena/Trino/DuckDB/BigQuery can query the warm tier without any
  AEGIS-side glue beyond emitting Parquet.

Negative:

- New runtime deps (Parquet + zstd) widen supply-chain surface — flagged
  under OD-017.
- New monotonic column on `AuditEvent` requires an online migration —
  flagged under OD-017.
- Restore-into-Postgres is now a separate operational path with its own
  runbook.

## Rejected alternatives

- **Postgres TOAST + native compression only.** Doesn't reduce row count;
  doesn't produce an auditor-portable artifact; doesn't bound table
  growth at the 7-year horizon.
- **Parquet without manifest signing.** Loses the offline-verify property
  — auditors would have to trust the operator's word that the file is
  the source-of-truth.
- **Manifest signed but row chain not anchored.** Tampering inside a
  Parquet row would slip past manifest verification; the
  `firstChainHash` / `lastChainHash` anchors plus `parquetSha256` are
  what make row-level tampering detectable.
- **Per-row signing inside Parquet.** Doubles storage; signature
  is already in the chain output of `AuditChainUtil`. The row signature
  is preserved verbatim in the Parquet column — the compressor doesn't
  re-sign.
- **Time-based ordering instead of `seq`.** `now()` is not monotonic
  under concurrent writers; sealing by timestamp can re-order rows
  across the seal boundary, breaking the chain.

## Open operator decisions

See `OPERATOR_DECISIONS.md` **OD-017**. All eight blockers are listed
with recommended defaults.

## References

- WORK_BOARD M-036
- ADR-0005 — audit chain canonicalization
- ADR-0006 — audit redactability
- ADR-0011 — key rotation / KMS
- ADR-0013 — PQ hybrid scaffold
- ADR-0014 — pricing tiers (retention floors)
- THREAT_MODEL_v2 §4.3 — canonical hashing
- CLAUDE.md root — append-only audit invariant
