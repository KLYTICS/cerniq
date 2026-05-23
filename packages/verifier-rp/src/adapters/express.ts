// Express middleware. Reads the CERNIQ token from a header (default
// X-CERNIQ-Token), runs verifier.verify(), and attaches the outcome to the
// request under `req.cerniq` (or a custom property).

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { VerifyContext, VerifyOptions, VerifyOutcomeSuccess } from '../types.js';
import type { CerniqVerifier } from '../verifier.js';

const DEFAULT_HEADER = 'x-cerniq-token';

export interface ExpressGuardOptions {
  verifier: CerniqVerifier;
  /** Header name to read. Default `X-CERNIQ-Token`. */
  headerName?: string;
  /** Property to attach the verify outcome to. Default `cerniq`. */
  attachTo?: string;
  /** Required scope for this route — same semantics as VerifyOptions.requiredScope. */
  requiredScope?: string;
  /**
   * Optional context resolver — derives request-time context (action, amount,
   * merchantDomain) from the Express request. Default: empty context.
   */
  contextFrom?: (req: Request) => VerifyContext;
  /**
   * Optional override for the failure response. By default we return 401 with
   * `{ error: 'CERNIQ_VERIFICATION_FAILED', reason }`.
   */
  onDenied?: (res: Response, reason: string, detail?: string) => void;
}

export function cerniqGuard(options: ExpressGuardOptions): RequestHandler {
  if (!options || typeof options !== 'object') {
    throw new TypeError('cerniqGuard: options object is required');
  }
  if (!options.verifier) {
    throw new TypeError('cerniqGuard: options.verifier is required');
  }
  const headerName = (options.headerName ?? DEFAULT_HEADER).toLowerCase();
  const attachTo = options.attachTo ?? 'cerniq';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const headerVal = req.headers[headerName];
    const token = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!token) {
      sendDenied(res, 'CERNIQ_VERIFICATION_FAILED', 'INVALID_SIGNATURE', 'missing token', options);
      return;
    }
    const ctx: VerifyContext = options.contextFrom ? options.contextFrom(req) : {};
    const verifyOpts: VerifyOptions = options.requiredScope
      ? { requiredScope: options.requiredScope }
      : {};
    try {
      const outcome = await options.verifier.verify(token, ctx, verifyOpts);
      if (!outcome.valid) {
        sendDenied(res, 'CERNIQ_VERIFICATION_FAILED', outcome.reason, outcome.detail, options);
        return;
      }
      // Attach typed outcome.
      // type-rationale: Express's typings don't allow dynamic property names,
      // and we offer a configurable attach name so users can avoid collisions.
      (req as unknown as Record<string, VerifyOutcomeSuccess>)[attachTo] = outcome;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function sendDenied(
  res: Response,
  error: string,
  reason: string,
  detail: string | undefined,
  options: ExpressGuardOptions,
): void {
  if (options.onDenied) {
    options.onDenied(res, reason, detail);
    return;
  }
  res.status(401).json({ error, reason, ...(detail ? { detail } : {}) });
}

// Re-export for convenience under the same name as in adapters/index.
export const expressMiddleware = cerniqGuard;
