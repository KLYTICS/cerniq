// Per-error-class exit codes. Scriptable callers should switch on these
// rather than parsing stderr.
//
// Codes loosely follow sysexits(3) conventions: data errors → 65; auth
// errors → 77; etc. AEGIS-specific codes start at 4 (auth) to leave
// 0 (success), 1 (generic), 2 (commander usage) untouched.
//
// Reference table:
//   0   success
//   1   generic error (un-classified throw)
//   2   commander usage error (out of our hands — commander emits this)
//   4   AegisAuthenticationError  (missing/invalid API key)
//   5   AegisAuthorizationError   (scope/permission denial)
//   6   AegisNotFoundError        (agent/policy/etc. missing)
//   7   AegisRateLimitedError     (429; back off)
//   8   AegisValidationError      (400; bad input)
//   9   AegisConflictError        (409; e.g. already rotated)
//   11  AegisNetworkError         (transport)
//   12  AegisInternalError        (500)
//   13  AegisServiceUnavailableError (503)
//   20  CliError (local config / not logged in / file missing)

import {
  AegisAuthenticationError,
  AegisAuthorizationError,
  AegisConflictError,
  AegisError,
  AegisInternalError,
  AegisNetworkError,
  AegisNotFoundError,
  AegisRateLimitedError,
  AegisServiceUnavailableError,
  AegisValidationError,
} from '@aegis/sdk';

import { CliError } from './client.js';

export const EXIT_SUCCESS = 0;
export const EXIT_GENERIC = 1;
export const EXIT_AUTHN = 4;
export const EXIT_AUTHZ = 5;
export const EXIT_NOT_FOUND = 6;
export const EXIT_RATE_LIMITED = 7;
export const EXIT_VALIDATION = 8;
export const EXIT_CONFLICT = 9;
export const EXIT_NETWORK = 11;
export const EXIT_INTERNAL = 12;
export const EXIT_UNAVAILABLE = 13;
export const EXIT_CLI = 20;

/**
 * Map any thrown value to a process exit code. Defaults to EXIT_GENERIC
 * for unrecognised throws so scripts can distinguish "AEGIS told us no"
 * (4–13) from "something else went wrong" (1).
 */
export function exitCodeFor(err: unknown): number {
  if (err instanceof AegisAuthenticationError) return EXIT_AUTHN;
  if (err instanceof AegisAuthorizationError) return EXIT_AUTHZ;
  if (err instanceof AegisNotFoundError) return EXIT_NOT_FOUND;
  if (err instanceof AegisRateLimitedError) return EXIT_RATE_LIMITED;
  if (err instanceof AegisValidationError) return EXIT_VALIDATION;
  if (err instanceof AegisConflictError) return EXIT_CONFLICT;
  if (err instanceof AegisNetworkError) return EXIT_NETWORK;
  if (err instanceof AegisServiceUnavailableError) return EXIT_UNAVAILABLE;
  if (err instanceof AegisInternalError) return EXIT_INTERNAL;
  if (err instanceof AegisError) return EXIT_GENERIC;
  if (err instanceof CliError) return EXIT_CLI;
  return EXIT_GENERIC;
}

/**
 * Render an error for human display on stderr. AEGIS errors get their
 * catalog code (so users can search docs); CLI errors get their code;
 * everything else gets the raw message.
 */
export function formatError(err: unknown): string {
  if (err instanceof AegisError) {
    const code = err.catalogCode ?? err.code;
    const reqId = err.requestId ? ` (request_id=${err.requestId})` : '';
    return `${code}: ${err.message}${reqId}`;
  }
  if (err instanceof CliError) {
    return `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
