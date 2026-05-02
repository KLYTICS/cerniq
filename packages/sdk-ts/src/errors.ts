import type { ErrorEnvelope } from '@aegis/types';

// SDK-side error hierarchy. Mirrors the API's AegisError tree but lives in
// its own namespace so consumers can `instanceof AegisError` without
// importing server packages.

export abstract class AegisError extends Error {
  override readonly name: string;
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly requestId: string | undefined,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AegisAuthenticationError extends AegisError {
  override readonly code = 'AUTH_REQUIRED';
}
export class AegisAuthorizationError extends AegisError {
  override readonly code = 'FORBIDDEN';
}
export class AegisNotFoundError extends AegisError {
  override readonly code = 'NOT_FOUND';
}
export class AegisValidationError extends AegisError {
  override readonly code = 'INVALID_REQUEST';
}
export class AegisConflictError extends AegisError {
  override readonly code = 'CONFLICT';
}
export class AegisRateLimitedError extends AegisError {
  override readonly code = 'RATE_LIMITED';
}
export class AegisInternalError extends AegisError {
  override readonly code = 'INTERNAL';
}
export class AegisNetworkError extends AegisError {
  override readonly code = 'NETWORK_ERROR';
  constructor(message: string, cause?: unknown) {
    super(message, 0, undefined);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function fromEnvelope(env: ErrorEnvelope): AegisError {
  switch (env.statusCode) {
    case 400:
      return new AegisValidationError(env.message, env.statusCode, env.requestId, env.details);
    case 401:
      return new AegisAuthenticationError(env.message, env.statusCode, env.requestId, env.details);
    case 403:
      return new AegisAuthorizationError(env.message, env.statusCode, env.requestId, env.details);
    case 404:
      return new AegisNotFoundError(env.message, env.statusCode, env.requestId, env.details);
    case 409:
      return new AegisConflictError(env.message, env.statusCode, env.requestId, env.details);
    case 429:
      return new AegisRateLimitedError(env.message, env.statusCode, env.requestId, env.details);
    default:
      return new AegisInternalError(env.message, env.statusCode, env.requestId, env.details);
  }
}
