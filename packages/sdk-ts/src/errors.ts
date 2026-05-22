import { GENERATED_ERROR_CATALOG, getEntry, getEntryByClassName, type ErrorCatalogEntry } from '@okoro/types';
import type { ErrorEnvelope } from '@okoro/types';

// SDK-side error hierarchy. Mirrors the API's OkoroError tree but lives in
// its own namespace so consumers can `instanceof OkoroError` without
// importing server packages.
//
// Each subclass exposes a `static catalog: ErrorCatalogEntry` reference so
// callers can introspect retry semantics without instantiating the class.
// The legacy public `code` field (uppercase) is preserved for backwards
// compatibility — `catalogCode` is the new stable lower-snake-case form
// from `@okoro/types` ErrorCatalog.

export type { ErrorCatalogEntry } from '@okoro/types';

export abstract class OkoroError extends Error {
  override readonly name: string;
  abstract readonly code: string;
  /** Stable lower-snake-case code from the server catalog (or undefined for transport-only errors). */
  readonly catalogCode: string | undefined;
  static readonly catalog: ErrorCatalogEntry | undefined = undefined;
  /**
   * Minifier-safe class discriminator. Subclasses MUST override with the
   * literal un-minified class name. The base default is empty and the
   * constructor below hard-fails any subclass that forgets to set it.
   *
   * tsup ships this SDK with minification on production builds — without
   * this discriminator, `new.target.name` collapses to "a"/"b"/... and
   * `this.name` (which downstream consumers read via `err.name`) becomes
   * useless. See peer review F-06.
   */
  static readonly catalogKey: string = '';

  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly requestId: string | undefined,
    public readonly details?: unknown,
    catalogCode?: string,
  ) {
    super(message);
    const target = new.target;
    if (target.catalogKey === '') {
      throw new Error('OkoroError subclass missing static catalogKey: ' + new.target.name);
    }
    this.name = target.catalogKey;
    this.catalogCode = catalogCode ?? target.catalog?.code;
  }
}

export class OkoroAuthenticationError extends OkoroError {
  static override readonly catalogKey = 'OkoroAuthenticationError';
  override readonly code = 'AUTH_REQUIRED';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('auth_required');
}
export class OkoroAuthorizationError extends OkoroError {
  static override readonly catalogKey = 'OkoroAuthorizationError';
  override readonly code = 'FORBIDDEN';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('forbidden');
}
export class OkoroNotFoundError extends OkoroError {
  static override readonly catalogKey = 'OkoroNotFoundError';
  override readonly code = 'NOT_FOUND';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('not_found');
}
export class OkoroValidationError extends OkoroError {
  static override readonly catalogKey = 'OkoroValidationError';
  override readonly code = 'INVALID_REQUEST';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('invalid_request');
}
export class OkoroConflictError extends OkoroError {
  static override readonly catalogKey = 'OkoroConflictError';
  override readonly code = 'CONFLICT';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('conflict');
}
export class OkoroRateLimitedError extends OkoroError {
  static override readonly catalogKey = 'OkoroRateLimitedError';
  override readonly code = 'RATE_LIMITED';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('rate_limited');
}
export class OkoroInternalError extends OkoroError {
  static override readonly catalogKey = 'OkoroInternalError';
  override readonly code = 'INTERNAL';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('internal_error');
}
export class OkoroServiceUnavailableError extends OkoroError {
  static override readonly catalogKey = 'OkoroServiceUnavailableError';
  override readonly code = 'SERVICE_UNAVAILABLE';
  static override readonly catalog: ErrorCatalogEntry | undefined =getEntry('service_unavailable');
}
export class OkoroNetworkError extends OkoroError {
  static override readonly catalogKey = 'OkoroNetworkError';
  override readonly code = 'NETWORK_ERROR';
  // Transport-layer error — no server catalog entry exists. We treat it as
  // retryable with exponential backoff at the wrapper level (see http.ts).
  static override readonly catalog: ErrorCatalogEntry | undefined =undefined;
  constructor(message: string, cause?: unknown) {
    super(message, 0, undefined);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Map an envelope to an OkoroError. Prefers the `code` field on the
 * envelope (stable lower-snake-case from the server catalog) when
 * present, falling back to status-code mapping for older / non-OKORO
 * responses.
 */
export function fromEnvelope(env: ErrorEnvelope): OkoroError {
  // Server envelope's `error` field carries the legacy uppercase code; the
  // new server filter also embeds `code` in `details`. Try both.
  const detailsCode = extractCatalogCode(env);
  if (detailsCode !== undefined) {
    const entry = GENERATED_ERROR_CATALOG[detailsCode];
    if (entry !== undefined) {
      return classFromCatalogEntry(entry, env);
    }
  }
  switch (env.statusCode) {
    case 400:
      return new OkoroValidationError(env.message, env.statusCode, env.requestId, env.details);
    case 401:
      return new OkoroAuthenticationError(env.message, env.statusCode, env.requestId, env.details);
    case 403:
      return new OkoroAuthorizationError(env.message, env.statusCode, env.requestId, env.details);
    case 404:
      return new OkoroNotFoundError(env.message, env.statusCode, env.requestId, env.details);
    case 409:
      return new OkoroConflictError(env.message, env.statusCode, env.requestId, env.details);
    case 429:
      return new OkoroRateLimitedError(env.message, env.statusCode, env.requestId, env.details);
    case 503:
      return new OkoroServiceUnavailableError(env.message, env.statusCode, env.requestId, env.details);
    default:
      return new OkoroInternalError(env.message, env.statusCode, env.requestId, env.details);
  }
}

/** Pull a catalog `code` out of either the envelope's details bag or top-level fields. */
export function extractCatalogCode(env: ErrorEnvelope | { details?: unknown; error?: string }): string | undefined {
  // Catalog `code` lives in details for the new filter shape.
  const details = (env as { details?: unknown }).details;
  if (details !== null && typeof details === 'object') {
    const candidate = (details as Record<string, unknown>).code;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  // Older envelopes carry uppercase `error`; if it happens to map to a
  // catalog className, translate it. Otherwise return undefined.
  const top = (env as { error?: unknown }).error;
  if (typeof top === 'string' && top.length > 0) {
    // Try direct match first (server may already emit lower_snake).
    if (GENERATED_ERROR_CATALOG[top]) return top;
    // Fall back to classname-style lookup ("AuthenticationError" → "auth_required").
    const byClass = getEntryByClassName(top);
    if (byClass) return byClass.code;
  }
  return undefined;
}

function classFromCatalogEntry(entry: ErrorCatalogEntry, env: ErrorEnvelope): OkoroError {
  // Pick the SDK class whose static catalog matches; fall back to status.
  const ctor = SDK_ERROR_BY_CODE[entry.code];
  if (ctor !== undefined) {
    return new ctor(env.message, entry.httpStatus, env.requestId, env.details);
  }
  // Status-only fallback for catalog codes we don't have a dedicated class for
  // (e.g. denial-precedence codes that the SDK surfaces as 403 forbidden).
  switch (entry.httpStatus) {
    case 400:
      return new OkoroValidationError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
    case 401:
      return new OkoroAuthenticationError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
    case 402:
    case 403:
      return new OkoroAuthorizationError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
    case 404:
      return new OkoroNotFoundError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
    case 409:
      return new OkoroConflictError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
    case 429:
      return new OkoroRateLimitedError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
    case 503:
      return new OkoroServiceUnavailableError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
    default:
      return new OkoroInternalError(env.message, entry.httpStatus, env.requestId, env.details, entry.code);
  }
}

type OkoroErrorCtor = new (message: string, statusCode: number, requestId: string | undefined, details?: unknown) => OkoroError;

const SDK_ERROR_BY_CODE: Readonly<Record<string, OkoroErrorCtor>> = Object.freeze({
  auth_required: OkoroAuthenticationError,
  forbidden: OkoroAuthorizationError,
  not_found: OkoroNotFoundError,
  invalid_request: OkoroValidationError,
  conflict: OkoroConflictError,
  rate_limited: OkoroRateLimitedError,
  internal_error: OkoroInternalError,
  service_unavailable: OkoroServiceUnavailableError,
});

/** True iff the given OkoroError's catalog entry says it's retryable. */
export function isOkoroErrorRetryable(err: OkoroError): boolean {
  if (err instanceof OkoroNetworkError) return true;
  if (err.catalogCode === undefined) return false;
  return getEntry(err.catalogCode)?.retryable === true;
}

/** Resolve the catalog entry for a thrown OkoroError, if any. */
export function catalogEntryFor(err: OkoroError): ErrorCatalogEntry | undefined {
  if (err.catalogCode === undefined) return undefined;
  return getEntry(err.catalogCode);
}
