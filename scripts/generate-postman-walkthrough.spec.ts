// Unit tests for generate-postman-walkthrough.
//
// The generator must:
//   1. produce byte-identical output across re-runs for identical input
//      (idempotency — what makes `check:postman-walkthrough-gen` load-
//      bearing in CI),
//   2. cover all 11 current denial reasons (PLAN_LIMIT_EXCEEDED excluded,
//      INTENT_MISMATCH appended per ADR-0016),
//   3. emit INTENT_MISMATCH via /v1/intent/{id}/actuals + assert on
//      `recommendedDenialReason` (per ADR-0017 D3 — Phase 2 dual-endpoint
//      surface), not via /v1/verify.
//
// File I/O is exercised by the round-trip test; pure rendering is
// exercised by direct calls to `renderEntry` / `renderItems`.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { DENIAL_REASON_PRECEDENCE } from '@aegis/types';

import {
  renderEntry,
  renderItems,
  spliceCollection,
} from './generate-postman-walkthrough.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const COLLECTION_PATH = resolve(
  REPO_ROOT,
  'tools/postman/aegis.collection.json',
);

const ALGORITHM_REASONS = DENIAL_REASON_PRECEDENCE.filter(
  (r) => r !== 'PLAN_LIMIT_EXCEEDED',
);

describe('generate-postman-walkthrough / renderItems', () => {
  it('is deterministic — same input yields byte-equal output', () => {
    const a = renderItems(DENIAL_REASON_PRECEDENCE);
    const b = renderItems(DENIAL_REASON_PRECEDENCE);
    expect(a).toBe(b);
  });

  it('emits exactly one entry per canonical reason (excluding PLAN_LIMIT_EXCEEDED)', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    // Count entry opening braces at the canonical 8-space indent. Each
    // entry begins with a line `        {` so the count of those lines
    // equals the entry count.
    const openCount = out.split('\n').filter((l) => l === '        {').length;
    expect(openCount).toBe(ALGORITHM_REASONS.length);
    // Sanity: we're not silently dropping reasons.
    expect(ALGORITHM_REASONS.length).toBe(DENIAL_REASON_PRECEDENCE.length - 1);
  });

  it('omits PLAN_LIMIT_EXCEEDED as a walk-through entry (pre-algorithm billing gate)', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    // No entry title should be `N. PLAN_LIMIT_EXCEEDED` — the reason
    // is allowed to appear inside descriptive prose (e.g. the
    // TRIAL_EXHAUSTED entry contrasts the two), but never as a leaf
    // request. The validator checks count + per-entry naming; this
    // test mirrors that contract from the generator side.
    expect(out).not.toMatch(/"\d+\. PLAN_LIMIT_EXCEEDED"/);
  });

  it('preserves canonical precedence order (positions 1..N match the tuple)', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    let cursor = 0;
    for (let i = 0; i < ALGORITHM_REASONS.length; i++) {
      const reason = ALGORITHM_REASONS[i];
      if (!reason) continue;
      const needle = `"${i + 1}. ${reason}"`;
      const idx = out.indexOf(needle, cursor);
      expect(idx, `expected ${needle} after cursor ${cursor}`).toBeGreaterThan(
        cursor - 1,
      );
      cursor = idx;
    }
  });

  it('every algorithm reason has its name embedded in the entry title', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    for (const reason of ALGORITHM_REASONS) {
      expect(out).toContain(`. ${reason}"`);
    }
  });
});

describe('generate-postman-walkthrough / per-reason entry shape', () => {
  it('verify-path entries (positions 1-10) POST to /v1/verify with X-AEGIS-Verify-Key', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    const verifyReasons = ALGORITHM_REASONS.filter(
      (r) => r !== 'INTENT_MISMATCH',
    );
    // Each verify-path entry contributes one occurrence of the `/v1/verify`
    // URL line. We count to make sure none of them silently lost the URL.
    const verifyUrlHits = out.split('"{{base_url}}/v1/verify"').length - 1;
    expect(verifyUrlHits).toBe(verifyReasons.length);
    // And the verify-key header should appear at least once per verify
    // entry (key+value rendered inline as one line each).
    const verifyHeaderHits =
      out.split('"key": "X-AEGIS-Verify-Key"').length - 1;
    expect(verifyHeaderHits).toBe(verifyReasons.length);
  });

  it('INTENT_MISMATCH hits /v1/intent/{manifest_id}/actuals — not /v1/verify (ADR-0017 D3)', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    // Find the INTENT_MISMATCH entry boundary.
    const entryStart = out.indexOf('"11. INTENT_MISMATCH"');
    expect(entryStart).toBeGreaterThan(0);
    const entrySlice = out.slice(entryStart);
    // It uses the intent reconciliation endpoint…
    expect(entrySlice).toContain('/v1/intent/{{manifest_id}}/actuals');
    // …with the API key header (not the verify key)…
    const apiKeyIdx = entrySlice.indexOf('"key": "X-AEGIS-API-Key"');
    const verifyKeyIdx = entrySlice.indexOf('"key": "X-AEGIS-Verify-Key"');
    expect(apiKeyIdx).toBeGreaterThan(0);
    // And before the next entry begins (no other entry follows so the
    // verify-key search must miss entirely within this slice).
    expect(verifyKeyIdx).toBe(-1);
  });

  it('INTENT_MISMATCH test script asserts recommendedDenialReason + non-empty mismatches[]', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    const entryStart = out.indexOf('"11. INTENT_MISMATCH"');
    const entrySlice = out.slice(entryStart);
    expect(entrySlice).toContain('recommendedDenialReason');
    expect(entrySlice).toContain('pm.expect(body.mismatches)');
    expect(entrySlice).toContain('that.is.not.empty');
    // Critically: the verify-path entries assert `denialReason`, not
    // `recommendedDenialReason`. The INTENT_MISMATCH entry MUST NOT use
    // the verify-path assertion shape.
    expect(entrySlice).not.toContain("body.denialReason).to.eql");
  });

  it('verify-path entries assert denialReason (not recommendedDenialReason)', () => {
    const out = renderItems(DENIAL_REASON_PRECEDENCE);
    for (const reason of ALGORITHM_REASONS) {
      if (reason === 'INTENT_MISMATCH') continue;
      expect(out).toContain(
        `pm.expect(body.denialReason).to.eql('${reason}')`,
      );
    }
  });
});

describe('generate-postman-walkthrough / renderEntry (single-entry shape)', () => {
  it('emits a clean entry skeleton — method, header, body, url, description, response', () => {
    const out = renderEntry({
      index: 42,
      reason: 'TEST_REASON',
      method: 'POST',
      headers: [{ key: 'X-Test', value: '1' }],
      bodyRaw: '{}',
      url: {
        raw: '{{base_url}}/v1/test',
        host: ['{{base_url}}'],
        path: ['v1', 'test'],
      },
      description: 'desc',
      testExec: ['noop;'],
    });
    expect(out).toContain('"name": "42. TEST_REASON"');
    expect(out).toContain('"method": "POST"');
    expect(out).toContain('{ "key": "X-Test", "value": "1" }');
    expect(out).toContain('"raw": "{}"');
    expect(out).toContain('"host": ["{{base_url}}"]');
    expect(out).toContain('"path": ["v1", "test"]');
    expect(out).toContain('"description": "desc"');
    expect(out).toContain('"response": []');
  });

  it('starts at 8-space indent and ends with the closing brace at the same indent', () => {
    const out = renderEntry({
      index: 1,
      reason: 'X',
      method: 'POST',
      headers: [],
      bodyRaw: '{}',
      url: { raw: '{{base_url}}/x', host: ['{{base_url}}'], path: ['x'] },
      description: '',
      testExec: ['ok;'],
    });
    const lines = out.split('\n');
    expect(lines[0]).toBe('        {');
    expect(lines[lines.length - 1]).toBe('        }');
  });
});

describe('generate-postman-walkthrough / spliceCollection', () => {
  it('preserves everything outside the walk-through folder', () => {
    const before = readFileSync(COLLECTION_PATH, 'utf8');
    const rebuilt = spliceCollection(before, renderItems(DENIAL_REASON_PRECEDENCE));
    // Idempotency on the on-disk file: regenerating must not change it.
    expect(rebuilt).toBe(before);
  });

  it('still produces valid JSON after splice', () => {
    const before = readFileSync(COLLECTION_PATH, 'utf8');
    const rebuilt = spliceCollection(before, renderItems(DENIAL_REASON_PRECEDENCE));
    expect(() => JSON.parse(rebuilt)).not.toThrow();
  });

  it('throws clearly if the folder anchor is missing', () => {
    expect(() => spliceCollection('{"info":{}}', 'x')).toThrow(
      /folder header.*not found/,
    );
  });
});

describe('generate-postman-walkthrough / forward-compat for unknown reasons', () => {
  it('emits a TODO scaffold entry for a reason without a fixture', () => {
    const synthetic = [
      ...DENIAL_REASON_PRECEDENCE,
      'BRAND_NEW_FUTURE_REASON',
    ] as readonly string[];
    const out = renderItems(synthetic);
    expect(out).toContain('BRAND_NEW_FUTURE_REASON');
    expect(out).toContain('TODO(BRAND_NEW_FUTURE_REASON)');
    // Still parses as JSON when spliced — the scaffold must not corrupt
    // the collection so a forgotten fixture only shows up as a diff, not
    // as a broken pipeline.
    const before = readFileSync(COLLECTION_PATH, 'utf8');
    const rebuilt = spliceCollection(before, out);
    expect(() => JSON.parse(rebuilt)).not.toThrow();
  });
});
