// Dashboard safe-redirect parity test — open-redirect defense for the
// `/login?redirect=…` → Auth0 `returnTo` flow that closes Round 21's
// AutoCheckout conversion funnel.
//
// Lives in tests/cross-package because the dashboard has no dedicated
// test runner yet (M-020-pkg-install will add one); the validator is
// pure TS with no React/Next imports so it runs cleanly here.

import { describe, expect, it } from 'vitest';

import {
  buildLoginHref,
  safeRedirect,
} from '../../apps/dashboard/lib/safe-redirect';

describe('dashboard/safeRedirect', () => {
  it('passes a same-origin path', () => {
    expect(safeRedirect('/billing')).toBe('/billing');
  });

  it('preserves intent + tier query so AutoCheckout fires post-login', () => {
    expect(safeRedirect('/billing?intent=checkout&tier=DEVELOPER')).toBe(
      '/billing?intent=checkout&tier=DEVELOPER',
    );
  });

  it('takes the first value when given an array (Next searchParams shape)', () => {
    expect(safeRedirect(['/billing', '/evil'])).toBe('/billing');
  });

  it('rejects undefined / empty / non-string', () => {
    expect(safeRedirect(undefined)).toBe('/');
    expect(safeRedirect('')).toBe('/');
    expect(safeRedirect([])).toBe('/');
  });

  it('rejects protocol-relative redirects (//evil.com)', () => {
    expect(safeRedirect('//evil.com/path')).toBe('/');
  });

  it('rejects backslash-escaped protocol-relative (/\\evil.com)', () => {
    expect(safeRedirect('/\\evil.com')).toBe('/');
  });

  it('rejects absolute URLs', () => {
    expect(safeRedirect('https://evil.com')).toBe('/');
    expect(safeRedirect('http://localhost/billing')).toBe('/');
  });

  it('rejects paths not starting with /', () => {
    expect(safeRedirect('billing')).toBe('/');
    expect(safeRedirect('javascript:alert(1)')).toBe('/');
  });

  it('rejects oversized payloads', () => {
    const huge = '/x' + 'a'.repeat(600);
    expect(safeRedirect(huge)).toBe('/');
  });

  it('rejects whitespace and control characters', () => {
    expect(safeRedirect('/billing path')).toBe('/');
    expect(safeRedirect('/bill\ning')).toBe('/');
    expect(safeRedirect('/bill\ting')).toBe('/');
    expect(safeRedirect('/bill ing')).toBe('/');
  });
});

describe('dashboard/buildLoginHref', () => {
  it('returns bare login href for default landing', () => {
    expect(buildLoginHref(undefined)).toBe('/api/auth/login');
    expect(buildLoginHref('/')).toBe('/api/auth/login');
  });

  it('encodes returnTo with intent + tier', () => {
    expect(buildLoginHref('/billing?intent=checkout&tier=DEVELOPER')).toBe(
      '/api/auth/login?returnTo=%2Fbilling%3Fintent%3Dcheckout%26tier%3DDEVELOPER',
    );
  });

  it('drops returnTo when validation rejects the candidate', () => {
    expect(buildLoginHref('//evil.com')).toBe('/api/auth/login');
    expect(buildLoginHref('https://evil.com')).toBe('/api/auth/login');
  });
});
