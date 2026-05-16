// tests/scenarios/run.ts — scenario runner.
//
// Discovers scenarios via static import, runs each against a fresh
// harness, captures assertions + duration, emits a Bloomberg-density
// pass/fail report. Exit code = total failure count.
//
// Invocation:
//   pnpm --filter @aegis/e2e exec tsx scenarios/run.ts
//   # or after `cd tests/`:
//   npx tsx scenarios/run.ts

import { AssertCtx, AssertionError } from './lib/assert';
import { buildHarness, type Scenario, type ScenarioResult } from './lib/harness';

import scenario01 from './scenarios/01-fintech-acp-payment';
import scenario02 from './scenarios/02-treasury-rar-per-day-cap';
import scenario03 from './scenarios/03-broker-dealer-trading-hours';
import scenario04 from './scenarios/04-mcp-per-tool-denial';
import scenario05 from './scenarios/05-bate-trust-decay';
import scenario06 from './scenarios/06-multi-tenant-isolation';
import scenario07 from './scenarios/07-audit-chain-tamper';
import scenario08 from './scenarios/08-intent-reconciliation';

const SCENARIOS: Scenario[] = [
  scenario01, scenario02, scenario03, scenario04,
  scenario05, scenario06, scenario07, scenario08,
];

// ── Terminal colors (no deps; opt-out via NO_COLOR env) ──────────────
const C = process.env.NO_COLOR ? {
  bold: '', dim: '', reset: '', green: '', red: '', yellow: '', blue: '', magenta: '',
} : {
  bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m',
};

const HR = '─'.repeat(76);

function hms(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function runOne(scenario: Scenario): Promise<ScenarioResult> {
  const { ctx } = await buildHarness();
  const assertCtx = new AssertCtx();
  const t0 = performance.now();
  try {
    await scenario.run(ctx, assertCtx);
    return {
      scenario,
      pass: true,
      assertions: assertCtx.log.slice(),
      durationMs: Math.round(performance.now() - t0),
    };
  } catch (err) {
    const isAssert = err instanceof AssertionError;
    return {
      scenario,
      pass: false,
      assertions: assertCtx.log.slice(),
      durationMs: Math.round(performance.now() - t0),
      error: isAssert ? err.message : (err as Error).stack ?? String(err),
    };
  }
}

function printHeader(): void {
  console.log(`${C.bold}AEGIS scenario harness — production-realistic verify path${C.reset}`);
  console.log(`${C.dim}${hms()} · ${SCENARIOS.length} scenarios · @noble/ed25519 real crypto${C.reset}`);
  console.log(HR);
}

function printScenario(idx: number, result: ScenarioResult): void {
  const { scenario: s, pass, assertions, durationMs, error } = result;
  const tag = pass ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`;
  const passed = assertions.filter((a) => a.pass).length;
  const total = assertions.length;

  console.log(
    `${tag} ${C.bold}${s.id}${C.reset} ${s.name}` +
      `${C.dim}  [${s.vertical} · ${s.layers.join('+')} · ${durationMs}ms · ${passed}/${total} assertions]${C.reset}`,
  );

  if (!pass) {
    if (error) {
      console.log(`  ${C.red}error:${C.reset} ${error.split('\n')[0]}`);
    }
    const failed = assertions.find((a) => !a.pass);
    if (failed) {
      console.log(`  ${C.red}failed assertion:${C.reset} ${failed.name}`);
      if (failed.detail) console.log(`  ${C.dim}detail: ${failed.detail}${C.reset}`);
    }
  }
}

function printFooter(results: ScenarioResult[]): number {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const totalAssertions = results.reduce((sum, r) => sum + r.assertions.length, 0);
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(HR);
  console.log(
    `${failed === 0 ? C.green : C.red}${C.bold}${passed}/${results.length} scenarios passed${C.reset}` +
      `${C.dim}  ·  ${totalAssertions} assertions across ${totalMs}ms wall-clock${C.reset}`,
  );

  // Per-vertical breakdown
  const byVertical: Map<string, { p: number; f: number }> = new Map();
  for (const r of results) {
    const v = r.scenario.vertical;
    const cur = byVertical.get(v) ?? { p: 0, f: 0 };
    if (r.pass) cur.p++; else cur.f++;
    byVertical.set(v, cur);
  }
  const verticalBars = Array.from(byVertical.entries())
    .map(([v, { p, f }]) => `${v}: ${C.green}${p}${C.reset}/${p + f}`)
    .join('  ·  ');
  console.log(`${C.dim}${verticalBars}${C.reset}`);

  if (failed > 0) {
    console.log(`${C.red}${C.bold}${failed} failure(s).${C.reset} Inspect output above for details.`);
  } else {
    console.log(`${C.green}All scenarios green. Re-run: ${C.dim}npx tsx scenarios/run.ts${C.reset}`);
  }
  console.log(HR);

  return failed;
}

async function main(): Promise<number> {
  printHeader();
  const results: ScenarioResult[] = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    const result = await runOne(SCENARIOS[i]!);
    results.push(result);
    printScenario(i, result);
  }
  return printFooter(results);
}

main()
  .then((failures) => {
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('Runner crashed:', err);
    process.exit(2);
  });
