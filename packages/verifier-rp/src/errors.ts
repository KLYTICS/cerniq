// Typed error hierarchy. The verifier itself returns a structured outcome for
// invalid tokens (it never throws on bad input). These classes are reserved
// for programmer errors and infrastructure failures — they bubble out of the
// verify() Promise and should be handled by the caller.

export type VerifyErrorCode =
  | 'CONFIG_ERROR'
  | 'JWKS_FETCH_FAILED'
  | 'JWKS_PARSE_FAILED'
  | 'AGENT_KEY_LOOKUP_FAILED'
  | 'REVOCATION_FETCH_FAILED'
  | 'INTERNAL_ERROR';

export class VerifyError extends Error {
  readonly code: VerifyErrorCode;
  override readonly cause?: unknown;

  constructor(code: VerifyErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'VerifyError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class ConfigError extends VerifyError {
  constructor(message: string) {
    super('CONFIG_ERROR', message);
    this.name = 'ConfigError';
  }
}

export class JwksFetchError extends VerifyError {
  constructor(message: string, cause?: unknown) {
    super('JWKS_FETCH_FAILED', message, cause);
    this.name = 'JwksFetchError';
  }
}

export class JwksParseError extends VerifyError {
  constructor(message: string, cause?: unknown) {
    super('JWKS_PARSE_FAILED', message, cause);
    this.name = 'JwksParseError';
  }
}

export class AgentKeyLookupError extends VerifyError {
  constructor(message: string, cause?: unknown) {
    super('AGENT_KEY_LOOKUP_FAILED', message, cause);
    this.name = 'AgentKeyLookupError';
  }
}

export class RevocationFetchError extends VerifyError {
  constructor(message: string, cause?: unknown) {
    super('REVOCATION_FETCH_FAILED', message, cause);
    this.name = 'RevocationFetchError';
  }
}
