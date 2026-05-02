// Typed error hierarchy. Every thrown error in the API descends from
// AegisError; the HttpExceptionFilter maps them to the public envelope.
//
// Why subclasses instead of HttpException strings: callers (services,
// guards, interceptors) can use `instanceof` to react to a specific
// failure mode without parsing strings.

import { HttpException, HttpStatus } from '@nestjs/common';

import type { ErrorCode } from '@aegis/types';

interface AegisErrorOptions {
  details?: unknown;
  cause?: unknown;
}

export abstract class AegisError extends HttpException {
  abstract readonly code: ErrorCode;

  constructor(status: HttpStatus, message: string, opts: AegisErrorOptions = {}) {
    super({ message, ...(opts.details !== undefined ? { details: opts.details } : {}) }, status, {
      cause: opts.cause as Error | undefined,
    });
  }
}

export class AuthenticationError extends AegisError {
  readonly code = 'AUTH_REQUIRED' as const;
  constructor(message = 'Authentication required.', opts?: AegisErrorOptions) {
    super(HttpStatus.UNAUTHORIZED, message, opts ?? {});
  }
}

export class AuthorizationError extends AegisError {
  readonly code = 'FORBIDDEN' as const;
  constructor(message = 'Forbidden.', opts?: AegisErrorOptions) {
    super(HttpStatus.FORBIDDEN, message, opts ?? {});
  }
}

export class NotFoundError extends AegisError {
  readonly code = 'NOT_FOUND' as const;
  constructor(resource: string, opts?: AegisErrorOptions) {
    super(HttpStatus.NOT_FOUND, `${resource} not found.`, opts ?? {});
  }
}

export class ValidationError extends AegisError {
  readonly code = 'INVALID_REQUEST' as const;
  constructor(message: string, opts?: AegisErrorOptions) {
    super(HttpStatus.BAD_REQUEST, message, opts ?? {});
  }
}

export class ConflictError extends AegisError {
  readonly code = 'CONFLICT' as const;
  constructor(message: string, opts?: AegisErrorOptions) {
    super(HttpStatus.CONFLICT, message, opts ?? {});
  }
}

export class IdempotencyConflictError extends AegisError {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  constructor(opts?: AegisErrorOptions) {
    super(
      HttpStatus.CONFLICT,
      'An idempotency-key collision was detected with a request whose body differs from the original.',
      opts ?? {},
    );
  }
}

export class RateLimitedError extends AegisError {
  readonly code = 'RATE_LIMITED' as const;
  constructor(retryAfterSeconds?: number, opts?: AegisErrorOptions) {
    const details = retryAfterSeconds !== undefined ? { retryAfterSeconds } : opts?.details;
    super(HttpStatus.TOO_MANY_REQUESTS, 'Rate limit exceeded.', { ...opts, details });
  }
}

export class InternalError extends AegisError {
  readonly code = 'INTERNAL' as const;
  constructor(message = 'Internal server error.', opts?: AegisErrorOptions) {
    super(HttpStatus.INTERNAL_SERVER_ERROR, message, opts ?? {});
  }
}

export class ServiceUnavailableError extends AegisError {
  readonly code = 'SERVICE_UNAVAILABLE' as const;
  constructor(message = 'Service temporarily unavailable.', opts?: AegisErrorOptions) {
    super(HttpStatus.SERVICE_UNAVAILABLE, message, opts ?? {});
  }
}
