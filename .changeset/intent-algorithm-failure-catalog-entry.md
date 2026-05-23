---
'@aegis/types': minor
---

types: add `intent_algorithm_failure` to the public error catalog (drift closure for the intent-manifest cascade).

**What changed.** `ERROR_CATALOG` (exported via `@aegis/types`) gains one new entry:

```ts
intent_algorithm_failure: {
  httpStatus: 422,
  retryable: false,
  customerMessage: 'Intent manifest operation failed validation. Check the manifest id, idempotency key, and TTL.',
  category: 'validation',
}
```

This widens the `ErrorCode` union type. Consumers performing exhaustive `switch` on `ErrorCode` will get a TypeScript compile error and must add a branch (or a `default`/`assertNever`) for the new variant. Consumers using the catalog as a lookup table (`ERROR_CATALOG[code]`) need no changes.

**Why.** Closes a drift cascade introduced by commit `5e44480` (Phase 2 intent-manifest module) which added the `IntentAlgorithmException` class to `apps/api` but never registered it in the API-side `error-catalog.ts`. The audit-error-catalog drift gate flagged it; the API-side fix landed in `7da1d02`. This changeset propagates the new code to the public catalog (`packages/types/src/error-catalog.generated.ts`) and the published SDK types so relying parties can detect + branch on the new code instead of receiving a generic `internal_error`. The cross-language Python SDK was regenerated in `a51c894`; Python release is operator-driven via its own process and is NOT changeset-managed (not in `.changeset/config.json`).

**Runtime behavior change.** When the API throws an `IntentAlgorithmException` that wasn't translated by the intent controller's typed-cause mapper (a path that SHOULD NOT be reached on normal flow per `intent.controller.ts` translator — but is the belt-and-braces safety net), clients now receive HTTP **422 `intent_algorithm_failure`** instead of HTTP **500 `internal_error`**. This is a more precise diagnostic, not a regression: 500 → 422 is a tighter contract.

**Versioning rationale.** Adding a new entry to a discriminated union is additive at runtime (lookup-table consumers unaffected) but TypeScript-soft-breaking for exhaustive consumers (compile error on missing switch branch). Conventional changesets in this monorepo's 0.x preview window treats this as a `minor` bump. `@aegis/sdk` auto-bumps via the `linked: [['@aegis/sdk', '@aegis/types']]` config in `.changeset/config.json` — no separate entry needed.

**Cross-refs:**
- Source-of-truth change: commit `5e44480` (Phase 2 module + ADR-0017).
- API-side catalog fix: commit `7da1d02`.
- Generated artifacts regen + Postman walk-through update: commit `a51c894`.
- Architecture: `docs/decisions/0017-intent-manifest-runtime-issuance.md`.
- Threat model: `docs/THREAT_MODEL_INTENT_MANIFEST.md`.
