// Cross-package parity — DENIAL_REASON_PRECEDENCE (canonical, types pkg)
// vs. DENIAL_REASONS (generated, sdk-ts pkg).
//
// The server-side precedence tuple in `packages/types/src/constants.ts` is
// the single source of truth for the order top-wins denials are evaluated.
// The TS SDK ships its own copy of the union so relying parties can switch
// exhaustively. `scripts/generate-denial-reason.ts` keeps them in lockstep
// — this spec is the gate that catches drift before CI gets there.

import { describe, expect, it } from 'vitest';

import { DENIAL_REASON_PRECEDENCE } from '../../packages/types/src/constants';
import { DENIAL_REASONS } from '../../packages/sdk-ts/src/denial-reason.generated';

describe('denial-reason cross-package parity', () => {
  it('SDK DENIAL_REASONS equals canonical DENIAL_REASON_PRECEDENCE (same order, same length)', () => {
    expect([...DENIAL_REASONS]).toEqual([...DENIAL_REASON_PRECEDENCE]);
  });

  it('every canonical reason is present in the SDK', () => {
    for (const r of DENIAL_REASON_PRECEDENCE) {
      expect(DENIAL_REASONS).toContain(r);
    }
  });

  it('SDK reasons contain no extras not in the canonical tuple', () => {
    for (const r of DENIAL_REASONS) {
      expect(DENIAL_REASON_PRECEDENCE as readonly string[]).toContain(r);
    }
  });

  it('the generated file has no duplicates', () => {
    const set = new Set(DENIAL_REASONS);
    expect(set.size).toBe(DENIAL_REASONS.length);
  });
});
