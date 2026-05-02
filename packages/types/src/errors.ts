// Public error envelope shape — what consumers can rely on receiving in
// non-200 responses (and in the body of 200 verify denials).
//
// Mirrors the `Error` schema in AEGIS_API_SPEC.yaml.

export interface ErrorEnvelope {
  error: string;
  message: string;
  statusCode: number;
  requestId: string;
  details?: unknown;
}

export const ERROR_CODE = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];
