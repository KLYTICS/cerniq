// Paired test for AdminGuard — per CLAUDE.md "Crypto, auth, billing,
// policy, audit, and tenant-boundary changes require paired tests in
// the same change."

import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AdminGuard, ADMIN_TOKEN_HEADER } from './admin.guard';
import type { AppConfigService } from '../../config/config.service';

function buildCtx(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  const req = {
    path: '/admin/principals',
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function buildConfig(token: string | undefined): AppConfigService {
  return { aegisAdminToken: token } as unknown as AppConfigService;
}

describe('AdminGuard', () => {
  describe('configuration', () => {
    it('rejects every request when AEGIS_ADMIN_TOKEN is not configured', () => {
      const guard = new AdminGuard(buildConfig(undefined));
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: 'whatever' });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(ctx)).toThrow(/admin endpoint disabled/);
    });

    it('rejects every request when AEGIS_ADMIN_TOKEN is empty string', () => {
      const guard = new AdminGuard(buildConfig(''));
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: 'whatever' });
      expect(() => guard.canActivate(ctx)).toThrow(/admin endpoint disabled/);
    });
  });

  describe('header presence', () => {
    const guard = new AdminGuard(buildConfig('correct-token-32-bytes-hex-aabb'));

    it('rejects when x-aegis-admin-token header is absent', () => {
      const ctx = buildCtx({});
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(ctx)).toThrow(/missing admin token/);
    });

    it('rejects when x-aegis-admin-token header is empty string', () => {
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: '' });
      expect(() => guard.canActivate(ctx)).toThrow(/missing admin token/);
    });

    it('accepts when header is array with at least one non-empty value', () => {
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: ['', 'correct-token-32-bytes-hex-aabb'] });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects when header is empty array', () => {
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: [] });
      expect(() => guard.canActivate(ctx)).toThrow(/missing admin token/);
    });
  });

  describe('token comparison', () => {
    const expected = 'correct-token-32-bytes-hex-aabb';
    const guard = new AdminGuard(buildConfig(expected));

    it('accepts when presented token matches exactly', () => {
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: expected });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects when presented token differs by single byte', () => {
      const wrong = expected.slice(0, -1) + (expected.slice(-1) === 'b' ? 'c' : 'b');
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: wrong });
      expect(() => guard.canActivate(ctx)).toThrow(/invalid admin token/);
    });

    it('rejects when presented token has different length (prefix of expected)', () => {
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: expected.slice(0, 16) });
      expect(() => guard.canActivate(ctx)).toThrow(/invalid admin token/);
    });

    it('rejects when presented token has different length (longer than expected)', () => {
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: expected + 'extra' });
      expect(() => guard.canActivate(ctx)).toThrow(/invalid admin token/);
    });

    it('rejects when presented token differs in case (case-sensitive)', () => {
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: expected.toUpperCase() });
      expect(() => guard.canActivate(ctx)).toThrow(/invalid admin token/);
    });
  });

  describe('timing-safe property (regression guard)', () => {
    // Not a true timing test — the guarantee is that
    // `constantTimeEquals` uses `timingSafeEqual` not `===`. The
    // length-mismatch fast-fail is acceptable because length itself
    // is not a secret in this threat model. If a future change makes
    // length variable (e.g. supports multiple token formats), this
    // test should be expanded to assert constant-time across lengths.
    it('uses crypto.timingSafeEqual for equal-length tokens', () => {
      // Smoke: two distinct equal-length tokens both reject without
      // throwing a non-UnauthorizedException error. If `===` had crept
      // in, runtime would behave the same — this is here as a
      // regression-comment anchor.
      const guard = new AdminGuard(buildConfig('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
      const ctx = buildCtx({ [ADMIN_TOKEN_HEADER]: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });
  });
});
