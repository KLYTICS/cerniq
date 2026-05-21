// Paired tests for JWT claim type-validation helpers.
//
// Coverage targets the loud-fail semantics: present-but-wrong-type
// claims (objects, numbers, arrays, booleans) must produce the null
// sentinel, never silently coerce to a string. This is the regression
// the helper was extracted to prevent — PR #35's `typeof === 'string'`
// inlining accidentally introduced silent coercion across auth0/clerk
// adapters and PR #38 surfaced it as a HIGH-severity gap.

import {
  optionalStringArrayClaim,
  optionalStringClaim,
  requireStringClaim,
} from './jwt-claim-validation';

describe('requireStringClaim', () => {
  it('returns the value when claim is a non-empty string', () => {
    expect(requireStringClaim({ sub: 'auth0|abc' }, 'sub')).toBe('auth0|abc');
  });

  it('returns null when claim is absent', () => {
    expect(requireStringClaim({}, 'sub')).toBeNull();
  });

  it('returns null when claim is an empty string (treated as missing)', () => {
    expect(requireStringClaim({ sub: '' }, 'sub')).toBeNull();
  });

  it('returns null when claim is an object (silent-coercion regression case)', () => {
    expect(requireStringClaim({ sub: { id: 'evil' } }, 'sub')).toBeNull();
  });

  it('returns null when claim is a number (silent-coercion regression case)', () => {
    expect(requireStringClaim({ sub: 123 }, 'sub')).toBeNull();
  });

  it('returns null when claim is an array (silent-coercion regression case)', () => {
    expect(requireStringClaim({ sub: ['a', 'b'] }, 'sub')).toBeNull();
  });

  it('returns null when claim is a boolean (silent-coercion regression case)', () => {
    expect(requireStringClaim({ sub: true }, 'sub')).toBeNull();
    expect(requireStringClaim({ sub: false }, 'sub')).toBeNull();
  });

  it('returns null when claim is explicit null', () => {
    expect(requireStringClaim({ sub: null }, 'sub')).toBeNull();
  });

  it('returns null when claim is explicit undefined', () => {
    expect(requireStringClaim({ sub: undefined }, 'sub')).toBeNull();
  });
});

describe('optionalStringClaim', () => {
  it('returns the value when claim is a string', () => {
    expect(optionalStringClaim({ org_id: 'org_123' }, 'org_id')).toBe('org_123');
  });

  it('returns undefined when claim is absent (sentinel for "not provided")', () => {
    expect(optionalStringClaim({}, 'org_id')).toBeUndefined();
  });

  it('returns undefined when claim is explicit null in payload', () => {
    expect(optionalStringClaim({ org_id: null }, 'org_id')).toBeUndefined();
  });

  it('returns undefined when claim is explicit undefined', () => {
    expect(optionalStringClaim({ org_id: undefined }, 'org_id')).toBeUndefined();
  });

  it('returns empty string for present-but-empty string (distinct from absent)', () => {
    // Optional claims preserve the empty-string-as-present semantic so
    // callers can distinguish "claim explicitly empty" from "claim absent".
    // This is rarely meaningful but the helper stays faithful to the input.
    expect(optionalStringClaim({ org_id: '' }, 'org_id')).toBe('');
  });

  it('returns null when claim is an object (loud failure)', () => {
    expect(optionalStringClaim({ org_id: { id: 'x' } }, 'org_id')).toBeNull();
  });

  it('returns null when claim is a number', () => {
    expect(optionalStringClaim({ org_id: 42 }, 'org_id')).toBeNull();
  });

  it('returns null when claim is an array', () => {
    expect(optionalStringClaim({ org_id: ['a'] }, 'org_id')).toBeNull();
  });

  it('returns null when claim is a boolean', () => {
    expect(optionalStringClaim({ org_id: true }, 'org_id')).toBeNull();
  });

  it('three-way return discriminates absent from malformed (the security-critical case)', () => {
    // The whole point of this helper: callers MUST treat null differently
    // from undefined. undefined → fall through to default. null → reject
    // the token. Both being indistinguishable would re-introduce the
    // silent-coercion bug.
    const absent = optionalStringClaim({}, 'org_id');
    const malformed = optionalStringClaim({ org_id: { evil: true } }, 'org_id');
    expect(absent).toBeUndefined();
    expect(malformed).toBeNull();
    expect(absent).not.toBe(malformed);
  });
});

describe('optionalStringArrayClaim', () => {
  it('returns the array when every element is a string', () => {
    expect(optionalStringArrayClaim({ roles: ['admin', 'user'] }, 'roles')).toEqual([
      'admin',
      'user',
    ]);
  });

  it('returns empty array when claim is absent (safe default)', () => {
    expect(optionalStringArrayClaim({}, 'roles')).toEqual([]);
  });

  it('returns empty array when claim is explicit null', () => {
    expect(optionalStringArrayClaim({ roles: null }, 'roles')).toEqual([]);
  });

  it('returns the array when it is empty', () => {
    expect(optionalStringArrayClaim({ roles: [] }, 'roles')).toEqual([]);
  });

  it('returns null when claim is not an array', () => {
    expect(optionalStringArrayClaim({ roles: 'admin' }, 'roles')).toBeNull();
    expect(optionalStringArrayClaim({ roles: { admin: true } }, 'roles')).toBeNull();
    expect(optionalStringArrayClaim({ roles: 42 }, 'roles')).toBeNull();
  });

  it('returns null when ANY element is not a string (the attacker injection case)', () => {
    // If an attacker can inject `roles: [1, 2, 3]`, we must NOT downstream
    // produce role strings like '1' — that's exactly the silent-coercion
    // pattern the helper exists to prevent.
    expect(optionalStringArrayClaim({ roles: ['admin', 42] }, 'roles')).toBeNull();
    expect(optionalStringArrayClaim({ roles: [{ evil: true }] }, 'roles')).toBeNull();
    expect(optionalStringArrayClaim({ roles: [null] }, 'roles')).toBeNull();
    expect(optionalStringArrayClaim({ roles: [undefined] }, 'roles')).toBeNull();
  });

  it('returns null on mixed-shape arrays — first non-string is enough', () => {
    expect(optionalStringArrayClaim({ roles: ['ok', 'ok', false] }, 'roles')).toBeNull();
  });
});

describe('regression: PR #35 silent-coercion patterns', () => {
  // These are the literal patterns auth0.adapter and clerk.adapter used
  // pre-fix. Each one must now produce a null result somewhere in the
  // pipeline. Kept as a contract test so any future re-introduction of
  // the pattern (via copy-paste in a new adapter) is caught by CI.
  const malformedShapes: Array<{ shape: string; value: unknown }> = [
    { shape: 'object', value: { id: 'evil' } },
    { shape: 'number', value: 12345 },
    { shape: 'array', value: ['a', 'b'] },
    { shape: 'boolean', value: true },
  ];

  for (const { shape, value } of malformedShapes) {
    it(`requireStringClaim rejects ${shape} for required sub`, () => {
      expect(requireStringClaim({ sub: value }, 'sub')).toBeNull();
    });

    it(`optionalStringClaim rejects ${shape} for optional org_id`, () => {
      expect(optionalStringClaim({ org_id: value }, 'org_id')).toBeNull();
    });
  }
});
