// AdminGuard — gates `/admin/*` endpoints behind the AEGIS_ADMIN_TOKEN
// shared secret. This is the founder-led onboarding path described in
// docs/LAUNCH_READINESS_AUDIT_2026-05-21.md Phase Bα and the cheapest
// path to acquiring AEGIS's first paying customer without waiting on
// dashboard signup, Auth0 SDK installation, or Resend email wiring.
//
// Threat model:
//   - The admin token is a single shared secret known to the operator
//     and the production deploy environment. Loss = full tenant-wide
//     compromise (admin can create principals + issue keys for any
//     email). Rotation: redeploy with new env var; old token rejected
//     on next request (no token cache).
//   - Bearer-token style (not API-key style): the token IS the
//     credential, not an identifier for a database lookup. Compared
//     with `crypto.timingSafeEqual` to defeat timing attacks on
//     prefix-matching guesses.
//   - Authorization decision logged with structured fields on every
//     reject. The token value is NEVER logged (only its length + the
//     `x-aegis-admin-token` header presence). Per CLAUDE.md invariant 4
//     ("no silent failures, no fabricated data").
//
// Tenant-isolation note:
//   AdminGuard intentionally crosses tenant boundaries — the operator
//   acts on behalf of any principal. Downstream controllers MUST still
//   include the target principalId in audit events so the cross-tenant
//   action is traceable. Per root CLAUDE.md invariant 5, the audit
//   event is what carries the principal boundary; the admin guard only
//   establishes that the caller IS the operator.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { AppConfigService } from '../../config/config.service';

export const ADMIN_TOKEN_HEADER = 'x-aegis-admin-token';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = this.config.aegisAdminToken;

    // Operator misconfiguration: AEGIS_ADMIN_TOKEN not set means the
    // entire `/admin/*` surface is closed. This is the safe-by-default
    // posture — better to 401 every admin call than to silently allow
    // unauthenticated access because the env var was forgotten.
    if (!expected || expected.length === 0) {
      this.logger.warn({
        event: 'admin_token_not_configured',
        path: req.path,
      }, 'AdminGuard rejected: AEGIS_ADMIN_TOKEN not configured');
      throw new UnauthorizedException('admin endpoint disabled');
    }

    const presented = this.extractToken(req);
    if (!presented) {
      this.logger.warn({
        event: 'admin_token_missing',
        path: req.path,
        hasHeader: Boolean(req.header(ADMIN_TOKEN_HEADER)),
      }, 'AdminGuard rejected: missing admin token header');
      throw new UnauthorizedException('missing admin token');
    }

    if (!this.constantTimeEquals(presented, expected)) {
      // Log presented LENGTH only, never bytes — the token itself is
      // exactly the credential.
      this.logger.warn({
        event: 'admin_token_mismatch',
        path: req.path,
        presentedLen: presented.length,
        expectedLen: expected.length,
      }, 'AdminGuard rejected: admin token mismatch');
      throw new UnauthorizedException('invalid admin token');
    }

    return true;
  }

  /**
   * Returns the admin token from the request header, or null if absent
   * or empty. Header is the only accepted carrier — query params would
   * leak via access logs, request bodies require parsing-before-auth.
   */
  private extractToken(req: Request): string | null {
    const raw = req.header(ADMIN_TOKEN_HEADER);
    if (Array.isArray(raw)) {
      // Defensive: some proxies collapse repeated headers into array;
      // first non-empty wins.
      const first = raw.find((v) => typeof v === 'string' && v.length > 0);
      return first ?? null;
    }
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return raw;
  }

  /**
   * Constant-time string compare using `crypto.timingSafeEqual` after
   * normalizing both sides to a fixed-length Buffer. Different-length
   * inputs fail fast (cannot equal) — this is safe because the length
   * itself is not secret (admin token has fixed length in deployment).
   */
  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    return timingSafeEqual(aBuf, bBuf);
  }
}
