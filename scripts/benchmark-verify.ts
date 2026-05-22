#!/usr/bin/env -S node --import=tsx
/**
 * OKORO — `pnpm bench:verify` — verify hot-path latency baseline.
 *
 * Issues N concurrent verify requests against a running OKORO API, captures
 * per-request latency, and emits exact percentiles (p50/p95/p99/p99.9) plus
 * a PASS/FAIL line per percentile vs the SLO targets in
 * `apps/api/src/modules/billing/plans.ts`.
 *
 * Style mirrors `scripts/seed-demo.ts` (CLI surface + structural Prisma
 * pattern) and `scripts/audit-verify-chain.ts` (testable helpers, then a
 * thin `main()` that only runs when invoked directly).
 *
 * REQUIREMENTS
 *   - The demo seed (`pnpm seed:demo`) must be loaded so Maria's API key +
 *     `maria/checkout-bot` agent exist.
 *   - The API must be reachable at `--api-url` (default `http://localhost:3000`).
 *
 * USAGE
 *   pnpm --filter @okoro/scripts bench:verify \
 *     --api-key  okoro_sk_xxx \
 *     --concurrency 20 --total 5000 \
 *     --output    apps/api/perf-baseline.json
 *
 * EXIT CODES
 *   0  every percentile met its SLO target for the FREE tier (Maria's plan).
 *   1  at least one percentile missed its SLO target.
 *   2  CLI usage error or no API key supplied.
 *
 * NOTES
 *   - Stats math is numerically exact (sort-and-index quantile, no
 *     floating-point interpolation, no Math.random in stat math).
 *   - `--warmup` requests are issued first and excluded from stats so JIT /
 *     connection-pool warm-up isn't counted as user-visible latency.
 *   - The script uses `fetch`; no NestJS bootstrap, no Prisma. It's
 *     intentionally something an SRE can run from a laptop against any
 *     OKORO deployment that exposes `/v1/verify`.
 */

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { argv, env, exit, stderr, stdout } from 'node:process';

import { Command, Option } from 'commander';

// ──────────────────────────────────────────────────────────────────
// SLO targets — kept in lockstep with apps/api/src/modules/billing/plans.ts.
//
// We replicate (rather than import) so this script stays standalone and
// doesn't pull NestJS / Prisma into the type-check graph. The unit test
// asserts the numbers match the source-of-truth for FREE tier (the Maria
// persona plan) — if plans.ts changes, the spec fails fast.
// ──────────────────────────────────────────────────────────────────

export interface SloTarget {
  readonly p50_ms: number;
  readonly p95_ms: number;
  readonly p99_ms: number;
}

export const SLO_TARGETS: Readonly<Record<'FREE' | 'DEVELOPER' | 'GROWTH' | 'ENTERPRISE', SloTarget>> = Object.freeze({
  FREE: { p50_ms: 100, p95_ms: 200, p99_ms: 250 },
  DEVELOPER: { p50_ms: 80, p95_ms: 150, p99_ms: 200 },
  GROWTH: { p50_ms: 50, p95_ms: 100, p99_ms: 120 },
  ENTERPRISE: { p50_ms: 30, p95_ms: 60, p99_ms: 80 },
});

// ──────────────────────────────────────────────────────────────────
// Pure stat math — covered by the spec.
// ──────────────────────────────────────────────────────────────────

export interface LatencyStats {
  count: number;
  errorCount: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  p999_ms: number;
  min_ms: number;
  max_ms: number;
}

/**
 * Numerically exact percentile via sort-and-index. NOT linear-interpolation;
 * we want a value that actually appeared in the dataset (or `NaN` if empty).
 *
 * Index formula: `ceil(p * n) - 1`, clamped to `[0, n-1]`. This matches the
 * "nearest-rank" definition used by most ops dashboards. For p=0 we return
 * the minimum; for p=1 the maximum.
 */
export function quantile(sortedAsc: ReadonlyArray<number>, p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  if (p <= 0) return sortedAsc[0]!;
  if (p >= 1) return sortedAsc[sortedAsc.length - 1]!;
  const idx = Math.ceil(p * sortedAsc.length) - 1;
  const clamped = Math.max(0, Math.min(sortedAsc.length - 1, idx));
  return sortedAsc[clamped]!;
}

export function computeStats(latenciesMs: ReadonlyArray<number>, errorCount: number): LatencyStats {
  if (latenciesMs.length === 0) {
    return {
      count: 0,
      errorCount,
      mean_ms: Number.NaN,
      p50_ms: Number.NaN,
      p95_ms: Number.NaN,
      p99_ms: Number.NaN,
      p999_ms: Number.NaN,
      min_ms: Number.NaN,
      max_ms: Number.NaN,
    };
  }
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    errorCount,
    mean_ms: sum / sorted.length,
    p50_ms: quantile(sorted, 0.5),
    p95_ms: quantile(sorted, 0.95),
    p99_ms: quantile(sorted, 0.99),
    p999_ms: quantile(sorted, 0.999),
    min_ms: sorted[0]!,
    max_ms: sorted[sorted.length - 1]!,
  };
}

export interface SloCompliance {
  tier: keyof typeof SLO_TARGETS;
  pass: boolean;
  rows: ReadonlyArray<{
    percentile: 'p50' | 'p95' | 'p99';
    observed_ms: number;
    target_ms: number;
    pass: boolean;
  }>;
}

export function evaluateSlo(stats: LatencyStats, tier: keyof typeof SLO_TARGETS): SloCompliance {
  const target = SLO_TARGETS[tier];
  const rows = [
    { percentile: 'p50' as const, observed_ms: stats.p50_ms, target_ms: target.p50_ms },
    { percentile: 'p95' as const, observed_ms: stats.p95_ms, target_ms: target.p95_ms },
    { percentile: 'p99' as const, observed_ms: stats.p99_ms, target_ms: target.p99_ms },
  ].map((r) => ({ ...r, pass: Number.isFinite(r.observed_ms) && r.observed_ms <= r.target_ms }));
  return { tier, pass: rows.every((r) => r.pass), rows };
}

// ──────────────────────────────────────────────────────────────────
// Concurrency helper — bounded parallelism over a fixed task set.
//
// We run `concurrency` slots; each slot pulls the next index from a shared
// counter and awaits the worker. This produces a faithful steady-state
// load profile (one in flight per slot) without the thundering herd of
// `Promise.all([...all-N])`.
// ──────────────────────────────────────────────────────────────────

export async function runBoundedConcurrency<T>(
  total: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  if (total < 0 || !Number.isFinite(total)) throw new Error(`total must be a non-negative finite integer (got ${total})`);
  if (concurrency < 1 || !Number.isFinite(concurrency)) {
    throw new Error(`concurrency must be a positive integer (got ${concurrency})`);
  }
  const slots = Math.max(1, Math.min(concurrency, Math.max(1, total)));
  const results = new Array<T>(total);
  let next = 0;

  async function slotLoop(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results[i] = await worker(i);
    }
  }

  const slotPromises: Promise<void>[] = [];
  for (let s = 0; s < slots; s++) slotPromises.push(slotLoop());
  await Promise.all(slotPromises);
  return results;
}

// ──────────────────────────────────────────────────────────────────
// Verify request shape — matches the seeded persona's policy. We send the
// `token` field as an empty string because Maria's seed policy doesn't
// pre-mint an agent JWT; the API will respond with INVALID_SIGNATURE in
// that case which is fine for *latency* baselining (we want the hot-path
// time, not policy approval).
//
// If the operator wants APPROVED-path latency, they can plug a signed token
// via `--token`. For the baseline run we measure the real round-trip cost
// of an authenticated, validated request hitting the verify pipeline.
// ──────────────────────────────────────────────────────────────────

export interface VerifyAttemptResult {
  index: number;
  ok: boolean;
  latency_ms: number;
  status: number | null;
  error?: string;
}

export interface DoOneVerifyArgs {
  apiUrl: string;
  apiKey: string;
  agentId: string;
  token: string;
  fetchImpl: typeof fetch;
  now: () => number;
}

/**
 * Single verify request. Captures latency around `await fetch` regardless
 * of HTTP status; only network/transport errors set `ok=false`. A 4xx that
 * comes back fast is still a real measurement of the hot path.
 */
export async function doOneVerify(idx: number, args: DoOneVerifyArgs): Promise<VerifyAttemptResult> {
  const body = JSON.stringify({
    token: args.token,
    action: 'stripe.charge',
    amount: 12.5,
    currency: 'USD',
    merchantId: args.agentId,
    context: { benchIdx: idx },
  });
  const t0 = args.now();
  try {
    const res = await args.fetchImpl(`${args.apiUrl.replace(/\/$/, '')}/v1/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-okoro-api-key': args.apiKey,
      },
      body,
    });
    const t1 = args.now();
    return { index: idx, ok: true, latency_ms: t1 - t0, status: res.status };
  } catch (err) {
    const t1 = args.now();
    return {
      index: idx,
      ok: false,
      latency_ms: t1 - t0,
      status: null,
      error: (err as Error).message,
    };
  }
}

// ──────────────────────────────────────────────────────────────────
// Bench orchestration — testable, takes injected fetch + clock.
// ──────────────────────────────────────────────────────────────────

export interface BenchOptions {
  apiUrl: string;
  apiKey: string;
  agentId: string;
  token: string;
  total: number;
  warmup: number;
  concurrency: number;
  /** Tier to compare against; defaults to FREE (Maria's seeded plan). */
  tier: keyof typeof SLO_TARGETS;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface BenchResult {
  startedAt: string;
  finishedAt: string;
  options: Omit<BenchOptions, 'apiKey' | 'fetchImpl' | 'now'> & { apiKey: '<redacted>' };
  stats: LatencyStats;
  slo: SloCompliance;
  warmupDiscarded: number;
  warmupErrorCount: number;
}

export async function runBench(opts: BenchOptions): Promise<BenchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? performance.now.bind(performance);
  const startedAt = new Date().toISOString();

  const sharedArgs: DoOneVerifyArgs = {
    apiUrl: opts.apiUrl,
    apiKey: opts.apiKey,
    agentId: opts.agentId,
    token: opts.token,
    fetchImpl,
    now,
  };

  // ── Warmup pass — discarded from stats. ─────────────────────────
  let warmupErrorCount = 0;
  if (opts.warmup > 0) {
    const warmupResults = await runBoundedConcurrency(opts.warmup, opts.concurrency, (i) =>
      doOneVerify(i, sharedArgs),
    );
    warmupErrorCount = warmupResults.filter((r) => !r.ok).length;
  }

  // ── Measured pass. ──────────────────────────────────────────────
  const measured = await runBoundedConcurrency(opts.total, opts.concurrency, (i) =>
    doOneVerify(i + opts.warmup, sharedArgs),
  );
  const errorCount = measured.filter((r) => !r.ok).length;
  const latencies = measured.filter((r) => r.ok).map((r) => r.latency_ms);
  const stats = computeStats(latencies, errorCount);
  const slo = evaluateSlo(stats, opts.tier);
  const finishedAt = new Date().toISOString();

  return {
    startedAt,
    finishedAt,
    options: {
      apiUrl: opts.apiUrl,
      apiKey: '<redacted>',
      agentId: opts.agentId,
      token: opts.token,
      total: opts.total,
      warmup: opts.warmup,
      concurrency: opts.concurrency,
      tier: opts.tier,
    },
    stats,
    slo,
    warmupDiscarded: opts.warmup,
    warmupErrorCount,
  };
}

// ──────────────────────────────────────────────────────────────────
// Human-readable rendering.
// ──────────────────────────────────────────────────────────────────

export function renderHumanTable(result: BenchResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(' OKORO verify hot-path benchmark');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`  api          : ${result.options.apiUrl}`);
  lines.push(`  agent        : ${result.options.agentId}`);
  lines.push(`  total        : ${result.options.total} (warmup ${result.options.warmup} discarded)`);
  lines.push(`  concurrency  : ${result.options.concurrency}`);
  lines.push(`  tier         : ${result.options.tier}`);
  lines.push('');
  lines.push(`  count        : ${result.stats.count}`);
  lines.push(`  errors       : ${result.stats.errorCount}`);
  lines.push(`  mean         : ${formatMs(result.stats.mean_ms)}`);
  lines.push(`  min          : ${formatMs(result.stats.min_ms)}`);
  lines.push(`  p50          : ${formatMs(result.stats.p50_ms)}`);
  lines.push(`  p95          : ${formatMs(result.stats.p95_ms)}`);
  lines.push(`  p99          : ${formatMs(result.stats.p99_ms)}`);
  lines.push(`  p99.9        : ${formatMs(result.stats.p999_ms)}`);
  lines.push(`  max          : ${formatMs(result.stats.max_ms)}`);
  lines.push('');
  lines.push(`  SLO (${result.slo.tier}):`);
  for (const row of result.slo.rows) {
    const tag = row.pass ? 'PASS' : 'FAIL';
    lines.push(
      `    [${tag}] ${row.percentile.padEnd(4, ' ')} observed=${formatMs(row.observed_ms)}  target=${formatMs(row.target_ms)}`,
    );
  }
  lines.push('');
  lines.push(`  OVERALL: ${result.slo.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  return lines.join('\n');
}

function formatMs(v: number): string {
  if (!Number.isFinite(v)) return 'n/a';
  return `${v.toFixed(2).padStart(8, ' ')} ms`;
}

// ──────────────────────────────────────────────────────────────────
// CLI entry.
// ──────────────────────────────────────────────────────────────────

interface CliOpts {
  concurrency: string;
  total: string;
  apiUrl: string;
  apiKey?: string;
  agentId: string;
  warmup: string;
  output?: string;
  tier: 'FREE' | 'DEVELOPER' | 'GROWTH' | 'ENTERPRISE';
  token: string;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('benchmark-verify')
    .description('Latency baseline for the OKORO /v1/verify hot path against a running API.')
    .addOption(new Option('--concurrency <n>', 'in-flight requests').default('10'))
    .addOption(new Option('--total <n>', 'measured request count (excludes warmup)').default('1000'))
    .addOption(new Option('--api-url <url>', 'OKORO API base URL').default(env.OKORO_API_URL ?? 'http://localhost:3000'))
    .addOption(new Option('--api-key <key>', 'principal API key (or set OKORO_API_KEY)'))
    .addOption(new Option('--agent-id <id>', 'agent label to verify against').default('maria/checkout-bot'))
    .addOption(new Option('--warmup <n>', 'warmup requests, discarded from stats').default('100'))
    .addOption(new Option('--output <path>', 'write JSON result to this path for diffing'))
    .addOption(
      new Option('--tier <tier>', 'SLO tier to evaluate against')
        .choices(['FREE', 'DEVELOPER', 'GROWTH', 'ENTERPRISE'])
        .default('FREE'),
    )
    .addOption(
      new Option('--token <jwt>', 'agent-signed JWT to send (defaults to empty string for hot-path-only timing)').default(
        '',
      ),
    );

  try {
    program.parse(argv);
  } catch (err) {
    stderr.write(`usage error: ${(err as Error).message}\n`);
    exit(2);
  }
  const opts = program.opts<CliOpts>();

  const apiKey = opts.apiKey ?? env.OKORO_API_KEY;
  if (!apiKey) {
    stderr.write('--api-key (or OKORO_API_KEY env) is required\n');
    exit(2);
  }

  const total = Number.parseInt(opts.total, 10);
  const concurrency = Number.parseInt(opts.concurrency, 10);
  const warmup = Number.parseInt(opts.warmup, 10);

  if (!Number.isFinite(total) || total < 0) {
    stderr.write(`--total must be a non-negative integer (got ${opts.total})\n`);
    exit(2);
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    stderr.write(`--concurrency must be a positive integer (got ${opts.concurrency})\n`);
    exit(2);
  }
  if (!Number.isFinite(warmup) || warmup < 0) {
    stderr.write(`--warmup must be a non-negative integer (got ${opts.warmup})\n`);
    exit(2);
  }

  const result = await runBench({
    apiUrl: opts.apiUrl,
    apiKey,
    agentId: opts.agentId,
    token: opts.token,
    total,
    warmup,
    concurrency,
    tier: opts.tier,
  });

  stdout.write(renderHumanTable(result));
  // JSON tail (single line, last) — easy to grep/diff in CI logs.
  stdout.write(`${JSON.stringify(result)}\n`);

  if (opts.output) {
    await writeFile(opts.output, JSON.stringify(result, null, 2) + '\n', 'utf8');
    stderr.write(`wrote ${opts.output}\n`);
  }

  exit(result.slo.pass ? 0 : 1);
}

const isMain =
  argv[1] !== undefined &&
  (argv[1].endsWith('benchmark-verify.ts') || argv[1].endsWith('benchmark-verify.js'));

if (isMain) {
  main().catch((err) => {
    stderr.write(`fatal: ${(err as Error).message}\n`);
    exit(1);
  });
}
