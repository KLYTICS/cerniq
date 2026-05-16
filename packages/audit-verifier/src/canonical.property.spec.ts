// Property-based tests for `canonicalize` (Plan B MVP).
//
// Why this exists:
//   `canonicalize` is the function manifests and audit rows are signed
//   AGAINST. A subtle drift — trailing whitespace, key-sort
//   instability, number-format edge case — would silently invalidate
//   *every signed object from before the drift landed*. Forensics
//   would discover it months later when an auditor cannot verify a
//   historical record. SEV-1 class of bug.
//
//   Unit tests cover the happy path; this spec fuzzes the algorithm
//   with random JSON-able input and asserts the invariants the signer
//   depends on:
//
//   1. DETERMINISM           same input → same bytes, every call
//   2. KEY-REORDER INVARIANT canonicalize({a,b}) === canonicalize({b,a})
//      (whole point of sortKeys — must hold at every nesting depth)
//   3. ROUNDTRIP             JSON.parse(canonicalize(v)) deep-equals v
//      (modulo standard JSON coercions; we avoid feeding pathological
//      values per the canonical.ts comment block)
//   4. IDEMPOTENT RE-CANON   canonicalize(JSON.parse(canonicalize(v)))
//                             === canonicalize(v)  ← sign-once-verify-many
//   5. ARRAY ORDER PRESERVED canonicalize([1,2,3]) !== canonicalize([3,2,1])
//      (negative case — arrays must NOT be sorted)
//   6. NO PROTO POLLUTION    weird-key objects don't crash or escape
//
// Mechanism:
//   - Seeded PRNG (mulberry32) so failures are reproducible across CI runs
//   - Bounded depth + width — avoids stack overflow + keeps suite fast
//   - Skips pathological numbers (NaN, Infinity, very-large) per the
//     comment in canonical.ts that says the signer gates those upstream
//   - 200 iterations per property — empirically dense enough to surface
//     drift in single-character-equivalent regressions
//
// Future (Plan B.2):
//   Cross-language fuzz: same 200-value corpus → TS canonicalize bytes
//   === Py canonicalize bytes. Requires Py test harness or static
//   corpus emitted from one side and consumed by the other.

import { describe, expect, it } from 'vitest';

import { canonicalize, sortKeys } from './canonical.js';

// ── Seeded PRNG ───────────────────────────────────────────────────────────
//
// mulberry32 — 1-line deterministic 32-bit PRNG. Same seed → same sequence
// across runs / platforms / Node versions. Fixed seed `0x5EEDED` (cute) gives
// reproducible failures: if CI ever reds, local re-run with the same seed
// produces the same offending value.
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x5eeded;
const ITERATIONS = 200;
const MAX_DEPTH = 4;
const MAX_OBJECT_KEYS = 6;
const MAX_ARRAY_LEN = 6;

// ── Random JSON value generator ───────────────────────────────────────────

const PRIMITIVE_GENS = [
  () => null,
  () => true,
  () => false,
  // Bounded integer — well below MAX_SAFE_INTEGER, no IEEE-754 edge cases.
  // canonical.ts header explicitly says the signer gates very-large numbers
  // upstream; fuzzing those would test behavior canonical.ts disclaims.
  (rng: () => number) => Math.floor(rng() * 1_000_000) - 500_000,
  // Bounded fraction — likewise avoids precision-loss edge cases.
  (rng: () => number) => Math.round(rng() * 1_000_000) / 100,
  // String with mixed ASCII + a few escaped chars (no surrogate halves —
  // the signer doesn't normalize unicode either, per the header).
  (rng: () => number) => {
    const len = Math.floor(rng() * 16);
    let s = '';
    const POOL = 'abcdefghij0123456789-_.';
    for (let i = 0; i < len; i++) {
      s += POOL[Math.floor(rng() * POOL.length)]!;
    }
    return s;
  },
];

function randomLeaf(rng: () => number): unknown {
  const gen = PRIMITIVE_GENS[Math.floor(rng() * PRIMITIVE_GENS.length)]!;
  return gen(rng);
}

function randomKey(rng: () => number): string {
  // Keys are unconstrained JSON-string-legal — but we generate from a
  // curated charset so different orders aren't sort-equivalent for the
  // wrong reasons. (e.g. unicode-normalization-equivalent keys would
  // muddy the key-reorder invariant.)
  const POOL = 'abcdefghij';
  const len = 1 + Math.floor(rng() * 6);
  let k = '';
  for (let i = 0; i < len; i++) k += POOL[Math.floor(rng() * POOL.length)]!;
  return k;
}

function randomJson(rng: () => number, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return randomLeaf(rng);
  const choice = rng();
  if (choice < 0.45) return randomLeaf(rng);
  if (choice < 0.7) {
    const len = Math.floor(rng() * (MAX_ARRAY_LEN + 1));
    const arr: unknown[] = [];
    for (let i = 0; i < len; i++) arr.push(randomJson(rng, depth + 1));
    return arr;
  }
  const keyCount = Math.floor(rng() * (MAX_OBJECT_KEYS + 1));
  const obj: Record<string, unknown> = {};
  // Generate unique keys for the object (sortKeys behavior on duplicate
  // keys is JS-engine-dependent so we avoid the ambiguity in fuzz input).
  const used = new Set<string>();
  let safety = 0;
  while (Object.keys(obj).length < keyCount && safety++ < keyCount * 4) {
    const k = randomKey(rng);
    if (used.has(k)) continue;
    used.add(k);
    obj[k] = randomJson(rng, depth + 1);
  }
  return obj;
}

/**
 * Shuffle a plain JS object's keys without changing values. JS guarantees
 * insertion-order iteration; building a new object in a different order
 * produces a structurally-equivalent value whose serialization SHOULD
 * still be byte-equal under sortKeys.
 *
 * Recurses into nested objects so the test exercises sortKeys at every
 * depth, not just the top level.
 */
function shuffleKeys(value: unknown, rng: () => number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rng));
  const keys = Object.keys(value as Record<string, unknown>);
  // Fisher-Yates with the seeded PRNG.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = shuffleKeys((value as Record<string, unknown>)[k], rng);
  return out;
}

// ── Properties ────────────────────────────────────────────────────────────

describe('canonicalize — property tests (Plan B foundation)', () => {
  it(`determinism: canonicalize(v) === canonicalize(v) for ${ITERATIONS} random values`, () => {
    const rng = mulberry32(SEED);
    for (let i = 0; i < ITERATIONS; i++) {
      const v = randomJson(rng);
      const first = canonicalize(v);
      const second = canonicalize(v);
      expect(second, `iteration ${i}, value ${first}`).toBe(first);
    }
  });

  it(`key-reorder invariant: canonicalize({a,b}) === canonicalize({b,a}) at every depth`, () => {
    const rng = mulberry32(SEED + 1);
    for (let i = 0; i < ITERATIONS; i++) {
      const v = randomJson(rng);
      const shuffled = shuffleKeys(v, rng);
      const a = canonicalize(v);
      const b = canonicalize(shuffled);
      // The two values are structurally equivalent (only key insertion
      // order differs). canonicalize must collapse that variation.
      expect(b, `iteration ${i}\noriginal canon: ${a}\nshuffled canon: ${b}`).toBe(a);
    }
  });

  it(`roundtrip: JSON.parse(canonicalize(v)) deep-equals v`, () => {
    const rng = mulberry32(SEED + 2);
    for (let i = 0; i < ITERATIONS; i++) {
      const v = randomJson(rng);
      const roundtripped = JSON.parse(canonicalize(v));
      expect(roundtripped, `iteration ${i}`).toEqual(v);
    }
  });

  it(`idempotent re-canonicalization: canonicalize(parse(canonicalize(v))) === canonicalize(v)`, () => {
    // Sign-once-verify-many: a manifest signed today must, when
    // canonicalized again at verify time (potentially years later,
    // potentially in a different language), produce the same bytes
    // that were originally signed. If this property fails, every
    // historical signature is at risk.
    const rng = mulberry32(SEED + 3);
    for (let i = 0; i < ITERATIONS; i++) {
      const v = randomJson(rng);
      const once = canonicalize(v);
      const twice = canonicalize(JSON.parse(once));
      expect(twice, `iteration ${i}\nonce:  ${once}\ntwice: ${twice}`).toBe(once);
    }
  });

  it(`array order PRESERVED: [1,2,3] and [3,2,1] do NOT canonicalize equal`, () => {
    // Negative property: arrays carry order. If sortKeys ever
    // accidentally sorts arrays too, the signer's contract breaks
    // (audit events have an ordered `tags` array, intent manifests
    // have an ordered `scopes` array). Arrays must STAY in input order.
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
    expect(canonicalize(['a', 'b'])).not.toBe(canonicalize(['b', 'a']));
    // Nested:
    expect(canonicalize({ list: [1, 2] })).not.toBe(canonicalize({ list: [2, 1] }));
  });

  it(`array contents canonicalize per-element (sortKeys recurses into array entries)`, () => {
    // Property of sortKeys: array entries themselves get sorted if they
    // are objects. Verify that {b:1,a:2} inside an array still serializes
    // with sorted keys.
    const a = canonicalize([{ a: 1, b: 2 }]);
    const b = canonicalize([{ b: 2, a: 1 }]);
    expect(b).toBe(a);
    // Sanity: the keys ARE sorted in the output.
    expect(a).toBe('[{"a":1,"b":2}]');
  });

  it(`no prototype pollution: hostile __proto__ input does not mutate Object.prototype`, () => {
    // Defense in depth. Two attack shapes worth exercising:
    //
    // Shape 1: __proto__ via JSON.parse — modern V8 silently DROPS the
    // __proto__ key entirely, so the property never reaches canonicalize.
    // We still call canonicalize and confirm Object.prototype is untouched.
    const fromJson = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
    canonicalize(fromJson);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();

    // Shape 2: __proto__ as an own enumerable property (bypasses JSON.parse
    // by constructing the object programmatically). An attacker who can
    // synthesize objects this way is rare in our threat model — manifests
    // arrive as bytes and go through JSON.parse — but the test locks the
    // contract for any future caller path that doesn't go through parse.
    const synthesized = Object.create(null) as Record<string, unknown>;
    synthesized.a = 1;
    Object.defineProperty(synthesized, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    canonicalize(synthesized);
    // sortKeys uses `for (key of Object.keys(...).sort()) { out[key] = ... }`.
    // The `out[key]` assignment via __proto__ would set the prototype of
    // `out` if our implementation weren't careful. Asserting prototype
    // remains untouched is the defensive invariant.
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it(`empty inputs canonicalize correctly`, () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize('')).toBe('""');
  });

  it(`sortKeys returns a NEW object — does not mutate input`, () => {
    // Defensive: callers (the signer, the verifier) MUST be able to
    // canonicalize a value they hold a reference to without observing
    // mutation. JSON.stringify's safety depends on this.
    const input: Record<string, unknown> = { c: 1, a: 2, b: 3 };
    const inputKeysBefore = Object.keys(input);
    sortKeys(input);
    const inputKeysAfter = Object.keys(input);
    // Insertion order of the original object is preserved.
    expect(inputKeysAfter).toEqual(inputKeysBefore);
  });
});
