// Unit tests for the error catalog. These are the load-bearing guarantees
// for the public error contract — if any assertion here fails, an SDK or
// dashboard somewhere is about to start lying to a customer.

import { CircuitOpenError } from '../resilience/circuit-breaker.js';

import {
  OkoroError,
  AlreadyRotatedError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  IdempotencyConflictError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  TrialExhaustedError,
  ValidationError,
} from './okoro-error.js';
import {
  ERROR_CATALOG,
  getCatalogEntry,
  getInternalFallback,
  isRetryable,
  toClientPayload,
} from './error-catalog.js';

describe('ERROR_CATALOG', () => {
  it('every entry has the required fields populated', () => {
    for (const [key, entry] of Object.entries(ERROR_CATALOG)) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      expect(entry).toBeDefined();
      expect(entry.code).toBeTruthy();
      expect(typeof entry.code).toBe('string');
      expect(entry.code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof entry.httpStatus).toBe('number');
      expect(Number.isInteger(entry.httpStatus)).toBe(true);
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
      expect(entry.httpStatus).toBeLessThanOrEqual(599);
      expect(typeof entry.retryable).toBe('boolean');
      expect(typeof entry.customerMessage).toBe('string');
      expect(entry.customerMessage.length).toBeGreaterThan(0);
      expect(['auth', 'validation', 'policy', 'rate_limit', 'billing', 'crypto', 'transient', 'internal']).toContain(
        entry.category,
      );
      if (entry.backoff !== undefined) {
        expect(['none', 'linear', 'exponential', 'on_retry_after_header']).toContain(entry.backoff);
      }
    }
  });

  it('codes are unique across the catalog', () => {
    const codes = Object.values(ERROR_CATALOG).map((e) => e.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it('customer messages never leak internals or canary tokens', () => {
    // Canary patterns: anything that looks like a secret, a stack frame,
    // or a JS null/undefined leaking through string interpolation.
    const forbidden = [
      /stack trace/i,
      /\bundefined\b/,
      /\bnull\b/,
      /okoro_[a-z0-9]+/i,
      /whsec_[a-z0-9]+/i,
      /sk_[a-z0-9]+/i,
      /at\s+\S+\s+\(/, // JS stack frame "at fn (file:line)"
    ];
    for (const [key, entry] of Object.entries(ERROR_CATALOG)) {
      for (const pat of forbidden) {
        expect(entry.customerMessage).not.toMatch(pat);
      }
      // Sanity: the message should not contain the class-name key itself
      // (would suggest someone copy-pasted a stack trace).
      expect(entry.customerMessage.toLowerCase()).not.toContain(`${key.toLowerCase()}error`);
    }
  });
});

describe('getCatalogEntry', () => {
  it('returns the right entry for a known OkoroError subclass', () => {
    const err = new NotFoundError('Agent');
    const entry = getCatalogEntry(err);
    expect(entry).not.toBeNull();
    expect(entry?.code).toBe('not_found');
    expect(entry?.httpStatus).toBe(404);
  });

  it('resolves every existing OkoroError subclass that is constructible here', () => {
    const cases: [Error, string][] = [
      [new AuthenticationError(), 'auth_required'],
      [new AuthorizationError(), 'forbidden'],
      [new NotFoundError('X'), 'not_found'],
      [new ValidationError('bad'), 'invalid_request'],
      [new ConflictError('x'), 'conflict'],
      [new AlreadyRotatedError(), 'already_rotated'],
      [new IdempotencyConflictError(), 'idempotency_conflict'],
      [new RateLimitedError(30), 'rate_limited'],
      [new InternalError(), 'internal_error'],
      [new ServiceUnavailableError(), 'service_unavailable'],
    ];
    for (const [err, code] of cases) {
      const entry = getCatalogEntry(err);
      expect(entry).not.toBeNull();
      expect(entry?.code).toBe(code);
    }
  });

  it('returns null for non-Okoro JS errors', () => {
    expect(getCatalogEntry(new TypeError('nope'))).toBeNull();
    expect(getCatalogEntry(new RangeError('nope'))).toBeNull();
  });

  it('returns null for non-Error values', () => {
    expect(getCatalogEntry('string')).toBeNull();
    expect(getCatalogEntry(42)).toBeNull();
    expect(getCatalogEntry(undefined)).toBeNull();
    expect(getCatalogEntry(null)).toBeNull();
  });
});

describe('catalogKey discriminator (F-06 minification safety)', () => {
  // Each OkoroError subclass must declare a static `catalogKey` whose
  // string value matches the un-minified class name. This is what survives
  // a tsup production build of the SDK after class names are mangled to
  // single letters.
  const subclasses: [{ catalogKey: string; name: string }, string][] = [
    [AuthenticationError, 'AuthenticationError'],
    [AuthorizationError, 'AuthorizationError'],
    [NotFoundError, 'NotFoundError'],
    [ValidationError, 'ValidationError'],
    [ConflictError, 'ConflictError'],
    [AlreadyRotatedError, 'AlreadyRotatedError'],
    [IdempotencyConflictError, 'IdempotencyConflictError'],
    [RateLimitedError, 'RateLimitedError'],
    [InternalError, 'InternalError'],
    [ServiceUnavailableError, 'ServiceUnavailableError'],
    [TrialExhaustedError, 'TrialExhaustedError'],
  ];

  it.each(subclasses)('%p declares catalogKey matching its constructor name', (cls, expected) => {
    expect(cls.catalogKey).toBe(expected);
    expect(cls.name).toBe(expected);
  });

  it('getCatalogEntry survives a simulated minified constructor.name', () => {
    const err = new AuthenticationError();
    // Simulate tsup minification: class name mangled to a single letter.
    Object.defineProperty(err.constructor, 'name', { value: 'a' });
    expect(err.constructor.name).toBe('a');
    const entry = getCatalogEntry(err);
    expect(entry).not.toBeNull();
    expect(entry?.code).toBe('auth_required');
  });

  it('CircuitOpenError still resolves via constructor.name fallback', () => {
    // CircuitOpenError doesn't extend OkoroError, but it has its own
    // static catalogKey too, so it survives minification as well.
    const err = new CircuitOpenError('demo');
    const entry = getCatalogEntry(err);
    expect(entry?.code).toBe('upstream_unavailable');

    // Even with its constructor.name mangled, the static catalogKey carries through.
    Object.defineProperty(err.constructor, 'name', { value: 'b' });
    expect(getCatalogEntry(err)?.code).toBe('upstream_unavailable');
  });

  it('hard-fails any OkoroError subclass that forgets to override catalogKey', () => {
    // Reproduce a developer omitting the static override. The base
    // catalogKey defaults to '' and the constructor must throw.
    class BrokenError extends OkoroError {
      readonly code = 'INTERNAL' as const;
      constructor() {
        super(500, 'broken');
      }
    }
    expect(() => new BrokenError()).toThrow(/OkoroError subclass missing static catalogKey: BrokenError/);
  });
});

describe('isRetryable', () => {
  it('honors the catalog flag', () => {
    expect(isRetryable(new InternalError())).toBe(true);
    expect(isRetryable(new ServiceUnavailableError())).toBe(true);
    expect(isRetryable(new RateLimitedError(5))).toBe(true);
    expect(isRetryable(new NotFoundError('X'))).toBe(false);
    expect(isRetryable(new ValidationError('x'))).toBe(false);
  });

  it('defaults to false for uncataloged errors', () => {
    expect(isRetryable(new TypeError('boom'))).toBe(false);
    expect(isRetryable('not an error')).toBe(false);
  });
});

describe('toClientPayload', () => {
  it('returns the documented contract shape for a cataloged error', () => {
    const payload = toClientPayload(new NotFoundError('Agent'));
    expect(payload).toEqual({
      code: 'not_found',
      message: expect.any(String),
      retryable: false,
    });
    expect(payload.message.length).toBeGreaterThan(0);
  });

  it('includes retryAfter when supplied and finite', () => {
    const payload = toClientPayload(new RateLimitedError(60), 60);
    expect(payload.code).toBe('rate_limited');
    expect(payload.retryable).toBe(true);
    expect(payload.retryAfter).toBe(60);
  });

  it('omits retryAfter when undefined or invalid', () => {
    expect(toClientPayload(new RateLimitedError(60)).retryAfter).toBeUndefined();
    expect(toClientPayload(new RateLimitedError(60), Number.NaN).retryAfter).toBeUndefined();
    expect(toClientPayload(new RateLimitedError(60), -5).retryAfter).toBeUndefined();
  });

  it('falls back to internal_error for uncataloged errors and never leaks internals', () => {
    const payload = toClientPayload(new TypeError('okoro_secret_key=foo'));
    expect(payload.code).toBe('internal_error');
    expect(payload.retryable).toBe(true);
    expect(payload.message).not.toContain('okoro_secret_key');
    expect(payload.message).not.toContain('TypeError');
  });

  it('matches the internal fallback when error is null', () => {
    const fb = getInternalFallback();
    const payload = toClientPayload(null);
    expect(payload.code).toBe(fb.code);
    expect(payload.message).toBe(fb.customerMessage);
    expect(payload.retryable).toBe(fb.retryable);
  });
});
