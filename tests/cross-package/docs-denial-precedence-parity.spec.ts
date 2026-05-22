import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Import from source path, not package alias — @okoro/types points to dist/
// which is not built at parity-test time. Matches the pattern used by
// existing parity specs (e.g. denial-reason-parity.spec.ts).
import { DENIAL_REASON_PRECEDENCE } from '../../packages/types/src/constants';

// Cross-package parity gate for @okoro/docs.
//
// Why: a future contributor will be tempted to copy DENIAL_REASON_PRECEDENCE
// into MDX as a static table for "rendering speed" or "readability". That
// silently re-introduces the drift class Round 23 retired for pricing —
// the docs would show a stale order, and relying-party SDKs that build retry
// logic on that order would then ship broken behavior.
//
// This test fails the build when the docs component:
//   (a) stops importing from @okoro/types, or
//   (b) re-declares DENIAL_REASON_PRECEDENCE inline, or
//   (c) drops a reason that exists in the wire contract.

const COMPONENT_PATH = join(
  __dirname,
  '..',
  '..',
  'apps',
  'docs',
  'components',
  'live',
  'denial-precedence.tsx',
);

describe('docs ↔ @okoro/types denial precedence parity', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');

  it('imports DENIAL_REASON_PRECEDENCE from @okoro/types', () => {
    expect(source).toMatch(/from\s+['"]@okoro\/types['"]/);
    expect(source).toContain('DENIAL_REASON_PRECEDENCE');
  });

  it('does not redeclare DENIAL_REASON_PRECEDENCE locally', () => {
    const inlineArrayPattern = /(?:const|let|var)\s+DENIAL_REASON_PRECEDENCE\s*=/;
    expect(inlineArrayPattern.test(source)).toBe(false);
  });

  it('has human-readable copy for every reason in the wire contract', () => {
    for (const reason of DENIAL_REASON_PRECEDENCE) {
      expect(source).toContain(reason);
    }
  });

  it('the wire contract itself has at least the eleven reasons documented in CLAUDE.md', () => {
    expect(DENIAL_REASON_PRECEDENCE.length).toBeGreaterThanOrEqual(11);
  });
});
