// Self-tests for the preflight orchestrator at tools/preflight/preflight.ts.
//
// These lock the tool's exit-code policy, check registry shape, and CLI flag
// parsing. The full check execution is covered by the live preflight runs in
// CI; here we lock behavior that doesn't depend on filesystem state.

import { describe, expect, it } from 'vitest';

import {
  CHECKS,
  computeExitCode,
  parseFlags,
  tally,
  type CompletedCheck,
} from '../../tools/preflight/preflight';

describe('preflight tool', () => {
  describe('CHECKS registry', () => {
    it('has at least the round-15+ check ids', () => {
      const ids = new Set(CHECKS.map((c) => c.id));
      // Required IDs (round 15+ surfaces). Adding more is fine; removing is a contract change.
      const required = [
        'stack-signature',
        'peer-claims',
        'tsc-api',
        'lint-api',
        'migration-immutability',
        'error-catalog-audit',
        'env-vars',
        'operator-decisions',
        'optional-kms-provider',
        'perf-baseline-freshness',
        'architecture-drift',
        'alert-runbook-parity',
        'webhook-cipher-wired',
        'adr-0014-cascade',
      ];
      for (const id of required) {
        expect(ids, `missing required check id: ${id}`).toContain(id);
      }
    });

    it('every check id is unique', () => {
      const ids = CHECKS.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every check has the required shape', () => {
      for (const c of CHECKS) {
        expect(c.id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(c.label.length).toBeGreaterThan(0);
        expect(['gating', 'warning', 'info']).toContain(c.category);
        expect(typeof c.fastSafe).toBe('boolean');
        expect(typeof c.run).toBe('function');
      }
    });

    it('gating checks list (locks the exit-2 surface)', () => {
      // Gating checks are the ones that block ship on fail. Any change to
      // this list is a contract change with operations — review accordingly.
      const gating = CHECKS.filter((c) => c.category === 'gating').map((c) => c.id).sort();
      expect(gating).toEqual([
        'alert-runbook-parity',
        'cross-package-parity',
        'error-catalog-audit',
        'lint-api',
        'migration-immutability',
        'tsc-api',
        'webhook-cipher-wired',
      ]);
    });
  });

  describe('parseFlags', () => {
    it('defaults are off', () => {
      const f = parseFlags([]);
      expect(f).toEqual({ fast: false, json: false, skip: new Set(), prod: false });
    });

    it('--fast / --json / --prod flip booleans', () => {
      expect(parseFlags(['--fast']).fast).toBe(true);
      expect(parseFlags(['--json']).json).toBe(true);
      expect(parseFlags(['--prod']).prod).toBe(true);
    });

    it('--only=a,b builds a Set', () => {
      const f = parseFlags(['--only=tsc-api,lint-api']);
      expect(f.only).toEqual(new Set(['tsc-api', 'lint-api']));
    });

    it('--skip=a,b builds a Set', () => {
      const f = parseFlags(['--skip=peer-claims']);
      expect(f.skip).toEqual(new Set(['peer-claims']));
    });

    it('handles --only with empty trailing comma', () => {
      const f = parseFlags(['--only=tsc-api,']);
      expect(f.only).toEqual(new Set(['tsc-api']));
    });
  });

  describe('tally', () => {
    it('counts by status', () => {
      const results = [
        mk('a', 'gating', 'pass'),
        mk('b', 'gating', 'pass'),
        mk('c', 'warning', 'warn'),
        mk('d', 'gating', 'fail'),
        mk('e', 'info', 'skip'),
      ];
      expect(tally(results)).toEqual({ pass: 2, warn: 1, fail: 1, skip: 1, total: 5 });
    });

    it('returns all-zero on empty', () => {
      expect(tally([])).toEqual({ pass: 0, warn: 0, fail: 0, skip: 0, total: 0 });
    });
  });

  describe('computeExitCode', () => {
    it('all pass → 0', () => {
      expect(computeExitCode([mk('a', 'gating', 'pass'), mk('b', 'warning', 'pass')])).toBe(0);
    });

    it('any warning-status → 1', () => {
      expect(computeExitCode([mk('a', 'gating', 'pass'), mk('b', 'warning', 'warn')])).toBe(1);
    });

    it('warning-category fail → 1 (do not gate the ship)', () => {
      expect(computeExitCode([mk('a', 'gating', 'pass'), mk('b', 'warning', 'fail')])).toBe(1);
    });

    it('gating fail → 2 (DO NOT SHIP)', () => {
      expect(computeExitCode([mk('a', 'gating', 'fail'), mk('b', 'warning', 'pass')])).toBe(2);
    });

    it('gating fail wins over warnings', () => {
      expect(computeExitCode([mk('a', 'gating', 'fail'), mk('b', 'warning', 'warn')])).toBe(2);
    });

    it('skip alone is non-gating → 0', () => {
      expect(computeExitCode([mk('a', 'gating', 'skip'), mk('b', 'info', 'skip')])).toBe(0);
    });

    it('info-category never gates', () => {
      expect(computeExitCode([mk('a', 'info', 'fail')])).toBe(0);
    });
  });
});

function mk(id: string, category: CompletedCheck['category'], status: CompletedCheck['status']): CompletedCheck {
  return { id, label: id, category, status, elapsedMs: 0 };
}
