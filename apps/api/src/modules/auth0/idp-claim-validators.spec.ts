// Paired tests for the IdP-claim validators that back the strict-rejection
// design (root CLAUDE.md invariant 4: "No silent failures and no fabricated
// data"). These helpers are the single hot-path place where adapters
// translate untrusted JWT claim values into typed identity — so each
// branch is exercised explicitly here, before the adapter integration
// tests cover the wiring.

import {
  extractAegisRoles,
  extractStringArray,
  isMfaSatisfied,
  optionalStringClaim,
  requireStringClaim,
  requireStringClaimWithFallback,
} from './idp-claim-validators';

describe('requireStringClaim', () => {
  it('returns the value when claim is a non-empty string', () => {
    expect(requireStringClaim({ sub: 'auth0|abc' }, 'sub')).toBe('auth0|abc');
  });

  it('returns null when claim is missing', () => {
    expect(requireStringClaim({}, 'sub')).toBeNull();
  });

  it('returns null when claim is empty string (silent-failure equivalent)', () => {
    // An empty-string required claim is no better than a missing claim —
    // it cannot identify a real user or org. Treating "" as null is the
    // core defense against the prior coercion-to-"" silent-failure mode.
    expect(requireStringClaim({ sub: '' }, 'sub')).toBeNull();
  });

  it('returns null when claim is explicitly null', () => {
    expect(requireStringClaim({ sub: null }, 'sub')).toBeNull();
  });

  it('returns null when claim is undefined', () => {
    expect(requireStringClaim({ sub: undefined }, 'sub')).toBeNull();
  });

  it('returns null when claim is a number', () => {
    expect(requireStringClaim({ sub: 12345 }, 'sub')).toBeNull();
  });

  it('returns null when claim is a boolean', () => {
    expect(requireStringClaim({ sub: true }, 'sub')).toBeNull();
    expect(requireStringClaim({ sub: false }, 'sub')).toBeNull();
  });

  it('returns null when claim is an object', () => {
    expect(requireStringClaim({ sub: { id: 'a' } }, 'sub')).toBeNull();
  });

  it('returns null when claim is an array', () => {
    expect(requireStringClaim({ sub: ['a'] }, 'sub')).toBeNull();
  });
});

describe('optionalStringClaim', () => {
  it('returns the value when claim is a non-empty string', () => {
    expect(optionalStringClaim({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('returns null (not "") for every non-string shape', () => {
    expect(optionalStringClaim({}, 'name')).toBeNull();
    expect(optionalStringClaim({ name: null }, 'name')).toBeNull();
    expect(optionalStringClaim({ name: undefined }, 'name')).toBeNull();
    expect(optionalStringClaim({ name: 42 }, 'name')).toBeNull();
    expect(optionalStringClaim({ name: false }, 'name')).toBeNull();
    expect(optionalStringClaim({ name: {} }, 'name')).toBeNull();
    expect(optionalStringClaim({ name: '' }, 'name')).toBeNull();
  });
});

describe('requireStringClaimWithFallback', () => {
  it('prefers the primary key when present', () => {
    const got = requireStringClaimWithFallback(
      { org_id: 'org_a', o: { id: 'org_b' } },
      'org_id',
      { parentKey: 'o', nestedKey: 'id' },
    );
    expect(got).toBe('org_a');
  });

  it('falls back to nested key when primary is missing', () => {
    const got = requireStringClaimWithFallback(
      { o: { id: 'org_b' } },
      'org_id',
      { parentKey: 'o', nestedKey: 'id' },
    );
    expect(got).toBe('org_b');
  });

  it('falls back to nested key when primary is wrong-type', () => {
    const got = requireStringClaimWithFallback(
      { org_id: 42, o: { id: 'org_b' } },
      'org_id',
      { parentKey: 'o', nestedKey: 'id' },
    );
    expect(got).toBe('org_b');
  });

  it('returns null when both primary and fallback are missing', () => {
    expect(
      requireStringClaimWithFallback({}, 'org_id', {
        parentKey: 'o',
        nestedKey: 'id',
      }),
    ).toBeNull();
  });

  it('returns null when nested parent is the wrong type', () => {
    expect(
      requireStringClaimWithFallback(
        { o: 'not-an-object' },
        'org_id',
        { parentKey: 'o', nestedKey: 'id' },
      ),
    ).toBeNull();
  });

  it('returns null when nested parent is null', () => {
    expect(
      requireStringClaimWithFallback({ o: null }, 'org_id', {
        parentKey: 'o',
        nestedKey: 'id',
      }),
    ).toBeNull();
  });

  it('returns null when nested key is wrong-type', () => {
    expect(
      requireStringClaimWithFallback(
        { o: { id: 42 } },
        'org_id',
        { parentKey: 'o', nestedKey: 'id' },
      ),
    ).toBeNull();
  });

  it('returns null when nested key is empty string', () => {
    expect(
      requireStringClaimWithFallback(
        { o: { id: '' } },
        'org_id',
        { parentKey: 'o', nestedKey: 'id' },
      ),
    ).toBeNull();
  });
});

describe('isMfaSatisfied', () => {
  it('returns true when amr includes "mfa"', () => {
    expect(isMfaSatisfied({ amr: ['pwd', 'mfa'] })).toBe(true);
  });

  it('returns false when amr is missing', () => {
    expect(isMfaSatisfied({})).toBe(false);
  });

  it('returns false when amr is not an array', () => {
    expect(isMfaSatisfied({ amr: 'mfa' })).toBe(false);
    expect(isMfaSatisfied({ amr: { method: 'mfa' } })).toBe(false);
  });

  it('returns false when amr contains non-string entries that look like mfa', () => {
    // Defensive: a wrong-type entry must not coerce to "mfa" match.
    expect(isMfaSatisfied({ amr: [null, undefined, 0, false, {}] })).toBe(false);
  });

  it('returns false when "mfa" is absent from amr', () => {
    expect(isMfaSatisfied({ amr: ['pwd', 'otp'] })).toBe(false);
  });
});

describe('extractAegisRoles', () => {
  it('returns only aegis:* prefixed entries', () => {
    expect(
      extractAegisRoles(['aegis:admin', 'aegis:viewer', 'other-role']),
    ).toEqual(['aegis:admin', 'aegis:viewer']);
  });

  it('returns [] when value is not an array', () => {
    expect(extractAegisRoles(undefined)).toEqual([]);
    expect(extractAegisRoles(null)).toEqual([]);
    expect(extractAegisRoles('aegis:admin')).toEqual([]);
    expect(extractAegisRoles({ '0': 'aegis:admin' })).toEqual([]);
  });

  it('drops non-string entries inside the array', () => {
    expect(
      extractAegisRoles(['aegis:admin', 42, null, { role: 'aegis:x' }]),
    ).toEqual(['aegis:admin']);
  });

  it('returns [] when the array is empty or has no aegis:* entries', () => {
    expect(extractAegisRoles([])).toEqual([]);
    expect(extractAegisRoles(['other', 'roles'])).toEqual([]);
  });
});

describe('extractStringArray', () => {
  it('returns string entries unchanged', () => {
    expect(extractStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('drops non-string entries without coercion', () => {
    expect(extractStringArray(['a', 42, null, undefined, {}])).toEqual(['a']);
  });

  it('returns [] for any non-array shape', () => {
    expect(extractStringArray(undefined)).toEqual([]);
    expect(extractStringArray(null)).toEqual([]);
    expect(extractStringArray('a')).toEqual([]);
    expect(extractStringArray({ length: 2, 0: 'a', 1: 'b' })).toEqual([]);
  });
});
