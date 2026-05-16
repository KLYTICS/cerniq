// Cross-package parity — DENIAL_REASON_PRECEDENCE across THREE surfaces.
//
//   1. Canonical    — `packages/types/src/constants.ts` (TS, source of truth)
//   2. sdk-ts gen   — `packages/sdk-ts/src/denial-reason.generated.ts`
//                     (already gated by `denial-reason-parity.spec.ts`)
//   3. sdk-py hand  — `packages/sdk-py/aegis/_constants.py`
//                     `packages/sdk-py/aegis/models.py`
//
// This spec gates surface #3. The Python files are HAND-MAINTAINED
// (the existing generator only emits TS) — so they are the most likely
// place for drift. Two reasons that need to agree:
//
//   - DENIAL_REASON_PRECEDENCE (tuple, ordered)
//   - DenialReason (StrEnum, ordered iteration via __members__)
//
// SEV-1: any failure here means a Python relying-party SDK either:
//   (a) cannot decode a denial reason the API returned (silent fall-through
//       to "unknown" — the exact failure mode the precedence tuple was
//       designed to prevent), or
//   (b) does not know about a newer reason at all (no exhaustive switch
//       protection — Python consumers think they handle every case but
//       silently miss e.g. INTENT_MISMATCH or TRIAL_EXHAUSTED).
//
// Mechanism: read the canonical TS tuple via module import; parse the
// Py files as text (no Python child process — keeps the test fast and
// CI-portable). The regex parsers are deliberately narrow and break
// loudly if the Py file shape changes — that's the intended behavior.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DENIAL_REASON_PRECEDENCE } from '../../packages/types/src/constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PY_CONSTANTS = resolve(REPO_ROOT, 'packages/sdk-py/aegis/_constants.py');
const PY_MODELS = resolve(REPO_ROOT, 'packages/sdk-py/aegis/models.py');

/**
 * Parse the ordered DENIAL_REASON_PRECEDENCE tuple from `_constants.py`.
 * Matches the literal:
 *   DENIAL_REASON_PRECEDENCE: Final[tuple[str, ...]] = (
 *       "AGENT_NOT_FOUND",
 *       ...
 *   )
 */
function parsePyConstantsTuple(source: string): string[] {
  const tupleMatch = source.match(
    /DENIAL_REASON_PRECEDENCE\s*:\s*Final\[tuple\[str,\s*\.\.\.\]\]\s*=\s*\(([\s\S]*?)\)/,
  );
  if (!tupleMatch) {
    throw new Error(
      `denial-reason-sdk-py-parity: could not locate DENIAL_REASON_PRECEDENCE tuple ` +
        `in _constants.py — file shape changed? Update the parser in this spec.`,
    );
  }
  return [...tupleMatch[1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
}

/**
 * Parse the ordered DenialReason StrEnum members from `models.py`.
 * Matches the literal:
 *   class DenialReason(StrEnum):
 *       PLAN_LIMIT_EXCEEDED = "PLAN_LIMIT_EXCEEDED"
 *       ...
 *
 * Captures the entire class body — from `class DenialReason(...):` up
 * to (but not including) the next TOP-LEVEL `class ` declaration, or
 * end of file. Blank lines INSIDE the class (e.g. between the doc
 * comment block and the first member) are tolerated; the member
 * regex below filters them out by indent + identifier-shape match.
 */
function parsePyEnumMembers(source: string): string[] {
  const classMatch = source.match(
    /class\s+DenialReason\s*\(\s*StrEnum\s*\)\s*:\s*\n([\s\S]*?)(?=\n^class\s|$(?![\s\S]))/m,
  );
  if (!classMatch) {
    throw new Error(
      `denial-reason-sdk-py-parity: could not locate DenialReason class in models.py — ` +
        `file shape changed? Update the parser in this spec.`,
    );
  }
  const memberRegex = /^\s{4}([A-Z_]+)\s*=\s*"([A-Z_]+)"/gm;
  const out: string[] = [];
  for (const m of classMatch[1]!.matchAll(memberRegex)) {
    // Sanity: name MUST equal value (str-enum invariant); StrEnum
    // members where the symbol diverges from the wire string would
    // silently produce a different denial token on the wire.
    if (m[1] !== m[2]) {
      throw new Error(
        `denial-reason-sdk-py-parity: DenialReason.${m[1]} value "${m[2]}" diverges ` +
          `from its symbol name. StrEnum members must be self-equal so the wire ` +
          `string matches the Python identifier; otherwise serialization drifts ` +
          `silently from the API contract.`,
      );
    }
    out.push(m[1]!);
  }
  return out;
}

describe('denial-reason cross-package parity (sdk-py hand-maintained)', () => {
  const pyConstantsSrc = readFileSync(PY_CONSTANTS, 'utf8');
  const pyModelsSrc = readFileSync(PY_MODELS, 'utf8');

  const pyTuple = parsePyConstantsTuple(pyConstantsSrc);
  const pyEnum = parsePyEnumMembers(pyModelsSrc);

  it('sdk-py _constants.DENIAL_REASON_PRECEDENCE equals canonical TS (same order, same length)', () => {
    // If this fails: either the canonical TS tuple grew without sdk-py
    // catching up (most likely), OR sdk-py was reordered without the
    // canonical (very unlikely). Fix sdk-py to match, never the other
    // way — order is part of the wire-level contract (CLAUDE.md
    // denial-precedence invariant).
    expect(pyTuple).toEqual([...DENIAL_REASON_PRECEDENCE]);
  });

  it('sdk-py models.DenialReason members equal canonical TS (same order, same length)', () => {
    expect(pyEnum).toEqual([...DENIAL_REASON_PRECEDENCE]);
  });

  it('every canonical reason is present in sdk-py constants AND models', () => {
    for (const r of DENIAL_REASON_PRECEDENCE) {
      expect(pyTuple).toContain(r);
      expect(pyEnum).toContain(r);
    }
  });

  it('sdk-py has no extras not in the canonical tuple', () => {
    for (const r of pyTuple) expect(DENIAL_REASON_PRECEDENCE as readonly string[]).toContain(r);
    for (const r of pyEnum) expect(DENIAL_REASON_PRECEDENCE as readonly string[]).toContain(r);
  });

  it('sdk-py constants tuple and enum agree with each other (intra-package)', () => {
    // Two files inside the same package previously disagreed about
    // whether PLAN_LIMIT_EXCEEDED was part of DenialReason — this
    // assertion catches that class of internal drift.
    expect(pyTuple).toEqual(pyEnum);
  });

  it('parsed Py tuple contains no duplicates', () => {
    expect(new Set(pyTuple).size).toBe(pyTuple.length);
  });

  it('parsed Py enum contains no duplicates', () => {
    expect(new Set(pyEnum).size).toBe(pyEnum.length);
  });

  // Negative-control on the parser: if either parser silently returns
  // an empty array (e.g. because someone changed the file format), the
  // test would falsely pass `[]` == `[...DENIAL_REASON_PRECEDENCE]`
  // when canonical is also empty — guard against that.
  it('parsers extract a non-empty list (sanity — guards against silent empty parse)', () => {
    expect(pyTuple.length).toBeGreaterThan(0);
    expect(pyEnum.length).toBeGreaterThan(0);
    expect((DENIAL_REASON_PRECEDENCE as readonly string[]).length).toBeGreaterThan(0);
  });
});
