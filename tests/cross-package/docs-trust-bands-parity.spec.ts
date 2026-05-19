import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRUST_BAND_THRESHOLDS } from '@aegis/types';

// Cross-package parity gate for @aegis/docs <TrustBandLegend/>.
//
// Why: the band thresholds are wire-facing — policies reference them via
// scope.minimumTrustBand, and relying parties may inspect agents' bands
// for risk routing. A docs page that hard-codes 750 / 500 / 250 / 0 would
// silently drift if the operator ever retunes the thresholds.

const COMPONENT_PATH = join(
  __dirname,
  '..',
  '..',
  'apps',
  'docs',
  'components',
  'live',
  'trust-band-legend.tsx',
);

describe('docs ↔ @aegis/types trust band parity', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');

  it('imports TRUST_BAND_THRESHOLDS from @aegis/types', () => {
    expect(source).toMatch(/from\s+['"]@aegis\/types['"]/);
    expect(source).toContain('TRUST_BAND_THRESHOLDS');
  });

  it('does not redeclare TRUST_BAND_THRESHOLDS locally', () => {
    const inlinePattern = /(?:const|let|var)\s+TRUST_BAND_THRESHOLDS\s*=/;
    expect(inlinePattern.test(source)).toBe(false);
  });

  it('has BAND_META entries for every band in the wire constant', () => {
    for (const band of Object.keys(TRUST_BAND_THRESHOLDS)) {
      expect(source).toContain(band);
    }
  });

  it('wire constant exposes the four expected bands', () => {
    const bands = Object.keys(TRUST_BAND_THRESHOLDS).sort();
    expect(bands).toEqual(['FLAGGED', 'PLATINUM', 'VERIFIED', 'WATCH']);
  });
});
