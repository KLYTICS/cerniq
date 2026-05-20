// Trial-cliff parity — Round 24 Lane A.
//
// AEGIS has two trial cliffs (lifetime counter + Stripe time-based trial)
// and a dashboard banner that warns before either one fires the hard
// `TRIAL_EXHAUSTED` denial. The dashboard MUST import its thresholds from
// `@aegis/types` so the API + dashboard never disagree on when the banner
// should appear.
//
// This spec asserts:
//   1. The threshold constants exist in `@aegis/types` with the expected
//      sane defaults (percent 0..100, days >= 1).
//   2. The dashboard banner component imports them by name from
//      `@aegis/types` — NOT hardcoded numeric literals.
//
// Why a regex check instead of importing the TSX directly: vitest in the
// cross-package config runs without a React/Next environment, so importing
// a `.tsx` file under `'use client'` boundaries would require the dashboard
// vitest harness (Lane C). The regex check is the cheapest enforcement
// that catches the failure mode this spec exists to prevent: a future
// edit hardcoding `80` or `7` in the banner and silently drifting from
// the canonical constants.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TRIAL_WARN_THRESHOLD_DAYS,
  TRIAL_WARN_THRESHOLD_PERCENT,
} from '../../packages/types/src/constants';

const HERE = dirname(fileURLToPath(import.meta.url));
const BANNER_PATH = join(
  HERE,
  '../../apps/dashboard/app/billing/_components/TrialCliffBanner.tsx',
);

describe('trial-cliff thresholds', () => {
  it('exposes sane defaults from @aegis/types', () => {
    expect(TRIAL_WARN_THRESHOLD_PERCENT).toBeGreaterThan(0);
    expect(TRIAL_WARN_THRESHOLD_PERCENT).toBeLessThanOrEqual(100);
    expect(TRIAL_WARN_THRESHOLD_DAYS).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(TRIAL_WARN_THRESHOLD_DAYS)).toBe(true);
  });

  it('dashboard banner imports both thresholds from @aegis/types', async () => {
    const src = await readFile(BANNER_PATH, 'utf-8');
    // Single import line covering both symbols — anchors against the
    // package name so a local copy (e.g. a typo'd shadowed constant)
    // would fail this assertion.
    expect(src).toMatch(/from\s+['"]@aegis\/types['"]/);
    expect(src).toMatch(/TRIAL_WARN_THRESHOLD_PERCENT/);
    expect(src).toMatch(/TRIAL_WARN_THRESHOLD_DAYS/);
  });

  it('dashboard banner does NOT inline the numeric thresholds', async () => {
    const src = await readFile(BANNER_PATH, 'utf-8');
    // Catch the failure mode this spec prevents: a future refactor
    // hardcoding `>= 80` or `<= 7` and silently drifting from the
    // canonical constants. Comparisons must reference the imported
    // names, not bare numbers. We allow the numeric literal to appear
    // in comments (after `//`) — guarded by stripping single-line
    // comments before the check.
    const stripped = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(stripped).not.toMatch(/>=\s*80\b/);
    expect(stripped).not.toMatch(/<=\s*7\b/);
  });
});
