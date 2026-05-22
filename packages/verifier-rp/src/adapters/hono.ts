// Hono middleware. Hono runs everywhere — Workers, Deno, Bun, Node — so this
// is the recommended adapter for edge deployments.

import type { Context, MiddlewareHandler } from 'hono';

import type { VerifyContext, VerifyOptions } from '../types.js';
import type { OkoroVerifier } from '../verifier.js';

const DEFAULT_HEADER = 'X-OKORO-Token';

export interface HonoGuardOptions {
  verifier: OkoroVerifier;
  headerName?: string;
  attachTo?: string;
  requiredScope?: string;
  contextFrom?: (c: Context) => VerifyContext;
}

export function okoroHonoMiddleware(options: HonoGuardOptions): MiddlewareHandler {
  if (!options?.verifier) {
    throw new TypeError('okoroHonoMiddleware: options.verifier is required');
  }
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const attachTo = options.attachTo ?? 'okoro';

  return async (c, next) => {
    const token = c.req.header(headerName);
    if (!token) {
      return c.json(
        { error: 'OKORO_VERIFICATION_FAILED', reason: 'INVALID_SIGNATURE', detail: 'missing token' },
        401,
      );
    }
    const ctx: VerifyContext = options.contextFrom ? options.contextFrom(c) : {};
    const verifyOpts: VerifyOptions = options.requiredScope
      ? { requiredScope: options.requiredScope }
      : {};
    const outcome = await options.verifier.verify(token, ctx, verifyOpts);
    if (!outcome.valid) {
      const body: Record<string, unknown> = {
        error: 'OKORO_VERIFICATION_FAILED',
        reason: outcome.reason,
      };
      if (outcome.detail) body.detail = outcome.detail;
      return c.json(body, 401);
    }
    c.set(attachTo, outcome);
    await next();
    return undefined;
  };
}

export const honoMiddleware = okoroHonoMiddleware;
