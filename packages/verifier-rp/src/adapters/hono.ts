// Hono middleware. Hono runs everywhere — Workers, Deno, Bun, Node — so this
// is the recommended adapter for edge deployments.

import type { Context, MiddlewareHandler } from 'hono';

import type { AegisVerifier } from '../verifier.js';
import type { VerifyContext, VerifyOptions } from '../types.js';

const DEFAULT_HEADER = 'X-AEGIS-Token';

export interface HonoGuardOptions {
  verifier: AegisVerifier;
  headerName?: string;
  attachTo?: string;
  requiredScope?: string;
  contextFrom?: (c: Context) => VerifyContext;
}

export function aegisHonoMiddleware(options: HonoGuardOptions): MiddlewareHandler {
  if (!options?.verifier) {
    throw new TypeError('aegisHonoMiddleware: options.verifier is required');
  }
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const attachTo = options.attachTo ?? 'aegis';

  return async (c, next) => {
    const token = c.req.header(headerName);
    if (!token) {
      return c.json(
        { error: 'AEGIS_VERIFICATION_FAILED', reason: 'INVALID_SIGNATURE', detail: 'missing token' },
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
        error: 'AEGIS_VERIFICATION_FAILED',
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

export const honoMiddleware = aegisHonoMiddleware;
