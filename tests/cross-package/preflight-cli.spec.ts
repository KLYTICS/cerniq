// CLI integration tests for tools/preflight/preflight.ts.
//
// Complements preflight-tool.spec.ts (unit tests on exported internals)
// by exercising the actual wire-level CLI: spawn the binary, parse output,
// assert exit codes. Locks the contract that operators and CI consume.
//
// Uses --only to restrict to fast, side-effect-free checks. Heavy checks
// (vitest, lint, tsc) are covered by the live `make preflight` runs.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const PREFLIGHT = join(REPO_ROOT, 'tools', 'preflight', 'preflight.ts');
// pnpm hoists the tsx binary to a shared `.pnpm/node_modules/.bin/tsx`.
// Resolving via this path keeps the test independent of which workspace's
// node_modules ran `pnpm install`.
const TSX = join(REPO_ROOT, 'node_modules', '.pnpm', 'node_modules', '.bin', 'tsx');

beforeAll(() => {
  // Sanity: if either the tool or tsx is missing, every test below would
  // fail confusingly. Fail fast with a clear cause.
  if (!existsSync(PREFLIGHT)) throw new Error(`preflight tool missing: ${PREFLIGHT}`);
  if (!existsSync(TSX)) throw new Error(`tsx binary missing: ${TSX}`);
});

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: readonly string[], timeoutMs = 30_000): RunResult {
  const r = spawnSync(TSX, [PREFLIGHT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: r.status ?? (r.signal ? 124 : 1),
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('preflight CLI', () => {
  describe('--help', () => {
    it('exits 0 and prints help text', () => {
      const r = run(['--help']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('OKORO preflight');
      expect(r.stdout).toContain('--fast');
      expect(r.stdout).toContain('--json');
      expect(r.stdout).toContain('--only');
      expect(r.stdout).toContain('--skip');
      expect(r.stdout).toContain('--prod');
    });
  });

  describe('--json', () => {
    it('produces valid JSON with required envelope shape', () => {
      const r = run(['--json', '--only=stack-signature']);
      expect([0, 1, 2]).toContain(r.status);
      const parsed = JSON.parse(r.stdout);
      expect(parsed).toMatchObject({
        version: '1',
        timestamp: expect.any(String),
        exitCode: expect.any(Number),
        result: expect.stringMatching(/^(pass|warn|fail)$/),
        totalMs: expect.any(Number),
        summary: expect.objectContaining({
          pass: expect.any(Number),
          warn: expect.any(Number),
          fail: expect.any(Number),
          skip: expect.any(Number),
          total: expect.any(Number),
        }),
        checks: expect.any(Array),
      });
    });

    it('every check in the array has required fields', () => {
      const r = run(['--json', '--only=stack-signature,peer-claims']);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.checks.length).toBeGreaterThan(0);
      for (const c of parsed.checks) {
        expect(c).toMatchObject({
          id: expect.any(String),
          label: expect.any(String),
          category: expect.stringMatching(/^(gating|warning|info)$/),
          status: expect.stringMatching(/^(pass|warn|fail|skip)$/),
          elapsedMs: expect.any(Number),
        });
      }
    });

    it('summary counts equal the number of checks', () => {
      const r = run(['--json', '--fast']);
      const parsed = JSON.parse(r.stdout);
      const sum = parsed.summary.pass + parsed.summary.warn + parsed.summary.fail + parsed.summary.skip;
      expect(sum).toBe(parsed.summary.total);
      expect(sum).toBe(parsed.checks.length);
    });
  });

  describe('--only', () => {
    it('restricts the run to the named check ids', () => {
      const r = run(['--json', '--only=stack-signature']);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.checks).toHaveLength(1);
      expect(parsed.checks[0].id).toBe('stack-signature');
    });

    it('accepts multiple ids comma-separated', () => {
      const r = run(['--json', '--only=stack-signature,peer-claims']);
      const parsed = JSON.parse(r.stdout);
      const ids = parsed.checks.map((c: { id: string }) => c.id).sort();
      expect(ids).toEqual(['peer-claims', 'stack-signature']);
    });
  });

  describe('--skip', () => {
    it('excludes named check ids from the run', () => {
      const r = run(['--json', '--fast', '--skip=adr-0014-cascade']);
      const parsed = JSON.parse(r.stdout);
      const ids = parsed.checks.map((c: { id: string }) => c.id);
      expect(ids).not.toContain('adr-0014-cascade');
      expect(ids.length).toBeGreaterThan(1);
    });
  });

  describe('error handling', () => {
    it('exits 3 on unknown flag', () => {
      const r = run(['--bogus']);
      expect(r.status).toBe(3);
      expect(r.stderr.toLowerCase()).toContain('unknown flag');
    });

    it('exits 3 when --only filters to nothing', () => {
      const r = run(['--only=nonexistent-check-id']);
      expect(r.status).toBe(3);
      expect(r.stderr.toLowerCase()).toContain('no checks selected');
    });
  });

  describe('exit-code policy (locks the contract)', () => {
    it('all-info checks → exit 0', () => {
      // stack-signature + peer-claims are both info — neither can fail-gate.
      const r = run(['--json', '--only=stack-signature,peer-claims']);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).result).toBe('pass');
    });
  });
});
