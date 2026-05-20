/**
 * Structured run-report shape consumed by the continuous-e2e workflow.
 *
 * Two roles:
 *
 *   1. Library (imported by funnel.spec.ts) — `recordStep` returns a typed
 *      record the spec accumulates and prints to stdout in afterAll.
 *   2. CLI (`tsx run-report.ts`) — parses the vitest output piped on stdin,
 *      extracts the `__E2E_CONTINUOUS_REPORT__<json>__END__` line, validates
 *      the shape, and emits canonical JSON on stdout for the workflow's
 *      "publish to gh-pages" step.
 *
 * Why a sentinel-delimited line instead of a JSON file: the spec runs inside
 * vitest which captures stdout into its reporter; writing a real file would
 * need a fixed path that conflicts with parallel job runs. The sentinel
 * pattern is robust to vitest reporter noise.
 */

export type StepStatus = 'ok' | 'fail' | 'skipped';

export interface StepRecord {
  /** Step name — must match the documented funnel step IDs (landing, pricing_discovery, …). */
  name: string;
  status: StepStatus;
  /** Latency in milliseconds; 0 for skipped steps. */
  latencyMs: number;
  /** Failure message (when status='fail') or skip reason (when status='skipped'). */
  detail?: string;
}

export interface RunReport {
  runId: string;
  /** ISO timestamp at the END of the run (afterAll). */
  timestamp: string;
  baseUrl: string;
  syntheticPrincipal: string;
  skipped: string | null;
  steps: StepRecord[];
  overall: 'ok' | 'fail' | 'skipped';
}

const SENTINEL = '__E2E_CONTINUOUS_REPORT__';
const SENTINEL_END = '__END__';

export function recordStep(
  name: string,
  status: StepStatus,
  latencyMs: number,
  detail?: string,
): StepRecord {
  const rec: StepRecord = { name, status, latencyMs: Math.round(latencyMs) };
  if (detail !== undefined) rec.detail = detail;
  return rec;
}

/**
 * Pull the JSON report out of arbitrary vitest stdout. Returns null if no
 * sentinel line is found (used by the workflow to detect malformed runs).
 */
export function extractReport(stdout: string): RunReport | null {
  const lines = stdout.split('\n');
  for (const line of lines) {
    const startIdx = line.indexOf(SENTINEL);
    if (startIdx === -1) continue;
    const endIdx = line.indexOf(SENTINEL_END, startIdx);
    if (endIdx === -1) continue;
    const payload = line.slice(startIdx + SENTINEL.length, endIdx);
    try {
      const parsed = JSON.parse(payload) as RunReport;
      if (
        typeof parsed.runId === 'string' &&
        Array.isArray(parsed.steps) &&
        (parsed.overall === 'ok' || parsed.overall === 'fail' || parsed.overall === 'skipped')
      ) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * CLI entry. Reads vitest stdout from stdin, emits canonical JSON.
 *
 *   vitest run | tsx run-report.ts > report.json
 *
 * Exits 1 if no report sentinel was found — that's a real bug (the spec's
 * afterAll didn't run), not a funnel failure.
 */
async function main(): Promise<void> {
  let stdin = '';
  for await (const chunk of process.stdin) {
    stdin += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  }
  const report = extractReport(stdin);
  if (!report) {
    process.stderr.write('run-report: no sentinel line found in stdin\n');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

// import.meta.url check — only run main() when executed directly.
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main().catch((err: unknown) => {
    process.stderr.write(`run-report: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
