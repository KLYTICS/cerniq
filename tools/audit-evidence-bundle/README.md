# @cerniq/audit-evidence-bundle

CLI that produces a SOC2-ready, auditor-friendly tarball containing
everything an external auditor needs to **independently verify** an CERNIQ
audit chain — without contacting CERNIQ.

## Quick start

```sh
CERNIQ_API_BASE=https://api.cerniqapp.com \
CERNIQ_API_KEY=sk_live_... \
  pnpm --filter @cerniq/audit-evidence-bundle start \
    --principal-id prc_acme \
    --from 2026-01-01 \
    --to 2026-04-30 \
    --output ./cerniq-evidence-2026Q1.tar.gz
```

Exit codes:

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 0    | Bundle written, chain verification passed (or `--verify-only`). |
| 1    | Fetch / I/O failure — bundle NOT written.                       |
| 2    | Bundle written, chain verification FAILED — treat as SEV-1.     |

## Bundle contents

```
cerniq-evidence-2026Q1/
├── audit-events.ndjson        Streamed export, one signed row per line
├── jwks.json                  Public Ed25519 keys (no private material)
├── cerniq-configuration.json   Well-known discovery doc
├── retention-policy.json      Lane B; omitted if endpoint not yet live
├── security.txt               RFC 9116 vuln-disclosure contact
├── manifest.json              Counts, time range, principal, verdict
├── chain-verification.json    Pre-computed @cerniq/audit-verifier verdict
├── SHA256SUMS                 sha256+filename, one line each
└── README.md                  Plain-English auditor instructions
```

The bundle's own README explains the re-verification flow to whoever
opens the tarball.

## Design choices

- **Zero new heavyweight dependencies.** The tar writer is a 100-line POSIX
  ustar implementation in `build-bundle.ts`; gzip is `node:zlib`. The only
  workspace dep is `@cerniq/audit-verifier`, the same module external
  auditors will use to re-verify.
- **Constant-memory NDJSON pipeline.** The export is streamed from HTTP
  → SHA256 hasher → disk in one pass; row counts and redaction counts
  fall out of the same scan. A 100k-event bundle stays under ~50MB RAM.
- **Reproducible.** Same chain + same inputs → byte-identical `SHA256SUMS`.

## Workspace gap

`pnpm-workspace.yaml` does not include `tools/*`, so this package (like
`tools/quickstart`) lives outside the workspace. Workspace deps are
referenced via `link:../../packages/*` and `pnpm install` is run from
this directory or via `pnpm --filter` from the repo root. If the operator
later adds `tools/*` to the workspace, swap the `link:` references to
`workspace:*`.

## Testing

```sh
pnpm --filter @cerniq/audit-evidence-bundle exec vitest run
pnpm --filter @cerniq/audit-evidence-bundle exec tsc --noEmit
```
