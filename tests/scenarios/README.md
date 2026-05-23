# `tests/scenarios/` — production-realistic AEGIS scenarios

Eight enterprise vertical scenarios exercising the full AEGIS verify path with real `@noble/ed25519` cryptography, real canonical-JSON serialization, and the documented denial precedence from `CLAUDE.md §6`.

This directory lives within the `@aegis/e2e` workspace package (`tests/`) but is invoked as a standalone runner, not via vitest. The output is a Bloomberg-density pass/fail report captured in [`SCENARIO_RESULTS.md`](./SCENARIO_RESULTS.md) on every run.

## Why scenarios beat unit tests for procurement

A SOC 2 auditor asks: *"How do you know your product works for fintech payments?"*

- A unit test says: *"`verifyPayment()` returns the expected denial reason."*
- A scenario says: *"`01-fintech-acp-payment.ts` exercises an agent signing an ACP-compatible payment intent at $99 under a $1000-bound policy, AEGIS verifies VALID with trustScore ≥ 600, and the audit chain appends one signed row that verifies offline. Last pass: 2026-05-16T13:32:50Z."*

The scenario IS the evidence. The file name + description + pass timestamp is what gets surfaced to a customer's compliance team.

## What's in this directory

| Path | Purpose |
|---|---|
| `lib/crypto.ts` | `@noble/ed25519` v2 wrappers + canonical JSON |
| `lib/assert.ts` | Bloomberg-density `expect` helpers (no test-framework dep) |
| `lib/harness.ts` | In-memory AEGIS state machine implementing CLAUDE.md §6 denial precedence + RFC 9396 RAR + intent manifest |
| `scenarios/01..08-*.ts` | One scenario per file, each exports `default: Scenario` |
| `run.ts` | Standalone runner — discovers scenarios via static import, executes sequentially with fresh context, emits Bloomberg report |
| `SCENARIO_RESULTS.md` | Append-only run log; newest at top |

## Running

```sh
# From repo root, using the apps/api tsx binary (memory: this is the working invocation):
apps/api/node_modules/.bin/tsx tests/scenarios/run.ts

# Or from tests/:
cd tests
npx tsx scenarios/run.ts

# CI / NO_COLOR-friendly:
NO_COLOR=1 apps/api/node_modules/.bin/tsx tests/scenarios/run.ts
```

Exit codes:
- `0` — all scenarios pass
- `1` — at least one scenario failed (count printed in footer)
- `2` — runner crashed (not a scenario failure — bug in the runner itself)

## Adding a scenario

1. Create `scenarios/NN-name.ts` exporting a `Scenario` object (see existing files for shape).
2. Add the import + array entry in `run.ts`.
3. Run the harness; if it fails, fix; iterate.
4. Append a new entry at the top of `SCENARIO_RESULTS.md` with the new total.

The `Scenario` contract (from `lib/harness.ts`):

```typescript
export interface Scenario {
  id: string;
  name: string;
  vertical: 'fintech' | 'treasury' | 'broker-dealer' | 'banking' | 'ai-platform' | 'saas' | 'cross-cutting';
  description: string;       // The procurement-evidence paragraph
  layers: ReadonlyArray<'L1' | 'L2' | 'L3' | 'L4' | 'intent' | 'mcp'>;
  run: (ctx: ScenarioContext, assert: AssertCtx) => Promise<void>;
}
```

## What the harness is and is not

**Is:**
- A production-realistic exercise of the verify-shape contract
- A repeatable artifact a procurement team can re-run on demand
- A regression gate for the documented denial precedence
- A surface where peers can land scenarios that exercise new features (intent manifest, RAR, etc.)

**Is not:**
- A replacement for `tests/cross-package/` parity tests (those exercise the wire shape vs `apps/api/`)
- A replacement for `tests/load/` k6 scripts (load + chaos)
- A replacement for `tests/e2e/` black-box tests (full HTTP transport)
- A replacement for `pnpm test:parity` (canonical contract gate)

It is **complementary** — the integration narrative that the other test surfaces cannot easily express.

## Coordination with peers

When a peer lands new product surface (e.g. peer 115e12ee's intent manifest, peer bf9d6030's RFC-9396 RAR), the appropriate response is a new scenario file in this directory exercising the new surface. The peer or anyone else may claim `aegis:coord-scenarios-NN` to add a scenario; the claim is small (one file + a runner array entry + a SCENARIO_RESULTS.md update).

See `docs/SWARM_ORCHESTRATION.md` for the broader peer coordination protocol.
