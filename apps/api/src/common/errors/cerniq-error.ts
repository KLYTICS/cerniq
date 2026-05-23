// Typed error hierarchy. Every thrown error in the API descends from
// CerniqError; the HttpExceptionFilter maps them to the public envelope.
//
// Why subclasses instead of HttpException strings: callers (services,
// guards, interceptors) can use `instanceof` to react to a specific
// failure mode without parsing strings.

import type { ErrorCode } from '@cerniq/types';
import { HttpException, HttpStatus } from '@nestjs/common';

import { ERROR_CATALOG, type ErrorCatalogEntry } from './error-catalog.js';

interface CerniqErrorOptions {
  details?: unknown;
  cause?: unknown;
}

export abstract class CerniqError extends HttpException {
  abstract readonly code: ErrorCode;

  /**
   * Minifier-safe discriminator used to look up this class's entry in
   * ERROR_CATALOG. Subclasses MUST override with the literal catalog key
   * (which equals the un-minified class name). The base default is empty
   * and the constructor below hard-fails any subclass that forgets to
   * set it — so a missing override is caught at the first instantiation
   * in development, not silently in a minified prod build.
   *
   * See peer review F-06: previously we resolved entries via
   * `error.constructor.name`, which collapses to "a"/"b"/... after a tsup
   * production build of the SDK and would map every error to
   * internal_error. `static readonly catalogKey` survives mangling.
   */
  static readonly catalogKey: string = '';

  constructor(status: HttpStatus, message: string, opts: CerniqErrorOptions = {}) {
    super({ message, ...(opts.details !== undefined ? { details: opts.details } : {}) }, status, {
      cause: opts.cause as Error | undefined,
    });
    if (new.target.catalogKey === '') {
      throw new Error('CerniqError subclass missing static catalogKey: ' + new.target.name);
    }
  }

  /**
   * Pulls this error's catalog entry from the registry by catalogKey,
   * falling back to constructor.name for resilience modules' errors that
   * don't extend CerniqError (e.g. CircuitOpenError).
   *
   * Returns null when the subclass is missing from ERROR_CATALOG; the
   * audit script (`scripts/audit-error-catalog.ts`) is the CI guard
   * against that drift, but at runtime we tolerate a missing entry and
   * let the global filter fall back to a redacted internal_error.
   */
  getCatalogEntry(): ErrorCatalogEntry | null {
    const ctor = this.constructor as typeof CerniqError;
    const key = ctor.catalogKey !== '' ? ctor.catalogKey : ctor.name;
    return ERROR_CATALOG[key] ?? null;
  }
}

export class AuthenticationError extends CerniqError {
  static override readonly catalogKey = 'AuthenticationError';
  readonly code = 'AUTH_REQUIRED' as const;
  constructor(message = 'Authentication required.', opts?: CerniqErrorOptions) {
    super(HttpStatus.UNAUTHORIZED, message, opts ?? {});
  }
}

export class AuthorizationError extends CerniqError {
  static override readonly catalogKey = 'AuthorizationError';
  readonly code = 'FORBIDDEN' as const;
  constructor(message = 'Forbidden.', opts?: CerniqErrorOptions) {
    super(HttpStatus.FORBIDDEN, message, opts ?? {});
  }
}

export class NotFoundError extends CerniqError {
  static override readonly catalogKey = 'NotFoundError';
  readonly code = 'NOT_FOUND' as const;
  constructor(resource: string, opts?: CerniqErrorOptions) {
    super(HttpStatus.NOT_FOUND, `${resource} not found.`, opts ?? {});
  }
}

export class ValidationError extends CerniqError {
  static override readonly catalogKey = 'ValidationError';
  readonly code = 'INVALID_REQUEST' as const;
  constructor(message: string, opts?: CerniqErrorOptions) {
    super(HttpStatus.BAD_REQUEST, message, opts ?? {});
  }
}

export class ConflictError extends CerniqError {
  static override readonly catalogKey = 'ConflictError';
  readonly code = 'CONFLICT' as const;
  constructor(message: string, opts?: CerniqErrorOptions) {
    super(HttpStatus.CONFLICT, message, opts ?? {});
  }
}

/**
 * Thrown when a caller tries to rotate an API key that is already inside
 * its 24-hour overlap (i.e. it has already been rotated). Prevents
 * rotation chains from collapsing the overlap window down to seconds.
 *
 * Maps to HTTP 409. Uses the public `CONFLICT` ErrorCode so the public
 * type contract in @cerniq/types stays unchanged; the discriminator for
 * client code is the error message + the `instanceof AlreadyRotatedError`
 * check on the server side.
 */
export class AlreadyRotatedError extends CerniqError {
  static override readonly catalogKey = 'AlreadyRotatedError';
  readonly code = 'CONFLICT' as const;
  constructor(
    message = 'This API key has already been rotated; rotate the active key instead.',
    opts?: CerniqErrorOptions,
  ) {
    super(HttpStatus.CONFLICT, message, opts ?? {});
  }
}

export class IdempotencyConflictError extends CerniqError {
  static override readonly catalogKey = 'IdempotencyConflictError';
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  constructor(opts?: CerniqErrorOptions) {
    super(
      HttpStatus.CONFLICT,
      'An idempotency-key collision was detected with a request whose body differs from the original.',
      opts ?? {},
    );
  }
}

export class RateLimitedError extends CerniqError {
  static override readonly catalogKey = 'RateLimitedError';
  readonly code = 'RATE_LIMITED' as const;
  constructor(retryAfterSeconds?: number, opts?: CerniqErrorOptions) {
    const details = retryAfterSeconds !== undefined ? { retryAfterSeconds } : opts?.details;
    super(HttpStatus.TOO_MANY_REQUESTS, 'Rate limit exceeded.', { ...opts, details });
  }
}

export class InternalError extends CerniqError {
  static override readonly catalogKey = 'InternalError';
  readonly code = 'INTERNAL' as const;
  constructor(message = 'Internal server error.', opts?: CerniqErrorOptions) {
    super(HttpStatus.INTERNAL_SERVER_ERROR, message, opts ?? {});
  }
}

export class ServiceUnavailableError extends CerniqError {
  static override readonly catalogKey = 'ServiceUnavailableError';
  readonly code = 'SERVICE_UNAVAILABLE' as const;
  constructor(message = 'Service temporarily unavailable.', opts?: CerniqErrorOptions) {
    super(HttpStatus.SERVICE_UNAVAILABLE, message, opts ?? {});
  }
}

/**
 * Thrown when a free-trial principal exhausts the lifetime verify cap
 * (see ADR-0014, default 10,000 verifies). Maps to HTTP 402. Distinct from
 * `PLAN_LIMIT_EXCEEDED` (which fires for paid-tier monthly hard-stop) —
 * trial caps are lifetime, paid caps are monthly.
 *
 * Uses the shared `BILLING` ErrorCode in the public envelope; the wire-
 * level discriminator is `denialReason: 'TRIAL_EXHAUSTED'` on the verify
 * response (see `DENIAL_REASON_PRECEDENCE` in @cerniq/types).
 */
export class TrialExhaustedError extends CerniqError {
  static override readonly catalogKey = 'TrialExhaustedError';
  readonly code = 'BILLING' as const;
  constructor(
    message = 'Free trial verify cap reached. Upgrade to continue.',
    opts?: CerniqErrorOptions,
  ) {
    super(HttpStatus.PAYMENT_REQUIRED, message, opts ?? {});
  }
}
