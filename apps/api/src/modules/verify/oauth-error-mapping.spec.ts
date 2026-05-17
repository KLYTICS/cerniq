// oauth-error-mapping.spec.ts — RFC 6749 §5.2 binding test.
//
// Locks the mapping between AEGIS denial reasons and RFC 6749
// canonical errors. If a future denial reason is added without a
// mapping entry, the typecheck fails. If the wire-level mapping
// drifts, this test fails.

import type { DenialReason } from './verify.dto';
import {
  OAUTH_ERROR_DESCRIPTION,
  OAUTH_ERROR_MAPPING,
  oauthErrorFor,
  type OAuthCanonicalError,
} from './oauth-error-mapping';

const ALL_REASONS: ReadonlyArray<DenialReason> = [
  'PLAN_LIMIT_EXCEEDED',
  'AGENT_NOT_FOUND',
  'AGENT_REVOKED',
  'INVALID_SIGNATURE',
  'POLICY_REVOKED',
  'POLICY_EXPIRED',
  'SCOPE_NOT_GRANTED',
  'TRIAL_EXHAUSTED',
  'SPEND_LIMIT_EXCEEDED',
  'TRUST_SCORE_TOO_LOW',
  'ANOMALY_FLAGGED',
  'INTENT_MISMATCH',
];

const RFC_6749_CANONICAL_ERRORS: ReadonlyArray<OAuthCanonicalError> = [
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'invalid_token',
  'invalid_scope',
  'unauthorized_client',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
];

describe('oauth-error-mapping — RFC 6749 §5.2 binding', () => {
  it('every AEGIS denial reason has a mapped OAuth canonical error', () => {
    for (const reason of ALL_REASONS) {
      expect(OAUTH_ERROR_MAPPING[reason]).toBeDefined();
      expect(typeof OAUTH_ERROR_MAPPING[reason]).toBe('string');
    }
  });

  it('every AEGIS denial reason has a human-readable description', () => {
    for (const reason of ALL_REASONS) {
      const desc = OAUTH_ERROR_DESCRIPTION[reason];
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
      // No internal jargon / secret-leaks: descriptions are public-safe.
      expect(desc).not.toMatch(/sql|prisma|redis|stack|errno/i);
    }
  });

  it('every mapped value is one of the RFC 6749 §5.2 canonical errors', () => {
    for (const reason of ALL_REASONS) {
      const error = OAUTH_ERROR_MAPPING[reason];
      expect(RFC_6749_CANONICAL_ERRORS).toContain(error);
    }
  });

  it('oauthErrorFor returns both error and error_description', () => {
    const result = oauthErrorFor('INVALID_SIGNATURE');
    expect(result).toEqual({
      error: 'invalid_token',
      error_description: expect.stringContaining('signature'),
    });
  });

  describe('semantic mapping correctness (lock specific choices)', () => {
    // These tests encode the deliberate semantic choices from the
    // mapping table comments. Changing any of these requires updating
    // both the mapping module AND the FAPI profile doc § RFC-6749.

    it('signature failure → invalid_token (RFC 6750 §3.1, not invalid_client)', () => {
      expect(OAUTH_ERROR_MAPPING['INVALID_SIGNATURE']).toBe('invalid_token');
    });

    it('agent identity issues → invalid_client', () => {
      expect(OAUTH_ERROR_MAPPING['AGENT_NOT_FOUND']).toBe('invalid_client');
      expect(OAUTH_ERROR_MAPPING['AGENT_REVOKED']).toBe('invalid_client');
    });

    it('policy lifecycle → invalid_grant (the grant no longer authorizes)', () => {
      expect(OAUTH_ERROR_MAPPING['POLICY_REVOKED']).toBe('invalid_grant');
      expect(OAUTH_ERROR_MAPPING['POLICY_EXPIRED']).toBe('invalid_grant');
      expect(OAUTH_ERROR_MAPPING['INTENT_MISMATCH']).toBe('invalid_grant');
    });

    it('scope mismatch → invalid_scope (RFC 6749 canonical)', () => {
      expect(OAUTH_ERROR_MAPPING['SCOPE_NOT_GRANTED']).toBe('invalid_scope');
    });

    it('quota / trial / spend / trust / anomaly → access_denied', () => {
      expect(OAUTH_ERROR_MAPPING['PLAN_LIMIT_EXCEEDED']).toBe('access_denied');
      expect(OAUTH_ERROR_MAPPING['TRIAL_EXHAUSTED']).toBe('access_denied');
      expect(OAUTH_ERROR_MAPPING['SPEND_LIMIT_EXCEEDED']).toBe('access_denied');
      expect(OAUTH_ERROR_MAPPING['TRUST_SCORE_TOO_LOW']).toBe('access_denied');
      expect(OAUTH_ERROR_MAPPING['ANOMALY_FLAGGED']).toBe('access_denied');
    });

    it('does not use server_error or temporarily_unavailable (those are 5xx, not 4xx denials)', () => {
      for (const reason of ALL_REASONS) {
        const e = OAUTH_ERROR_MAPPING[reason];
        expect(e).not.toBe('server_error');
        expect(e).not.toBe('temporarily_unavailable');
      }
    });
  });

  it('mapping is frozen (cannot be mutated at runtime)', () => {
    // CLAUDE.md hard rule: contracts don't get mutated by request-time
    // code. Object.freeze enforces this at runtime in strict mode.
    expect(() => {
      // @ts-expect-error — testing freeze enforcement
      OAUTH_ERROR_MAPPING['INVALID_SIGNATURE'] = 'access_denied';
    }).toThrow();
  });
});
