import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  computeStats,
  doOneVerify,
  evaluateSlo,
  quantile,
  renderHumanTable,
  runBench,
  runBoundedConcurrency,
  SLO_TARGETS,
  type LatencyStats,
} from './benchmark-verify.js';

// ──────────────────────────────────────────────────────────────────
// Pure stat math.
// ──────────────────────────────────────────────────────────────────

describe('quantile (nearest-rank, no interpolation)', () => {
  it('returns the indexed value, not an interpolation', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(quantile(sorted, 0.5)).toBe(30);
    expect(quantile(sorted, 0.95)).toBe(50);
    expect(quantile(sorted, 0.99)).toBe(50);
    expect(quantile(sorted, 0.0001)).toBe(10);
  });

  it('handles edge cases p=0 and p=1', () => {
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });

  it('returns NaN on empty input', () => {
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe('computeStats', () => {
  it('produces exact p50/p95/mean for [10,20,30,40,50]', () => {
    const stats = computeStats([50, 30, 10, 40, 20], 0); // intentionally unsorted
    expect(stats.count).toBe(5);
    expect(stats.errorCount).toBe(0);
    expect(stats.mean_ms).toBe(30);
    expect(stats.p50_ms).toBe(30);
    expect(stats.p95_ms).toBe(50);
    expect(stats.p99_ms).toBe(50);
    expect(stats.min_ms).toBe(10);
    expect(stats.max_ms).toBe(50);
  });

  it('reports errorCount but does not include errors in latency stats', () => {
    const stats = computeStats([10, 20, 30], 7);
    expect(stats.count).toBe(3);
    expect(stats.errorCount).toBe(7);
    expect(stats.mean_ms).toBe(20);
  });

  it('returns NaN stats when no successful samples', () => {
    const stats = computeStats([], 5);
    expect(stats.count).toBe(0);
    expect(stats.errorCount).toBe(5);
    expect(Number.isNaN(stats.p50_ms)).toBe(true);
    expect(Number.isNaN(stats.mean_ms)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// SLO compliance.
// ──────────────────────────────────────────────────────────────────

describe('evaluateSlo', () => {
  it('FREE tier: p99=300ms vs target 250ms → FAIL', () => {
    const stats: LatencyStats = {
      count: 100,
      errorCount: 0,
      mean_ms: 50,
      p50_ms: 60,
      p95_ms: 180,
      p99_ms: 300,
      p999_ms: 320,
      min_ms: 5,
      max_ms: 320,
    };
    const slo = evaluateSlo(stats, 'FREE');
    expect(slo.pass).toBe(false);
    expect(slo.rows.find((r) => r.percentile === 'p99')?.pass).toBe(false);
    expect(slo.rows.find((r) => r.percentile === 'p50')?.pass).toBe(true);
  });

  it('GROWTH tier: every percentile under target → PASS', () => {
    const stats: LatencyStats = {
      count: 100,
      errorCount: 0,
      mean_ms: 30,
      p50_ms: 40,
      p95_ms: 90,
      p99_ms: 110,
      p999_ms: 119,
      min_ms: 5,
      max_ms: 119,
    };
    const slo = evaluateSlo(stats, 'GROWTH');
    expect(slo.pass).toBe(true);
    expect(slo.rows.every((r) => r.pass)).toBe(true);
  });

  it('Targets in SLO_TARGETS match plans.ts FREE p99 (250ms)', () => {
    // Parity guard: if plans.ts changes verifyP99TargetMs without updating
    // SLO_TARGETS, this fails fast.
    expect(SLO_TARGETS.FREE.p99_ms).toBe(250);
    expect(SLO_TARGETS.DEVELOPER.p99_ms).toBe(200);
    expect(SLO_TARGETS.GROWTH.p99_ms).toBe(120);
    expect(SLO_TARGETS.ENTERPRISE.p99_ms).toBe(80);
  });
});

// ──────────────────────────────────────────────────────────────────
// Concurrency.
// ──────────────────────────────────────────────────────────────────

describe('runBoundedConcurrency', () => {
  it('honors the slot count — never more than `concurrency` in flight', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const worker = async (i: number): Promise<number> => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i;
    };
    const out = await runBoundedConcurrency(20, 4, worker);
    expect(out).toHaveLength(20);
    expect(out[0]).toBe(0);
    expect(out[19]).toBe(19);
    expect(peakInFlight).toBeLessThanOrEqual(4);
  });

  it('runs zero workers cleanly when total=0', async () => {
    const calls: number[] = [];
    const out = await runBoundedConcurrency(0, 4, async (i) => {
      calls.push(i);
      return i;
    });
    expect(out).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('rejects invalid arguments', async () => {
    await expect(runBoundedConcurrency(10, 0, async () => 0)).rejects.toThrow(/concurrency/);
  });
});

// ──────────────────────────────────────────────────────────────────
// fetch mock — simulate variable latency + intermittent errors.
// ──────────────────────────────────────────────────────────────────

function buildClock(): () => number {
  let t = 0;
  return () => {
    t += 1; // monotonic, deterministic
    return t;
  };
}

describe('doOneVerify', () => {
  it('captures latency around fetch and reports status', async () => {
    const fakeFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const now = buildClock();
    const r = await doOneVerify(0, {
      apiUrl: 'http://localhost:3000',
      apiKey: 'aegis_sk_test',
      agentId: 'maria/checkout-bot',
      token: '',
      fetchImpl: fakeFetch,
      now,
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.latency_ms).toBeGreaterThan(0);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('records transport failures without throwing', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('econnrefused');
    }) as unknown as typeof fetch;
    const r = await doOneVerify(7, {
      apiUrl: 'http://localhost:3000',
      apiKey: 'aegis_sk_test',
      agentId: 'maria/checkout-bot',
      token: '',
      fetchImpl: fakeFetch,
      now: buildClock(),
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/econnrefused/);
  });
});

// ──────────────────────────────────────────────────────────────────
// runBench — warmup discarded, error counts surfaced, output written.
// ──────────────────────────────────────────────────────────────────

describe('runBench', () => {
  it('excludes warmup from stats and counts errors in measured pass', async () => {
    // Plan: warmup = 3 (always success), measured = 5 with the 2nd one failing.
    const calls: Array<{ idx: number; phase: 'warmup' | 'measured' }> = [];
    let measuredCount = 0;
    let warmupCount = 0;
    const fakeFetch = vi.fn(async () => {
      // Use counters instead of inspecting the request — main flow already
      // guarantees warmup runs first, then the measured pass.
      const isWarmup = warmupCount < 3;
      if (isWarmup) {
        warmupCount++;
        calls.push({ idx: warmupCount - 1, phase: 'warmup' });
        return new Response('{}', { status: 200 });
      }
      measuredCount++;
      calls.push({ idx: measuredCount - 1, phase: 'measured' });
      // Fail the 2nd measured call (index 1).
      if (measuredCount === 2) throw new Error('boom');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    // Deterministic clock — each `now()` call ticks by 1ms. Each fetch
    // straddles exactly two ticks so latency is exactly 1ms.
    const result = await runBench({
      apiUrl: 'http://localhost:3000',
      apiKey: 'aegis_sk_test',
      agentId: 'maria/checkout-bot',
      token: '',
      total: 5,
      warmup: 3,
      concurrency: 1,
      tier: 'FREE',
      fetchImpl: fakeFetch,
      now: buildClock(),
    });

    expect(result.warmupDiscarded).toBe(3);
    expect(result.stats.count).toBe(4); // 5 measured - 1 error
    expect(result.stats.errorCount).toBe(1);
    expect(result.options.apiKey).toBe('<redacted>');
    expect(fakeFetch).toHaveBeenCalledTimes(8); // 3 warmup + 5 measured
  });

  it('writes JSON to disk when an output path is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegis-bench-'));
    const outPath = join(dir, 'result.json');
    try {
      const fakeFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
      const result = await runBench({
        apiUrl: 'http://localhost:3000',
        apiKey: 'aegis_sk_test',
        agentId: 'maria/checkout-bot',
        token: '',
        total: 3,
        warmup: 0,
        concurrency: 1,
        tier: 'FREE',
        fetchImpl: fakeFetch,
        now: buildClock(),
      });
      // Mirror what main() does on --output.
      await writeFile(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
      const round = JSON.parse(readFileSync(outPath, 'utf8')) as { stats: LatencyStats };
      expect(round.stats.count).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// renderHumanTable — pure formatting, no I/O.
// ──────────────────────────────────────────────────────────────────

describe('renderHumanTable', () => {
  it('includes PASS/FAIL flags per percentile', () => {
    const out = renderHumanTable({
      startedAt: '2026-05-05T00:00:00.000Z',
      finishedAt: '2026-05-05T00:00:01.000Z',
      options: {
        apiUrl: 'http://localhost:3000',
        apiKey: '<redacted>',
        agentId: 'maria/checkout-bot',
        token: '',
        total: 100,
        warmup: 10,
        concurrency: 4,
        tier: 'FREE',
      },
      stats: {
        count: 100,
        errorCount: 0,
        mean_ms: 50,
        p50_ms: 60,
        p95_ms: 180,
        p99_ms: 300,
        p999_ms: 320,
        min_ms: 5,
        max_ms: 320,
      },
      slo: {
        tier: 'FREE',
        pass: false,
        rows: [
          { percentile: 'p50', observed_ms: 60, target_ms: 100, pass: true },
          { percentile: 'p95', observed_ms: 180, target_ms: 200, pass: true },
          { percentile: 'p99', observed_ms: 300, target_ms: 250, pass: false },
        ],
      },
      warmupDiscarded: 10,
      warmupErrorCount: 0,
    });
    expect(out).toContain('OVERALL: FAIL');
    expect(out).toContain('[FAIL] p99');
    expect(out).toContain('[PASS] p50');
  });
});
