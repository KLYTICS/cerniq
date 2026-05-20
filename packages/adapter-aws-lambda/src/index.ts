// @aegis/adapter-aws-lambda — Round 25 seed, Round 26 lane.
//
// AWS Lambda's handler shape is event-driven, not request-driven:
//
//   (event, context) => result
//
// The wrapper accepts both API Gateway v1 (REST) and v2 (HTTP) event
// shapes, plus the Lambda Function URL shape (which is v2-equivalent).
// All three carry an `event.headers` map and `event.body` payload; the
// wrapper extracts the token, verifies, and forwards to the user
// handler with the verified context.
//
// Why a dedicated package: the event-shape normalization is fiddly and
// belongs in one place. The handler logic in Lambda doesn't naturally
// fit `withAegis`-style Request/Response wrapping; the developer
// experience is cleaner if the wrapper speaks the same `event` /
// `context` / `result` shape the developer already writes.
//
// Usage:
//
//   // handler.ts
//   import { wrapLambda } from '@aegis/adapter-aws-lambda';
//
//   export const handler = wrapLambda({
//     minTrustBand: 'VERIFIED',
//     handler: async (event, ctx) => ({
//       statusCode: 200,
//       body: JSON.stringify({ approvedBy: ctx.aegis.agentId }),
//     }),
//   });
//
// Environment:
//   AEGIS_API_KEY — required (Lambda env var, typically via secrets manager)
//   AEGIS_REGION  — optional region selector
//   AEGIS_API_URL — optional override

import { Aegis, type VerifyResult, AegisError, buildDenialEnvelope } from '@aegis/sdk';

/**
 * Minimal structural shape covering API Gateway v1, API Gateway v2, and
 * Lambda Function URL events. We avoid importing `@types/aws-lambda` to
 * keep the package free of dep weight; the structural type covers what
 * the wrapper actually reads.
 */
export interface LambdaEvent {
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  /** v1 — flat path. */
  path?: string;
  /** v2 / Function URL — nested under requestContext.http. */
  requestContext?: {
    http?: { path?: string; method?: string };
  };
  /** v1 — http method. */
  httpMethod?: string;
  /** ALB and others may set additional headers here. */
  multiValueHeaders?: Record<string, string[] | undefined>;
}

/** Canonical Lambda response shape (API Gateway-compatible). */
export interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

export interface LambdaAegisContext {
  /** Verified AEGIS identity. */
  aegis: {
    verify: VerifyResult;
    agentId: string;
    principalId: string;
    trustBand: VerifyResult['trustBand'];
  };
}

export interface WrapLambdaOptions {
  /** The wrapped handler. Runs only after a successful verify. */
  handler: (event: LambdaEvent, ctx: LambdaAegisContext) => Promise<LambdaResult> | LambdaResult;
  /** Minimum trust band. */
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
  /** Token header name (case-insensitive). Default `x-aegis-token`. */
  tokenHeader?: string;
  /** Optional context derivation. Receives the raw event. */
  deriveContext?: (event: LambdaEvent) => {
    action?: string;
    amount?: number;
    currency?: string;
    merchantDomain?: string;
    merchantId?: string;
  };
  /** Reuse an existing Aegis client. */
  client?: Aegis;
}

const TRUST_BAND_RANK: Readonly<Record<string, number>> = Object.freeze({
  FLAGGED: 0,
  WATCH: 1,
  VERIFIED: 2,
  PLATINUM: 3,
});

function meetsMinBand(actual: VerifyResult['trustBand'], min: WrapLambdaOptions['minTrustBand']): boolean {
  if (!min) return true;
  return (TRUST_BAND_RANK[actual ?? 'FLAGGED'] ?? 0) >= (TRUST_BAND_RANK[min] ?? 0);
}

/**
 * Case-insensitive header lookup. AWS event headers preserve case
 * inconsistently across API Gateway v1/v2/ALB — normalize here.
 */
function readHeader(event: LambdaEvent, name: string): string | undefined {
  const target = name.toLowerCase();
  if (event.headers) {
    for (const [k, v] of Object.entries(event.headers)) {
      if (k.toLowerCase() === target && typeof v === 'string' && v.length > 0) return v;
    }
  }
  if (event.multiValueHeaders) {
    for (const [k, v] of Object.entries(event.multiValueHeaders)) {
      if (k.toLowerCase() === target && Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') {
        return v[0];
      }
    }
  }
  return undefined;
}

function denial(status: number, code: string, message: string, next?: string): LambdaResult {
  // Round 25 supplement audit fix W10: shared envelope shape via @aegis/types.
  const envelope = buildDenialEnvelope({
    error: code,
    message,
    statusCode: status,
    ...(next ? { next } : {}),
  });
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  };
}

/**
 * Wrap a Lambda handler with AEGIS verification.
 *
 * Returns the canonical Lambda handler shape
 * `(event, context) => Promise<LambdaResult>`. Bind directly to
 * `export const handler = wrapLambda(...)`.
 */
export function wrapLambda(
  options: WrapLambdaOptions,
): (event: LambdaEvent) => Promise<LambdaResult> {
  const tokenHeader = options.tokenHeader ?? 'x-aegis-token';
  const client = options.client ?? new Aegis();

  return async (event: LambdaEvent): Promise<LambdaResult> => {
    const token = readHeader(event, tokenHeader);
    if (!token) {
      return denial(
        401,
        'auth_required',
        `Missing ${tokenHeader} header.`,
        `Pass the AEGIS-signed token in the ${tokenHeader} header (https://docs.aegislabs.io/errors/auth_required)`,
      );
    }

    let verify: VerifyResult;
    try {
      const ctxInput = options.deriveContext?.(event);
      verify = await client.verify(token, ctxInput);
    } catch (err: unknown) {
      const next = err instanceof AegisError ? err.next : undefined;
      const message = err instanceof Error ? err.message : 'AEGIS verify failed.';
      return denial(502, 'service_unavailable', message, next);
    }

    if (!verify.valid || !verify.agentId || !verify.principalId) {
      return denial(
        403,
        'forbidden',
        `AEGIS denied request: ${verify.denialReason ?? 'unknown'}`,
        'Inspect verify.denialReason and follow the matching docs/errors/<code> page',
      );
    }

    if (!meetsMinBand(verify.trustBand, options.minTrustBand)) {
      return denial(
        403,
        'trust_score_too_low',
        `Agent trust band ${verify.trustBand} below required ${options.minTrustBand}.`,
      );
    }

    return options.handler(event, {
      aegis: {
        verify,
        agentId: verify.agentId,
        principalId: verify.principalId,
        trustBand: verify.trustBand,
      },
    });
  };
}
