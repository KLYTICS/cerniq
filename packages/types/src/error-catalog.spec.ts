import { describe, expect, it } from 'vitest';

import {
  GENERATED_ERROR_CATALOG,
  getBackoff,
  getCategory,
  getCustomerMessage,
  getEntry,
  getEntryByClassName,
  isRetryable,
} from './error-catalog.js';

describe('error-catalog public surface', () => {
  it('GENERATED_ERROR_CATALOG is non-empty and frozen', () => {
    const codes = Object.keys(GENERATED_ERROR_CATALOG);
    expect(codes.length).toBeGreaterThan(0);
    // Object.freeze on the outer object — adding keys throws in strict mode.
    expect(Object.isFrozen(GENERATED_ERROR_CATALOG)).toBe(true);
  });

  it('every entry has required fields and self-consistent code', () => {
    for (const [code, entry] of Object.entries(GENERATED_ERROR_CATALOG)) {
      expect(entry.code).toBe(code);
      expect(typeof entry.className).toBe('string');
      expect(entry.className.length).toBeGreaterThan(0);
      expect(typeof entry.httpStatus).toBe('number');
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
      expect(entry.httpStatus).toBeLessThan(600);
      expect(typeof entry.retryable).toBe('boolean');
      expect(typeof entry.customerMessage).toBe('string');
      expect(entry.customerMessage.length).toBeGreaterThan(0);
      // Retryable entries must declare a backoff strategy.
      if (entry.retryable) {
        expect(entry.backoff).toBeDefined();
      }
    }
  });

  it('codes are stable lower-snake-case', () => {
    for (const code of Object.keys(GENERATED_ERROR_CATALOG)) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('getEntry returns the entry for known codes', () => {
    const e = getEntry('rate_limited');
    expect(e).toBeDefined();
    expect(e?.httpStatus).toBe(429);
    expect(e?.retryable).toBe(true);
    expect(e?.backoff).toBe('on_retry_after_header');
  });

  it('getEntry returns undefined for unknown codes', () => {
    expect(getEntry('definitely_not_a_real_code')).toBeUndefined();
  });

  it('getEntryByClassName resolves server class names', () => {
    const e = getEntryByClassName('RateLimitedError');
    expect(e?.code).toBe('rate_limited');
    expect(getEntryByClassName('NopeError')).toBeUndefined();
  });

  it('isRetryable defaults to false for unknown / undefined codes', () => {
    expect(isRetryable('rate_limited')).toBe(true);
    expect(isRetryable('forbidden')).toBe(false);
    expect(isRetryable('not_a_real_code')).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });

  it('getBackoff returns the strategy for retryable entries', () => {
    expect(getBackoff('internal_error')).toBe('exponential');
    expect(getBackoff('rate_limited')).toBe('on_retry_after_header');
    expect(getBackoff('forbidden')).toBeUndefined();
    expect(getBackoff(undefined)).toBeUndefined();
  });

  it('getCustomerMessage returns user-safe text', () => {
    expect(getCustomerMessage('forbidden')).toMatch(/not permitted/i);
    expect(getCustomerMessage('not_a_code')).toBeUndefined();
  });

  it('getCategory returns coarse classification', () => {
    expect(getCategory('rate_limited')).toBe('rate_limit');
    expect(getCategory('auth_required')).toBe('auth');
    expect(getCategory('not_a_code')).toBeUndefined();
  });

  it('catalog covers the canonical denial-precedence reasons', () => {
    const denialCodes = [
      'agent_not_found',
      'agent_revoked',
      'invalid_signature',
      'policy_revoked',
      'policy_expired',
      'scope_not_granted',
      'spend_limit_exceeded',
      'trust_score_too_low',
      'anomaly_flagged',
    ];
    for (const code of denialCodes) {
      expect(getEntry(code), `denial code ${code} missing from catalog`).toBeDefined();
    }
  });
});
