#!/usr/bin/env tsx
/**
 * AEGIS Doctor — ground-truth orientation in 5 seconds.
 *
 * Why this exists:
 * Multiple parallel sessions rapidly evolve this codebase (R15/R16/R17
 * shipped in the same calendar day). Hand-maintained docs (WORK_BOARD,
 * PARALLEL_SESSIONS_v2, SESSION_HANDOFF) drift from code state within
 * hours. Doctor reads code state directly so the next agent starts
 * with current truth, not a 2-hour-stale plan.
 *
 * Defaults to fast mode (file-read only, sub-second). Pass `--full`
 * to also run tsc + jest + parity (≈30s).
 *
 * Usage:
 *   pnpm doctor               # fast mode
 *   pnpm doctor --full        # also runs tsc + tests
 *
 * Exit codes:
 *   0 — fast mode always; full mode if all green
 *   1 — full mode found a tsc / test / parity failure
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FULL = process.argv.includes('--full');

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function ok(s: string): string {
  return `${C.green}✓${C.reset} ${s}`;
}
function warn(s: string): string {
  return `${C.yellow}⚠${C.reset} ${s}`;
}
function bad(s: string): string {
  return `${C.red}✗${C.reset} ${s}`;
}
function header(s: string): void {
  console.log(`\n${C.bold}${C.cyan}${s}${C.reset}`);
}

function safeExec(cmd: string, cwd = REPO_ROOT): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

let exitCode = 0;

// ─────────────────────────────────────────────────────────────────
// 1. Git state
// ─────────────────────────────────────────────────────────────────
header('Git state');
const branch = safeExec('git rev-parse --abbrev-ref HEAD') || '(detached)';
const lastCommit = safeExec('git log -1 --format=%h\\ %s\\ %cr');
const modifiedCount = safeExec('git status --short | wc -l').trim();
const untrackedCount = safeExec('git status --short | grep -c "^??"').trim();
console.log(`  branch:        ${C.bold}${branch}${C.reset}`);
console.log(`  last commit:   ${lastCommit}`);
console.log(`  modified:      ${modifiedCount} files (${untrackedCount} untracked)`);
if (Number(modifiedCount) > 200) {
  console.log(`  ${warn('large uncommitted set — consider checkpoint commit before next round')}`);
}

// ─────────────────────────────────────────────────────────────────
// 2. Latest round
// ─────────────────────────────────────────────────────────────────
header('Latest round (from SESSION_HANDOFF.md)');
const handoff = safeRead(join(REPO_ROOT, 'docs', 'SESSION_HANDOFF.md'));
if (handoff) {
  const firstRoundMatch = handoff.match(/^## (\d{4}-\d{2}-\d{2}.*Round \d+.*)$/m);
  console.log(`  ${firstRoundMatch?.[1] ?? '(no round entry parsed)'}`);
} else {
  console.log(`  ${bad('SESSION_HANDOFF.md missing')}`);
}

// ─────────────────────────────────────────────────────────────────
// 3. Denial precedence canonical
// ─────────────────────────────────────────────────────────────────
header('Denial precedence (CLAUDE.md invariant 6)');
const constants = safeRead(join(REPO_ROOT, 'packages', 'types', 'src', 'constants.ts'));
if (constants) {
  const enumMatch = constants.match(/DENIAL_REASON_PRECEDENCE\s*=\s*\[([\s\S]*?)\]/);
  const reasons = enumMatch ? Array.from(enumMatch[1]!.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1]!) : [];
  const hasTrial = reasons.includes('TRIAL_EXHAUSTED');
  const hasPlanLimit = reasons.includes('PLAN_LIMIT_EXCEEDED');
  console.log(`  total reasons: ${reasons.length} (PLAN_LIMIT_EXCEEDED pre-gate + ${reasons.length - (hasPlanLimit ? 1 : 0)}-step chain)`);
  console.log(`  TRIAL_EXHAUSTED: ${hasTrial ? ok('present (ADR-0014)') : bad('MISSING')}`);
  if (!hasTrial) exitCode = 1;
} else {
  console.log(`  ${bad('packages/types/src/constants.ts missing')}`);
  exitCode = 1;
}

// ─────────────────────────────────────────────────────────────────
// 4. Error catalog
// ─────────────────────────────────────────────────────────────────
header('Error catalog (R16 / R17)');
const catalogTs = safeRead(join(REPO_ROOT, 'packages', 'types', 'src', 'error-catalog.generated.ts'));
const catalogPy = safeRead(join(REPO_ROOT, 'packages', 'sdk-py', 'aegis', 'error_catalog.py'));
// TS source: `code: 'snake_case'`; Py source: `"code": "snake_case"`
// (TypedDict dicts emitted by the generator). Both use the same JSON-ish
// shape; the count comes from the className-keyed entry rows.
const tsCount = catalogTs ? (catalogTs.match(/className:\s*['"]/g) ?? []).length || (catalogTs.match(/code:\s*['"]/g) ?? []).length : 0;
const pyCount = catalogPy ? (catalogPy.match(/"className":\s*"/g) ?? []).length : 0;
console.log(`  TS mirror: ${tsCount} entries  ${tsCount === 22 ? ok('') : warn('expected 22 (TrialExhaustedError + 21)')}`);
console.log(`  Py mirror: ${pyCount} entries  ${pyCount === tsCount ? ok('parity with TS') : bad('PARITY DRIFT')}`);
if (pyCount !== tsCount && tsCount > 0) exitCode = 1;

// ─────────────────────────────────────────────────────────────────
// 5. Postman collection
// ─────────────────────────────────────────────────────────────────
header('Postman collection');
const postmanRaw = safeRead(join(REPO_ROOT, 'tools', 'postman', 'aegis.collection.json'));
if (postmanRaw) {
  try {
    const pm = JSON.parse(postmanRaw) as { item?: unknown[] };
    let folders = 0;
    let leaves = 0;
    function walk(items: unknown[]): void {
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const node = it as { item?: unknown[]; request?: unknown };
        if (Array.isArray(node.item)) {
          folders += 1;
          walk(node.item);
        } else if (node.request) {
          leaves += 1;
        }
      }
    }
    walk(pm.item ?? []);
    const denialFolder = (pm.item ?? []).find(
      (i) => typeof i === 'object' && (i as { name?: string }).name === 'Denial Precedence Walk-through',
    ) as { item?: unknown[] } | undefined;
    const denialLeaves = denialFolder?.item?.length ?? 0;
    console.log(`  folders: ${folders}, leaf requests: ${leaves}`);
    console.log(`  denial walkthrough: ${denialLeaves} leaves  ${denialLeaves === 10 ? ok('matches 10-step chain') : warn('expected 10')}`);
  } catch {
    console.log(`  ${bad('JSON parse failed')}`);
    exitCode = 1;
  }
} else {
  console.log(`  ${warn('aegis.collection.json missing')}`);
}

// ─────────────────────────────────────────────────────────────────
// 6. Operator decisions
// ─────────────────────────────────────────────────────────────────
header('Operator decisions');
const od = safeRead(join(REPO_ROOT, 'OPERATOR_DECISIONS.md'));
if (od) {
  const open = (od.match(/\|\s*OPEN\s*\|/g) ?? []).length;
  const decided = (od.match(/\|\s*DECIDED\s*\|/g) ?? []).length;
  const reserved = (od.match(/\|\s*RESERVED\s*\|/g) ?? []).length;
  console.log(`  ${open} open / ${decided} decided / ${reserved} reserved`);
} else {
  console.log(`  ${warn('OPERATOR_DECISIONS.md missing')}`);
}

// ─────────────────────────────────────────────────────────────────
// 7. Discovery surface (existence by source, not HTTP)
// ─────────────────────────────────────────────────────────────────
header('Discovery surface (controller routes)');
const wellknown = safeRead(join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'wellknown', 'wellknown.controller.ts'));
if (wellknown) {
  const routes = Array.from(wellknown.matchAll(/@Get\(['"]([^'"]+)['"]\)/g)).map((m) => m[1]!);
  for (const route of routes) {
    console.log(`  ${ok(`/.well-known/${route}`)}`);
  }
  if (routes.length === 0) console.log(`  ${warn('no @Get routes found')}`);
} else {
  console.log(`  ${warn('wellknown.controller.ts missing')}`);
}

// ─────────────────────────────────────────────────────────────────
// 8. Optional deps state (KMS providers)
// ─────────────────────────────────────────────────────────────────
header('Optional deps');
const apiNm = join(REPO_ROOT, 'apps', 'api', 'node_modules');
const checkDep = (name: string): string => {
  try {
    statSync(join(apiNm, name));
    return ok(name);
  } catch {
    return `${C.dim}—${C.reset} ${name}`;
  }
};
console.log(`  ${checkDep('@aws-sdk/client-kms')}`);
console.log(`  ${checkDep('@google-cloud/kms')}`);
console.log(`  ${checkDep('@nestjs/schedule')}`);

// ─────────────────────────────────────────────────────────────────
// 9a. Peer-review regression guards (Round 19 findings)
// Each check encodes a real bug class caught by peer `bc67a785`
// in `docs/REVIEW_ROUND_1778026397.md`. Drift here = regressing
// a closed finding.
// ─────────────────────────────────────────────────────────────────
header('Peer-review regression guards (R19)');

// F-03 — `overagePerCallCents` was sub-cent units ($0.0008) which
// would have caused a 100× billing landmine if interpreted as cents
// by Stripe metering. Renamed to `overagePerCallE4` + `overageToCents()`
// helper. Any reappearance of the old name is a regression.
// Exclude `scripts/doctor.ts` itself — this file references the regression
// pattern in comments and the grep command, which would self-match.
const F03Hits = safeExec(
  `grep -rEn 'overagePerCallCents' apps packages tools tests scripts --include='*.ts' --include='*.tsx' --include='*.yaml' --exclude='doctor.ts' 2>/dev/null | wc -l`,
).trim();
const f03Count = Number(F03Hits) || 0;
if (f03Count === 0) {
  console.log(`  ${ok('F-03 overagePerCallCents drift: 0 hits (expected 0)')}`);
} else {
  console.log(`  ${bad(`F-03 REGRESSION: ${f03Count} hits of overagePerCallCents — should be 0`)}`);
  exitCode = 1;
}

// F-06 — `error.constructor.name` is a tsup-minifier landmine (collapses
// to single chars). Fix: `static readonly catalogKey = '<ClassName>'` on
// every AegisError subclass. Round 19 added it on 20 classes (11 server +
// 10 SDK). Coverage drift = silent retry-logic regression after minification.
const f06Hits = safeExec(
  `grep -rEn 'static (override )?readonly catalogKey' apps/api/src packages/sdk-ts/src packages/verifier-rp/src 2>/dev/null | wc -l`,
).trim();
const f06Count = Number(f06Hits) || 0;
if (f06Count >= 20) {
  console.log(`  ${ok(`F-06 catalogKey discriminator: ${f06Count} overrides (expected ≥20)`)}`);
} else {
  console.log(`  ${warn(`F-06 LOW COVERAGE: ${f06Count} catalogKey overrides — expected ≥20 (R19 baseline)`)}`);
  // Warn rather than fail: new SDKs added without F-06 coverage are a
  // soft signal, not necessarily a regression of existing code.
}

// F-08 — `FREE.monthlyVerifyQuota` MUST be `Number.POSITIVE_INFINITY`.
// Architectural invariant: UsageGuard short-circuits FREE so TrialService
// owns the lifetime cap. Reverting to a finite value would re-introduce
// the customer-facing "wait for next period" message on lifetime exhaustion.
const plansSrc = safeRead(join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'billing', 'plans.ts'));
if (plansSrc) {
  // Locate the FREE block, then within it the `monthlyVerifyQuota:` line.
  // Anchor on `\n\s+monthlyVerifyQuota:` so we match only the actual
  // property-assignment line, not the same identifier inside a `//` comment.
  // Comment lines start with `//` (not whitespace), so `\s+` won't traverse them.
  const freeBlockMatch = plansSrc.match(/FREE:\s*\{[\s\S]*?\n\s+monthlyVerifyQuota:\s*([^,\n]+)/);
  if (!freeBlockMatch) {
    console.log(`  ${bad('F-08 cannot locate FREE.monthlyVerifyQuota in plans.ts')}`);
    exitCode = 1;
  } else {
    const value = freeBlockMatch[1]!.trim();
    const isInfinity = /Number\.POSITIVE_INFINITY|Infinity/.test(value);
    if (isInfinity) {
      console.log(`  ${ok('F-08 FREE.monthlyVerifyQuota = Number.POSITIVE_INFINITY (TrialService is canonical FREE gate)')}`);
    } else {
      console.log(`  ${bad(`F-08 REGRESSION: FREE.monthlyVerifyQuota = ${value} — should be Number.POSITIVE_INFINITY`)}`);
      exitCode = 1;
    }
  }
} else {
  console.log(`  ${warn('F-08 cannot read plans.ts')}`);
}

// ─────────────────────────────────────────────────────────────────
// 9. Perf baseline + gate scripts
// ─────────────────────────────────────────────────────────────────
header('Perf + audit scripts');
console.log(`  perf-baseline.json:    ${existsSync(join(REPO_ROOT, 'apps', 'api', 'perf-baseline.json')) ? ok('present') : warn('missing — run pnpm bench:verify')}`);
console.log(`  audit:errors script:   ${existsSync(join(REPO_ROOT, 'scripts', 'audit-error-catalog.ts')) ? ok('present') : bad('missing')}`);
console.log(`  bench:verify script:   ${existsSync(join(REPO_ROOT, 'scripts', 'benchmark-verify.ts')) ? ok('present') : bad('missing')}`);
console.log(`  cross-package parity:  ${existsSync(join(REPO_ROOT, 'tests', 'vitest.parity.config.ts')) ? ok('config wired (R18 W-I.2)') : bad('config missing')}`);

// ─────────────────────────────────────────────────────────────────
// 10. Full mode — actually run the gates
// ─────────────────────────────────────────────────────────────────
if (FULL) {
  header('Full mode — running gates (≈30s)');
  const gates: Array<{ name: string; cmd: string }> = [
    { name: 'tsc @aegis/api', cmd: 'pnpm --filter @aegis/api exec tsc --noEmit' },
    { name: 'tsc @aegis/types', cmd: 'pnpm --filter @aegis/types exec tsc --noEmit' },
    { name: 'tsc @aegis/verifier-rp', cmd: 'pnpm --filter @aegis/verifier-rp exec tsc --noEmit' },
    { name: 'audit:errors', cmd: 'pnpm --filter @aegis/scripts run audit:errors' },
    { name: 'cross-package parity', cmd: 'pnpm --filter @aegis/e2e run test:parity' },
    { name: 'postman validator', cmd: 'pnpm --filter @aegis/postman exec vitest run' },
  ];
  for (const g of gates) {
    process.stdout.write(`  ${g.name}: `);
    try {
      execSync(g.cmd, { cwd: REPO_ROOT, stdio: 'ignore', timeout: 120_000 });
      console.log(C.green + 'PASS' + C.reset);
    } catch {
      console.log(C.red + 'FAIL' + C.reset);
      exitCode = 1;
    }
  }
}

console.log();
if (exitCode === 0) {
  console.log(`${C.green}${C.bold}AEGIS doctor: green${C.reset}${FULL ? ' (full)' : ' (fast — pass --full to gate)'}`);
} else {
  console.log(`${C.red}${C.bold}AEGIS doctor: ${exitCode === 1 ? 'issues found' : 'failed'}${C.reset}`);
}
process.exit(exitCode);
