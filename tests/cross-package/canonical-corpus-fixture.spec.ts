// Cross-language canonical-bytes fixture — locked TS-side, awaiting Python side.
//
// Why this exists (load-bearing):
//   packages/audit-verifier/src/canonical.property.spec.ts lines 35-38
//   documented Plan B.2:
//
//     "Future (Plan B.2):
//        Cross-language fuzz: same 200-value corpus → TS canonicalize bytes
//        === Py canonicalize bytes. Requires Py test harness or static
//        corpus emitted from one side and consumed by the other."
//
//   The Python SDK does NOT yet have a canonicalize function (verified
//   2026-05-17 — `grep -r canonicalize packages/sdk-py/` empty). So the
//   full cross-language byte-parity test can't ship today.
//
//   What CAN ship: the TS-SIDE HALF. This spec curates a representative
//   25-shape input corpus and locks the EXACT canonical bytes TS
//   produces for each. When Python lands canonicalize (follow-up,
//   tracked per Plan B.2), its pytest reads the SAME inputs from this
//   spec (or a JSON fixture extracted from it) and asserts the SAME
//   expected bytes. The fixture becomes the cross-language wire bus.
//
//   Until the Python half lands, this spec STILL has value:
//     - Catches TS-side drift in canonicalize (rename of a primitive,
//       JSON.stringify behavior change in a node upgrade, accidental
//       indent argument, etc.) by failing every entry loudly.
//     - Serves as the canonical-bytes reference artifact a Palantir-tier
//       buyer's CISO can run to verify the wire format is stable across
//       node versions / pnpm reinstalls / etc.
//
// What this spec DOES NOT cover:
//   - Python canonicalize (does not yet exist).
//   - Property-style fuzz with N=200 — that's
//     packages/audit-verifier/src/canonical.property.spec.ts. This spec
//     is the deterministic ANCHOR for cross-language parity, not a
//     property-style fuzzer.
//   - Edge-cases the canonical.ts header explicitly disclaims (NaN,
//     Infinity, very-large numbers, lone-surrogate strings).
//
// Known cross-language NON-PORTABLE shape (DELIBERATELY EXCLUDED from the
// fixture — locking this would lock divergence, not parity):
//
//   Numeric-string keys ({'10':'a','2':'b','1':'c'}). V8 treats integer-
//   indexed string keys as array-index slots: even after sortKeys does
//   lex `.sort()` → ['1','10','2'], JSON.stringify RE-ENUMERATES in
//   numeric order, emitting `{"1":"c","2":"b","10":"a"}`. Python's
//   `json.dumps(..., sort_keys=True)` would lex-sort the same keys and
//   emit `{"1":"c","10":"a","2":"b"}` — DIFFERENT BYTES. The two ports
//   cannot agree on this shape without a custom serializer; this is
//   the inverse of the parity property the fixture exists to lock.
//
//   When Python canonicalize lands (Plan B.2 follow-up):
//     (a) the Python implementation MUST reject numeric-string keys at
//         the canonicalize boundary (raise a typed error), OR
//     (b) the TS canonicalize MUST be updated to reject them too, OR
//     (c) both ports must converge on a custom string-sort that ignores
//         the integer-indexed special-case.
//   Operator decision required at Plan B.2 closure time.
//
// Companion locks:
//   - 68e4cf6 (canonical primitive byte parity TS ↔ TS).
//   - 5e3006d (sign/verify composition interop).
//   - 3942b62 (cross-protocol substitution defense).
//   - this   (TS-side cross-language fixture; Python half pending).

import { describe, expect, it } from 'vitest';

import { canonicalize } from '../../packages/audit-verifier/src/canonical';

// Curated representative corpus. Each entry tests a property where a
// cross-language canonicalize implementation could plausibly diverge:
//   - object key ordering (sortKeys correctness)
//   - JSON.stringify escape behavior
//   - Unicode handling (multi-byte, surrogate pairs)
//   - number formatting (integer / float / negative / zero)
//   - container emptiness
//   - array order preservation
//
// The `expected` field is the EXACT canonical string produced by TS
// canonicalize today. If TS canonicalize ever changes its output for
// any entry, the test fails — forcing a deliberate decision about
// whether the change is intentional (update the lock + update the
// Python-side test in the same change) or a regression.
const FIXTURE: ReadonlyArray<{
  name: string;
  input: unknown;
  expected: string;
}> = [
  // ── Empty / single-field ────────────────────────────────────────────
  { name: 'empty-object', input: {}, expected: '{}' },
  { name: 'empty-array', input: [], expected: '[]' },
  { name: 'single-string-key', input: { a: 'v' }, expected: '{"a":"v"}' },
  { name: 'single-number-key', input: { n: 0 }, expected: '{"n":0}' },
  { name: 'single-null-key', input: { x: null }, expected: '{"x":null}' },

  // ── Key ordering (load-bearing for cross-language parity) ───────────
  {
    name: 'three-keys-out-of-order',
    input: { z: 1, a: 2, m: 3 },
    expected: '{"a":2,"m":3,"z":1}',
  },
  {
    name: 'nested-objects-with-inner-reorder',
    input: { outer: { inner: 'v', b: 2 }, a: 1 },
    expected: '{"a":1,"outer":{"b":2,"inner":"v"}}',
  },
  // Note: numeric-string keys ({'10':'a','2':'b','1':'c'}) intentionally
  // excluded — non-portable cross-language. See docstring above.

  // ── Array order preservation (must NOT be sorted) ───────────────────
  { name: 'integer-array-in-order', input: [3, 1, 2], expected: '[3,1,2]' },
  {
    name: 'object-array-in-order',
    input: [{ b: 1 }, { a: 2 }],
    expected: '[{"b":1},{"a":2}]',
  },

  // ── Numeric edges (bounded — canonical.ts disclaims NaN/Infinity) ──
  { name: 'zero', input: { n: 0 }, expected: '{"n":0}' },
  { name: 'negative-integer', input: { n: -42 }, expected: '{"n":-42}' },
  { name: 'positive-float', input: { n: 1.5 }, expected: '{"n":1.5}' },
  { name: 'negative-float', input: { n: -3.25 }, expected: '{"n":-3.25}' },

  // ── Boolean + null ──────────────────────────────────────────────────
  {
    name: 'bool-mix',
    input: { yes: true, no: false, miss: null },
    expected: '{"miss":null,"no":false,"yes":true}',
  },

  // ── String escape edges ─────────────────────────────────────────────
  { name: 'empty-string-value', input: { s: '' }, expected: '{"s":""}' },
  {
    name: 'embedded-double-quote',
    input: { s: 'he said "hi"' },
    expected: '{"s":"he said \\"hi\\""}',
  },
  {
    name: 'embedded-backslash',
    input: { s: 'path\\to\\thing' },
    expected: '{"s":"path\\\\to\\\\thing"}',
  },
  {
    name: 'embedded-newline-tab',
    input: { s: 'line1\nline2\ttab' },
    expected: '{"s":"line1\\nline2\\ttab"}',
  },
  {
    name: 'embedded-control-char',
    input: { s: 'ab' },
    expected: '{"s":"a\\u0001b"}',
  },

  // ── Unicode ─────────────────────────────────────────────────────────
  {
    name: 'unicode-latin-extended',
    input: { word: 'café' },
    expected: '{"word":"café"}',
  },
  {
    name: 'unicode-surrogate-pair',
    input: { emoji: '🦅' },
    expected: '{"emoji":"🦅"}',
  },
  {
    name: 'unicode-keys',
    input: { 'café': 1, 'カフェ': 2 },
    expected: '{"café":1,"カフェ":2}',
  },

  // ── Empty key (corner case) ─────────────────────────────────────────
  { name: 'empty-string-key', input: { '': 'x' }, expected: '{"":"x"}' },

  // ── Deep nest (depth = 3) ───────────────────────────────────────────
  {
    name: 'depth-3-nesting',
    input: { a: { b: { c: 1 } } },
    expected: '{"a":{"b":{"c":1}}}',
  },
];

describe('canonical-corpus cross-language fixture (TS-side half, Plan B.2)', () => {
  it('fixture has 24 distinct named entries (numeric-string keys deliberately excluded)', () => {
    // Lock the size so a future "let me add a few more" PR is explicit
    // about scope-growth and the Python side knows to mirror exactly.
    expect(FIXTURE.length).toBe(24);
    const names = new Set(FIXTURE.map((e) => e.name));
    expect(names.size).toBe(FIXTURE.length);
  });

  for (const { name, input, expected } of FIXTURE) {
    it(`canonical(${name}) = expected locked bytes`, () => {
      expect(canonicalize(input)).toBe(expected);
    });
  }

  it('every fixture entry round-trips through JSON.parse without throwing', () => {
    // Canonical output is a strict JSON subset; if the canonicalize
    // ever returns something that's not parseable JSON, every consumer
    // (verifier, signer, audit walk) breaks. Per-entry expected-bytes
    // locks above pin format exactness; this assertion is a structural
    // backstop in case a future entry is added without proper expected
    // bytes derivation.
    for (const { input } of FIXTURE) {
      const canon = canonicalize(input);
      expect(() => JSON.parse(canon)).not.toThrow();
    }
  });
});
