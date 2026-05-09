// Cross-package parity test — error catalog across API, TS SDK, and Python SDK.
//
// The server-side ERROR_CATALOG (apps/api/src/common/errors/error-catalog.ts)
// is the single source of truth for SDK retry semantics. The two downstream
// generated mirrors must agree byte-for-byte on:
//
//   - the set of `code`s
//   - `httpStatus` per code
//   - `retryable` per code
//
// Drift in any of these silently breaks SDK retry behavior (a code marked
// retryable on the server but not in an SDK = lost retries → user-visible
// flakiness; the inverse = retry storms during incidents). This test is
// the gate that catches it before CI gets there.
//
// Python is parsed via regex against the generated dict literal — no
// Python runtime needed for this gate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ERROR_CATALOG } from '../../apps/api/src/common/errors/error-catalog';
import { GENERATED_ERROR_CATALOG } from '../../packages/types/src/error-catalog.generated';

const REPO_ROOT = join(__dirname, '..', '..');
const PY_FILE = join(REPO_ROOT, 'packages', 'sdk-py', 'aegis', 'error_catalog.py');

interface PyEntry {
  code: string;
  httpStatus: number;
  retryable: boolean;
}

/**
 * Parse the generated Python dict literal. The generator emits a fixed
 * shape — one entry per code, with `httpStatus` and `retryable` always
 * present and on their own lines. A purpose-built regex is precise
 * enough and avoids spinning up a Python interpreter.
 */
function parsePythonCatalog(): Map<string, PyEntry> {
  const text = readFileSync(PY_FILE, 'utf8');
  // Match each "<code>": { ... } block. Non-greedy across lines.
  const blockRe = /"([a-z][a-z0-9_]*)":\s*\{([\s\S]*?)\},/g;
  const entries = new Map<string, PyEntry>();
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    const code = match[1] ?? '';
    const body = match[2] ?? '';
    const statusMatch = /"httpStatus":\s*(\d+)/.exec(body);
    const retryMatch = /"retryable":\s*(True|False)/.exec(body);
    if (!statusMatch || !retryMatch) {
      throw new Error(`error-catalog-parity: incomplete python entry for ${code}`);
    }
    entries.set(code, {
      code,
      httpStatus: Number.parseInt(statusMatch[1] ?? '0', 10),
      retryable: retryMatch[1] === 'True',
    });
  }
  return entries;
}

describe('error catalog cross-language parity', () => {
  const apiCodes = Object.values(ERROR_CATALOG).map((e) => e.code).sort();
  const tsCodes = Object.keys(GENERATED_ERROR_CATALOG).sort();

  it('every API code appears in the TS generated file', () => {
    for (const code of apiCodes) {
      expect(GENERATED_ERROR_CATALOG[code], `missing TS entry for ${code}`).toBeDefined();
    }
    expect(tsCodes).toEqual(apiCodes);
  });

  it('every API code appears in the Python generated file', () => {
    const py = parsePythonCatalog();
    for (const code of apiCodes) {
      expect(py.has(code), `missing Python entry for ${code}`).toBe(true);
    }
    expect([...py.keys()].sort()).toEqual(apiCodes);
  });

  it('httpStatus matches across API, TS, and Python for every code', () => {
    const py = parsePythonCatalog();
    for (const apiEntry of Object.values(ERROR_CATALOG)) {
      const tsEntry = GENERATED_ERROR_CATALOG[apiEntry.code];
      const pyEntry = py.get(apiEntry.code);
      expect(tsEntry, `TS missing ${apiEntry.code}`).toBeDefined();
      expect(pyEntry, `Python missing ${apiEntry.code}`).toBeDefined();
      expect(tsEntry!.httpStatus, `TS httpStatus drift on ${apiEntry.code}`).toBe(apiEntry.httpStatus);
      expect(pyEntry!.httpStatus, `Python httpStatus drift on ${apiEntry.code}`).toBe(apiEntry.httpStatus);
    }
  });

  it('retryable matches across API, TS, and Python for every code', () => {
    const py = parsePythonCatalog();
    for (const apiEntry of Object.values(ERROR_CATALOG)) {
      const tsEntry = GENERATED_ERROR_CATALOG[apiEntry.code];
      const pyEntry = py.get(apiEntry.code);
      expect(tsEntry!.retryable, `TS retryable drift on ${apiEntry.code}`).toBe(apiEntry.retryable);
      expect(pyEntry!.retryable, `Python retryable drift on ${apiEntry.code}`).toBe(apiEntry.retryable);
    }
  });

  it('TS and Python have no extra codes the API does not declare', () => {
    const py = parsePythonCatalog();
    const apiSet = new Set(apiCodes);
    for (const code of tsCodes) {
      expect(apiSet.has(code), `TS has stale code: ${code}`).toBe(true);
    }
    for (const code of py.keys()) {
      expect(apiSet.has(code), `Python has stale code: ${code}`).toBe(true);
    }
  });

  it('generated files carry the @generated header', () => {
    const ts = readFileSync(join(REPO_ROOT, 'packages', 'types', 'src', 'error-catalog.generated.ts'), 'utf8');
    const py = readFileSync(PY_FILE, 'utf8');
    expect(ts.split('\n')[0]).toMatch(/@generated/);
    expect(py.split('\n')[0]).toMatch(/@generated/);
  });
});
