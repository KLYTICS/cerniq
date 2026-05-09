// Unit tests for generate-denial-reason.
//
// The generator must be deterministic (byte-equal output across runs for
// identical input) so the committed `denial-reason.generated.ts` does not
// churn diffs. We test the pure `renderTs` function — file I/O is a thin
// shell over it.

import { describe, it, expect } from 'vitest';
import { renderTs } from './generate-denial-reason.js';

describe('generate-denial-reason / renderTs', () => {
  it('emits a // @generated header and DENIAL_REASONS array', () => {
    const out = renderTs(['A', 'B']);
    expect(out.startsWith('// @generated')).toBe(true);
    expect(out).toContain('export const DENIAL_REASONS = [');
    expect(out).toContain('"A",');
    expect(out).toContain('"B",');
    expect(out).toContain(
      'export type DenialReason = (typeof DENIAL_REASONS)[number];',
    );
  });

  it('preserves precedence order exactly (does NOT sort)', () => {
    const out = renderTs(['Z', 'A', 'M']);
    const idxZ = out.indexOf('"Z"');
    const idxA = out.indexOf('"A"');
    const idxM = out.indexOf('"M"');
    expect(idxZ).toBeGreaterThan(0);
    expect(idxA).toBeGreaterThan(idxZ);
    expect(idxM).toBeGreaterThan(idxA);
  });

  it('is deterministic — same input → byte-equal output', () => {
    const input = ['PLAN_LIMIT_EXCEEDED', 'AGENT_NOT_FOUND', 'TRIAL_EXHAUSTED'];
    const a = renderTs(input);
    const b = renderTs(input);
    expect(a).toBe(b);
  });

  it('terminates with a trailing newline (POSIX text-file convention)', () => {
    const out = renderTs(['X']);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('JSON.stringify-quotes each reason (escapes correctly)', () => {
    const out = renderTs(['NORMAL', 'WITH"QUOTE']);
    // JSON.stringify of WITH"QUOTE is "WITH\"QUOTE"
    expect(out).toContain('"WITH\\"QUOTE"');
  });
});
