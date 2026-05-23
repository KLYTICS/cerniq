# Runbook — error catalog drift

## Alert

- **Names**: `ErrorCatalogUncatalogedThrowDetected` (critical, CI-only),
  `ErrorCatalogParityDrift` (critical, CI-only),
  `ErrorCustomerMessageLeakDetected` (critical, CI-only).
  These run as build-time gates, not runtime alerts.
- **Source**: round-15 catalog surface — `apps/api/src/common/errors/error-catalog.ts`, `scripts/audit-error-catalog.ts`, `tests/cross-package/error-catalog-parity.spec.ts`.

## Symptom

One or more of:

1. `pnpm -F @cerniq/scripts audit:errors` reports an `CerniqError` subclass thrown but not registered in the catalog.
2. `pnpm vitest run tests/cross-package/error-catalog-parity.spec.ts` fails — a code's `httpStatus` or `retryable` differs across server, TS-generated mirror, or Python-generated mirror.
3. A customer reports receiving a 5xx with a stack trace, internal class name, or stripe/secret material in the message body — the customer-message leak canary fired (or didn't, but should have).
4. Two entries with the same `code` — duplicate registration breaks the lookup.

## Impact

- **Uncataloged throw → wire returns `internal_error`**: round-15 design uses the catalog as the only source of customer-visible error envelopes. An uncataloged class falls through the `getInternalFallback()` path. The customer sees `{"code": "internal_error", "retryable": false}` regardless of what actually happened — they can't retry, can't debug, file a ticket.
- **Parity drift → SDK retry storms or lost retries**:
  - Server says `retryable: true`, SDK says `false`: SDK gives up immediately on transient failures (lost retries → flaky integrations).
  - Server says `retryable: false`, SDK says `true`: SDK retries on permanent failures, amplifying load (retry storm during incidents).
- **Customer message leak**: if `customerMessage` ever includes `cerniq_*`, `whsec_*`, `sk_*`, stack trace, or `null`/`undefined` strings, that's a security incident — secrets or internals exposed to customers.
- **Duplicate code**: silently overwrites the earlier entry. Behavior depends on JS object iteration order and is not deterministic.

## Diagnose

1. **Run the gates locally.**

   ```bash
   # Find uncataloged throws.
   pnpm -F @cerniq/scripts audit:errors

   # Confirm cross-language parity.
   pnpm vitest run tests/cross-package/error-catalog-parity.spec.ts

   # Lock the canaries (no leaked secrets in customer messages).
   pnpm jest apps/api/src/common/errors/error-catalog.spec.ts
   ```

2. **Identify the offending class.**

   The `audit:errors --list` mode prints every throw site and its registration status:

   ```bash
   pnpm -F @cerniq/scripts audit:errors -- --list | rg -i 'uncataloged|missing'
   ```

3. **Check the generated mirrors are up-to-date.**

   ```bash
   # Round-15 design: TS mirror at packages/types/src/error-catalog.generated.ts
   # Python mirror at packages/sdk-py/cerniq/error_catalog.py
   head -3 packages/types/src/error-catalog.generated.ts
   head -3 packages/sdk-py/cerniq/error_catalog.py
   ```

   Both must carry `@generated` headers (parity test enforces this). If a mirror is hand-edited without the header, regenerate.

4. **Confirm a duplicate-code situation.**

   ```bash
   pnpm -F @cerniq/api exec node -e "
     const { ERROR_CATALOG } = require('./dist/common/errors/error-catalog');
     const codes = Object.values(ERROR_CATALOG).map(e => e.code);
     const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
     if (dupes.length) console.log('DUPLICATES:', dupes);
     else console.log('no duplicates');
   "
   ```

5. **For runtime customer reports — capture the response envelope.**

   Ask the customer for:
   - The HTTP status code.
   - The full response body (redact any sensitive request data).
   - The timestamp ± 1 minute.

   Then locate the corresponding API log line and compare to the catalog entry.

## Mitigate

- **Uncataloged class shipped**: revert if not yet promoted past staging. If in production, register the class in the catalog immediately and ship a fix:

  ```typescript
  // apps/api/src/common/errors/error-catalog.ts
  '<my_new_error>': {
    code: '<my_new_error>',
    httpStatus: 4xx | 5xx,
    retryable: true | false,
    backoff: 'none' | 'linear' | 'exponential' | 'on_retry_after_header',
    customerMessage: '...',  // NEVER include cerniq_*, whsec_*, sk_*, stack
    category: 'auth | validation | policy | rate_limit | billing | crypto | transient | internal',
  },
  ```

  Then regenerate the TS + Python mirrors per the round-15 design (script: TBD per peer c4f241c5's round-16 catalog consumption work).

- **Parity drift between server and TS/Python**: regenerate the mirror from the server. The mirrors are auto-generated; never hand-edit.

- **Customer message leak**: revert the offending catalog entry immediately. Audit other entries for the same leak class. File a security incident.

- **Duplicate code**: rename one of the duplicates. Add a permanent uniqueness gate in the catalog spec (`error-catalog.spec.ts` already covers this — see "codes are unique" assertion).

## Eradicate

- After landing the fix, run the full audit + parity suite to confirm no other classes are affected.
- If the leak class was novel (e.g., a new pattern that the canary list doesn't cover), expand the canary list in `error-catalog.spec.ts` to catch the next instance.
- Cross-link the catalog from the SDK README so future SDK contributors know the contract is server-defined.
- For uncataloged classes that recur: add a pre-commit hook that runs `audit:errors`. The gate should never first surface in CI — it should fire on the developer's machine.

## Verify recovery

```bash
# All three gates must pass.
pnpm -F @cerniq/scripts audit:errors
pnpm vitest run tests/cross-package/error-catalog-parity.spec.ts
pnpm jest apps/api/src/common/errors/error-catalog.spec.ts

# And from the preflight orchestrator:
make preflight-fast
# 'error catalog audit' check must show ✅ pass with details "all throws cataloged".
```

## Escalate

- **Customer message leak (secret material exposed)**: page `${ESCALATION_CONTACT}` immediately + notify operator. P0 security incident. Sweep customer-facing logs for the leaked material; rotate the affected secrets if customer-visible.
- **Parity drift in production**: notify all SDK consumers via release notes; publish patched SDK versions. The `release.yml` workflow + `CHANGELOG.md` are the mechanism.
- **Duplicate code observed in production**: notify customers whose integrations may have hit the silently-overwritten entry; review for any unexpected behavior.

## Postmortem trigger

- **Yes** for any customer-message leak (secret exposure).
- **Yes** for any parity drift that reached production (SDK retry contract broken in the wild).
- **Yes** for any duplicate code shipped past CI (gate failure).
- **No** for uncataloged throws caught pre-merge by `audit:errors` (gate working as designed).

## See also

- Round 15 handoff: `docs/SESSION_HANDOFF.md` 2026-05-05 entry, Lane 5.
- Code: `apps/api/src/common/errors/error-catalog.ts`, `cerniq-error.ts`, `apps/api/src/common/filters/http-exception.filter.ts`.
- Generators (peer c4f241c5 round-16): `packages/types/src/error-catalog.generated.ts`, `packages/sdk-py/cerniq/error_catalog.py`.
- Audit script: `scripts/audit-error-catalog.ts`.
- Spec: `apps/api/src/common/errors/error-catalog.spec.ts`, `tests/cross-package/error-catalog-parity.spec.ts`.
- Generated catalog reference: `apps/api/src/common/errors/error-catalog.generated.md`.
