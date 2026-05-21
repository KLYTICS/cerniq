import { describe, it, expect } from 'vitest';
import {
  AegisAuthenticationError,
  AegisAuthorizationError,
  AegisConflictError,
  AegisInternalError,
  AegisNetworkError,
  AegisNotFoundError,
  AegisRateLimitedError,
  AegisServiceUnavailableError,
  AegisValidationError,
} from '@aegis/sdk';
import { CliError } from '../src/client.js';
import {
  exitCodeFor,
  formatError,
  EXIT_AUTHN,
  EXIT_AUTHZ,
  EXIT_CLI,
  EXIT_CONFLICT,
  EXIT_GENERIC,
  EXIT_INTERNAL,
  EXIT_NETWORK,
  EXIT_NOT_FOUND,
  EXIT_RATE_LIMITED,
  EXIT_UNAVAILABLE,
  EXIT_VALIDATION,
} from '../src/exit-codes.js';

describe('exitCodeFor', () => {
  const cases: Array<[unknown, number, string]> = [
    [new AegisAuthenticationError('x', 401, undefined, undefined), EXIT_AUTHN, '401 → 4'],
    [new AegisAuthorizationError('x', 403, undefined, undefined), EXIT_AUTHZ, '403 → 5'],
    [new AegisNotFoundError('x', 404, undefined, undefined), EXIT_NOT_FOUND, '404 → 6'],
    [new AegisRateLimitedError('x', 429, undefined, undefined), EXIT_RATE_LIMITED, '429 → 7'],
    [new AegisValidationError('x', 400, undefined, undefined), EXIT_VALIDATION, '400 → 8'],
    [new AegisConflictError('x', 409, undefined, undefined), EXIT_CONFLICT, '409 → 9'],
    [new AegisNetworkError('x'), EXIT_NETWORK, 'network → 11'],
    [new AegisInternalError('x', 500, undefined, undefined), EXIT_INTERNAL, '500 → 12'],
    [new AegisServiceUnavailableError('x', 503, undefined, undefined), EXIT_UNAVAILABLE, '503 → 13'],
    [new CliError('not_logged_in', 'x'), EXIT_CLI, 'CliError → 20'],
    [new Error('mystery'), EXIT_GENERIC, 'unknown Error → 1'],
    ['raw string', EXIT_GENERIC, 'raw string → 1'],
  ];

  for (const [err, code, label] of cases) {
    it(`maps ${label}`, () => {
      expect(exitCodeFor(err)).toBe(code);
    });
  }
});

describe('formatError', () => {
  it('renders AegisError with catalog code + request id', () => {
    const err = new AegisAuthenticationError('bad key', 401, 'req_abc');
    const formatted = formatError(err);
    expect(formatted).toMatch(/bad key/);
    expect(formatted).toMatch(/request_id=req_abc/);
  });

  it('renders CliError with its code prefix', () => {
    const formatted = formatError(new CliError('not_logged_in', 'run bootstrap'));
    expect(formatted).toBe('not_logged_in: run bootstrap');
  });

  it('falls back to .message for plain Error', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('coerces non-Error throws to string', () => {
    expect(formatError({ unexpected: true })).toBe('[object Object]');
  });
});
