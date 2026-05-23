# `@okoro/audit-verifier`

Standalone, distributable, **offline** verifier for OKORO audit chains.

Anyone — relying party, customer, regulator, SOC2 auditor — can install this
package and independently verify the tamper-evidence of an OKORO audit log
export, without trusting OKORO's API at runtime. The only thing required is
the OKORO audit-signing JWKS (publicly available at
`https://api.okoroapp.com/.well-known/audit-signing-key`).

This is the **zero-trust verification** half of the audit-chain story. OKORO
publishes the algorithm and the public keys; you run the verifier. If the
chain is intact, the cryptography proves OKORO did not tamper with the log.
If the chain is broken, the report tells you exactly which row broke and
how.

## Why this exists

> "We have a signed audit chain" is a _claim_. `@okoro/audit-verifier` makes
> the claim **executable**. A regulator with this package + the public JWKS
>
> - a downloaded NDJSON export needs nothing else from OKORO to do their job.

This pattern matches FICO's: FICO publishes the score algorithm and the
inputs, and lenders can independently reconstruct the score. We publish the
audit chain construction and the signing public keys, and anyone can
independently verify the chain.

## Install

```sh
npm install -g @okoro/audit-verifier
# or run without installing:
npx @okoro/audit-verifier verify ./export.ndjson \
  --jwks https://api.okoroapp.com/.well-known/audit-signing-key
```

## CLI

```
okoro-audit-verify verify <export.ndjson> [options]

Options:
  --jwks <url>           Fetch JWKS from a URL (HTTPS recommended).
  --jwks-file <path>     Read JWKS from a local file (airgapped path).
  --no-fail-fast         Walk every row even after a break (forensic mode).
  --max-row-detail <n>   Cap per-row detail in JSON output (default 100).
  --json                 Machine-readable JSON to stdout.

Exit codes:
  0  chain intact
  1  chain break detected
  2  argument or I/O error
```

### Online (typical)

```sh
okoro-audit-verify verify ./export.ndjson \
  --jwks https://api.okoroapp.com/.well-known/audit-signing-key
```

### Airgapped (regulated environments)

```sh
# step 1 — download the JWKS from a network-connected machine
curl -fsSL https://api.okoroapp.com/.well-known/audit-signing-key \
     -o okoro-audit-jwks.json

# step 2 — hand-carry the JWKS + the NDJSON export into the sealed environment

# step 3 — verify offline, no network access
okoro-audit-verify verify ./export.ndjson --jwks-file ./okoro-audit-jwks.json
```

## Library API

```ts
import { verifyChain, parseAuditNdjson, loadJwksFromUrl } from '@okoro/audit-verifier';

const jwks = await loadJwksFromUrl('https://api.okoroapp.com/.well-known/audit-signing-key');
const ndjson = await fs.readFile('./export.ndjson', 'utf8');
const rows = parseAuditNdjson(ndjson);

const report = await verifyChain(rows, { jwks });

if (!report.valid) {
  console.error('chain broken at row', report.firstBreak);
  process.exit(1);
}
console.log(`✓ ${report.totalRows} rows verified across ${report.signingKeys.length} kids`);
```

## What the verifier checks

For every row in chronological order:

1. **Kid lookup** — the row's `signingKeyId` must be present in the JWKS.
2. **Chain link** — the row's `prevEventId` and `prevSignature` must equal
   the prior row's `eventId` and `signature` exactly. This catches dropped
   rows, reordered rows, and forged inserts.
3. **Signature** — re-derive `prev_hash || canonical(payload)` and verify
   the row's Ed25519 signature against the JWKS public key for its kid.

The genesis row (first in chain) uses
`prev_hash = sha256("OKORO-AUDIT-GENESIS-v1")`.

## Report shape

```ts
interface ChainReport {
  valid: boolean;
  totalRows: number;
  signingKeys: string[]; // distinct kids referenced
  rotationEvents: Array<{
    // points where the active kid changed
    atIndex: number;
    fromKid: string;
    toKid: string;
  }>;
  firstBreak: RowVerdict | null; // null when valid=true
  rows: RowVerdict[]; // capped by maxRowDetail
  durationMs: number; // wall-clock spent verifying
}
```

## What's intentionally absent

- **No business-logic checks.** This package verifies cryptographic
  integrity only. "Was this transaction _correct_?" is a different question
  answered by your own reconciliation pipeline (see
  [`examples/reconciliation/`](../../examples/reconciliation/)).
- **No revocation lookup.** Chain rows are append-only; revocation is
  a live-state concern handled by `@okoro/verifier-rp`.
- **No PII decryption.** The chain payload uses commitment hashes
  (`actionHash`, `relyingPartyHash`, etc.). Raw values live in
  redactable DB columns. The verifier doesn't need them — by design,
  the chain stays verifiable after GDPR Art. 17 erasure.

## Dependencies (closed set)

- `@noble/ed25519` — Ed25519 signature verification (one curve, one library)
- `@noble/hashes` — SHA-256 / SHA-512 (peer-required by ed25519)

That's it. No NestJS, no Prisma, no Stripe, no fetch polyfill. The package
runs anywhere modern JavaScript runs — Node ≥18, Deno, Bun, Cloudflare
Workers, browsers, even React Native. Useful in the airgapped path:
`@noble/*` is a tiny dep set, so the deployable artifact is small enough
to fit on a USB stick.

## Compliance statement

`@okoro/audit-verifier` is the artifact that backs the following
compliance assertions in `docs/COMPLIANCE_BUNDLE.md`:

| Control                          | How this package satisfies it              |
| -------------------------------- | ------------------------------------------ |
| SOC 2 CC7.2 (system monitoring)  | Independent verification of audit logs.    |
| ISO 27001 A.8.15 (logging)       | Tamper-evidence verifiable by third party. |
| GDPR Art. 25 (data protection)   | Chain stays verifiable after PII erasure.  |
| EU AI Act Art. 14 (transparency) | Auditable record of every agent action.    |

## Reference

- Algorithm: `apps/api/src/common/crypto/audit-chain.util.ts` (the signer)
- ADR-0005 audit chain canonicalization
- ADR-0006 audit redactability
- ADR-0011 KMS-backed key rotation
- `docs/COMPLIANCE_BUNDLE.md` for the full controls map
- `docs/RUNBOOK.md` § "Chain integrity break" for operator procedure
