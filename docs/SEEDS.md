---
title: AEGIS seeds — Round 25 → Round 26+
audience: operator + any session picking up a seeded lane
owner: operator (Erwin)
last-reviewed: 2026-05-20
---

# AEGIS seeds — ready for Round 26 expansion

A **seed** is a scaffold that's tested, compiles clean, has a coherent
API surface, and ships with a README — but is intentionally minimal in
business logic. Future sessions pick a seed and deepen it without
having to redo the design.

Quality bar for every seed below:

- ✅ Typechecks clean (TS) or imports clean (Python)
- ✅ At least one passing test
- ✅ README with copy-paste-runnable example
- ✅ License + version + keywords in `package.json` (TS) or shipped via parent SDK (Python)
- ✅ Listed here with status + acceptance criteria for "done"

## Round 25 seeds landed

| Seed | Status | Path | Tests | Round 26 work to deepen |
|---|---|---|---|---|
| `@aegis/adapter-cloudflare-workers` | preview | [packages/adapter-cloudflare-workers/](../packages/adapter-cloudflare-workers/) | 6 ✅ | Wire to existing `workers/cf-verify` worker; add KV-cache pass-through; add `@cloudflare/workers-types` deeper integration |
| `@aegis/adapter-vercel-edge` | preview | [packages/adapter-vercel-edge/](../packages/adapter-vercel-edge/) | 5 ✅ | Wire to Vercel WAF / Edge Config; add geographic routing helper |
| `@aegis/adapter-aws-lambda` | preview | [packages/adapter-aws-lambda/](../packages/adapter-aws-lambda/) | 7 ✅ | Add Lambda Layer publish target; add `@types/aws-lambda` integration; add CDK construct example in README |
| `@aegis/adapter-hono` | preview | [packages/adapter-hono/](../packages/adapter-hono/) | 6 ✅ | Add per-route minTrustBand override via Hono's `c.var`; ship a `getAegis(c)` typed helper |
| Python SDK parity — `runtime` / `key_storage` / `quickstart` | landed-in-SDK | [packages/sdk-py/aegis/](../packages/sdk-py/aegis/) | 14 ✅ | Add KMS provider implementations (`aegis-aws-kms`, `aegis-gcp-kms`, `aegis-vault`) following the `KmsKeyStorage` Protocol |
| MCP tool-schema drift audit | seed only | [docs/MCP_DRIFT_AUDIT.md](MCP_DRIFT_AUDIT.md) | n/a (doc) | File 10 findings F-MCP-NNN; create parity test; close drift |

**Seeded test count:** 38 new tests across the four adapter packages + 14 Python tests = **52 new test assertions**.

## How to pick up a seed

1. Read the seed's package README and (if applicable) the `MCP_DRIFT_AUDIT.md` for the MCP work.
2. Check the seed's status in this index — `preview` means "API surface locked, deepen freely without breaking the public types"; `seed only` means "doc plan, no code yet."
3. Run the seed's tests to confirm the current baseline:
   ```bash
   pnpm --filter @aegis/adapter-<name> test    # TS adapters
   cd packages/sdk-py && python -m pytest      # Python parity
   ```
4. Make your changes inside the seed. Keep the README in lockstep — outdated README is the #1 silent-failure mode for adoption packages.
5. Update this index when status changes (`preview` → `stable`, `seed only` → `in-progress`).

## Adapter-pattern invariants

Every adapter package (current and future) honors the same contract so a
junior who reads one adapter README can read any other and feel at home:

1. **Same `AegisContext` shape**: `{ verify, agentId, principalId, trustBand }`. No adapter renames these.
2. **Same option surface**: `client`, `tokenHeader`, `minTrustBand`, `deriveContext` at minimum. Adapters MAY add runtime-specific options but MUST NOT remove these.
3. **Same denial envelope**: `{ error, message, statusCode, requestId?, next? }`. Pulled from the shared error catalog ([packages/types/src/error-catalog.ts](../packages/types/src/error-catalog.ts)).
4. **Same trust-band rank**: `FLAGGED(0) < WATCH(1) < VERIFIED(2) < PLATINUM(3)`. Encoded inline because the constants are short — re-check this matches across packages when adding new adapters.
5. **Edge-safe by default**: an adapter that bundles for browser/edge/workers MUST NOT pull in Node-only deps. AWS Lambda is the explicit exception (Node runtime).
6. **README has the 30-second example**: every adapter's README opens with a single block of copy-paste TypeScript that demonstrates the core integration. No "see the docs site" placeholders.

## Round 26 candidate seeds (not yet created)

When the operator picks the next lane, these are the most natural follow-ups:

- **`@aegis/adapter-fastapi`** — Python equivalent of adapter-nextjs. Shape: `Depends(aegis_required(min_trust_band))`. Lives at [packages/adapter-fastapi/](packages/adapter-fastapi/) (NEW). Pairs with the Python SDK Lane A landing.
- **`@aegis/adapter-aws-kms`** — first KMS provider for the `KmsKeyStorage` Protocol. Imports `@aws-sdk/client-kms`. Lives at [packages/adapter-aws-kms/](packages/adapter-aws-kms/) (NEW).
- **`@aegis/adapter-gcp-kms`** — second KMS provider. Imports `@google-cloud/kms`.
- **`@aegis/adapter-vault`** — third KMS provider. Imports nothing beyond `fetch` (Vault Transit is REST).
- **`@aegis/adapter-express`** — extracted from the CLI bootstrap template ([packages/cli/cmd/bootstrap.go expressMiddlewareTemplate](../packages/cli/cmd/bootstrap.go)). Promotes the inlined middleware to a published package.
- **`@aegis/adapter-django`** — Django middleware (`AegisVerificationMiddleware`). Pairs with the Python SDK.

## Cross-cutting Round 26 work (no new seed needed)

These are referenced in [docs/SESSION_HANDOFF.md](SESSION_HANDOFF.md) Round 25 candidates list and don't require a seed file:

- `aegis bootstrap` more frameworks (remix, sveltekit, django, rails).
- `aegis doctor --fix` integration with the error catalog `next` field.
- OpenAPI sync for Round 24's `/v1/audit-events` + `stripeTrialEndsAt`.
- Adapter `tsup build` + npm publish (operator-credential gate).
- Real EU/APAC endpoint deployment (operator-infrastructure gate).

## Status index — at a glance

| Status | Meaning |
|---|---|
| `seed only` | Doc / plan exists; no code yet. Pick up: write code. |
| `preview` | Code + tests + README shipped; API surface locked. Pick up: deepen logic, ship to npm. |
| `stable` | Promoted from preview. Public API contract; semver applies. |

Every seed in this round is `preview` (TS adapters), `landed-in-SDK` (Python parity), or `seed only` (MCP audit doc).

## Known weaknesses (Round 25 ultrathink audit)

These are the 12 weaknesses surfaced by the Round 25 supplement audit
that were NOT fixed in the supplement. Each is tracked here with severity,
the fix-shape, and the Round 26+ candidate that should pick it up.

| ID | Severity | Description | Fix shape | Round 26+ candidate |
|---|---|---|---|---|
| W1 | Medium | Adapter tests only cover happy + denial; no concurrency / replay / memory-leak coverage. | Add a `k6` or `autocannon` load script under `tests/load/adapters/`; assert no memory growth across 10k iterations. | Load-test lane |
| W2 | Medium | "Edge-safe" adapters tested under Node, not real Cloudflare/Vercel runtimes. | Add a `wrangler dev` smoke test for adapter-cloudflare-workers; deploy adapter-vercel-edge to a preview project. | Real-runtime e2e lane |
| W4 | Low | Python `quickstart.py` has a race window between `storage.get(name)` and `storage.put(name, ...)`. | Add an `asyncio.Lock` keyed by `name` in `_resolve_or_generate_keypair`; document concurrent-call semantics. | Python SDK hardening |
| W5 | Low | Error catalog `next` field is locked to English; no i18n story. | Add a per-locale override map keyed by `(code, locale)`; default to English; surface via `Aegis.locale()` setter. | i18n lane (future) |
| W6 | Medium | No customer-journey e2e covering `trial_will_end` webhook → conversion banner → upgrade. | Extend `tests/e2e/customer-journey.spec.ts` with a Stripe-trial fixture sequence. | Round 24 follow-up |
| W7 | Medium | Adapter packages have no instrumentation hooks (latency / denial-rate counters). | Add an optional `metrics: AegisMetrics` option to every adapter; expose `recordVerifyLatency`, `recordDenial(reason)`. | Observability lane |
| W8 | Low | `KmsKeyStorage` Protocol shipped with no concrete impl — juniors see the type but no reference. | Ship `packages/adapter-aws-kms` (already listed as Round 26 candidate above). | First KMS provider lane |
| W9 | Medium | MCP drift audit doc names F-MCP-001..010 from memory; findings unverified. | Round 26 executes the investigation method in [MCP_DRIFT_AUDIT.md](MCP_DRIFT_AUDIT.md). | MCP drift resolution |
| W11 | Low | No version coordination across packages (adapter-nextjs `0.1.0`, others `0.1.0-preview`, Python unversioned). | Pin all adapter packages to `0.1.0-preview`; bump Python SDK to `0.2.0` for Lane A additions. | Operator publish step |
| W12 | Medium | No single "start here" doc; junior arriving cold has 6+ READMEs. | Write `docs/START_HERE.md` with the canonical 3-link path: pricing → SDK README → adapter for your framework. | Documentation lane |
| W13 | Low | Catalog renderer (`generate-error-catalog.ts`) silently drops new `ErrorCatalogEntry` fields if the renderer functions don't enumerate them. | Add a renderer self-test: parse the source interface and assert every field appears in both `renderTs` and `renderPy`. | Catalog hardening |
| **Audit method itself** | n/a | This audit was prose-only; no automated check ensures future rounds get a similar audit. | Add an `ultrathink.md` template in `docs/` that future operators / sessions can fill in after a multi-lane round. | Process lane |

The three **High**-severity weaknesses (W3, W10, W14) are fixed in this
supplement. See [docs/SESSION_HANDOFF.md](SESSION_HANDOFF.md) Round 25
supplement-ultrathink-fixes entry for the diffs.

## See also

- [docs/SESSION_HANDOFF.md](SESSION_HANDOFF.md) — chronological log; latest entry is Round 25
- [docs/MCP_DRIFT_AUDIT.md](MCP_DRIFT_AUDIT.md) — the one seed that's documentation-only
- [WORK_BOARD.md](../WORK_BOARD.md) — claimable modules across the whole repo
- [OPERATOR_DECISIONS.md](../OPERATOR_DECISIONS.md) — pending operator decisions that gate some of the cross-cutting work
