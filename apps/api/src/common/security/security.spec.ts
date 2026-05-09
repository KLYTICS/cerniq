// AEGIS — security hardening spec.
//
// Tests the pure helpers (parsers, depth-bomb guard, CORS delegate,
// trust-proxy resolution). The full Express integration is exercised by
// the e2e suite — these unit tests prove the building blocks are right.

import { buildCorsDelegate, isWildcard } from './cors-allowlist';
import { buildHelmetConfig, buildSecurityTxt } from './helmet-config';
import { stripPrototypeProperties } from './request-limits';
import { realClientIp, resolveTrustProxy } from './trust-proxy';

// ─── trust-proxy ────────────────────────────────────────────────────

describe('resolveTrustProxy', () => {
  it("'loopback' resolves to literal 'loopback' (Express named range)", () => {
    expect(resolveTrustProxy('loopback')).toBe('loopback');
  });

  it("'cloudflare' resolves to a CIDR list including v4 + v6 ranges", () => {
    const result = resolveTrustProxy('cloudflare');
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[]).length).toBeGreaterThan(15);
    expect(result).toContain('103.21.244.0/22');
    expect(result).toContain('2606:4700::/32');
  });

  it('custom CIDR list parses comma-separated', () => {
    const result = resolveTrustProxy('10.0.0.0/8, 192.168.0.0/16');
    expect(result).toEqual(['10.0.0.0/8', '192.168.0.0/16']);
  });
});

describe('realClientIp', () => {
  it('prefers CF-Connecting-IP when present', () => {
    const req = { headers: { 'cf-connecting-ip': '203.0.113.42' }, ip: '162.158.1.1' };
    expect(realClientIp(req as never)).toBe('203.0.113.42');
  });
  it('falls back to req.ip when CF header absent', () => {
    const req = { headers: {}, ip: '198.51.100.7' };
    expect(realClientIp(req as never)).toBe('198.51.100.7');
  });
  it("returns 'unknown' when neither is present", () => {
    const req = { headers: {} };
    expect(realClientIp(req as never)).toBe('unknown');
  });
});

// ─── cors-allowlist ─────────────────────────────────────────────────

describe('buildCorsDelegate', () => {
  const cb = (() => {
    const fn = jest.fn();
    return fn;
  })();

  it('returns wildcard CORS for /v1/verify (public hot path)', () => {
    const delegate = buildCorsDelegate({ managementOrigins: 'https://app.aegislabs.io' });
    delegate({ url: '/v1/verify', headers: { origin: 'https://random.com' } } as never, cb);
    const opts = cb.mock.lastCall?.[1];
    expect(opts.origin).toBe('*');
    expect(opts.credentials).toBe(false);
  });

  it('reflects allow-listed origin for management endpoints with credentials', () => {
    const delegate = buildCorsDelegate({ managementOrigins: 'https://app.aegislabs.io,https://docs.aegislabs.io' });
    delegate(
      { url: '/v1/agents/agt_abc', headers: { origin: 'https://app.aegislabs.io' } } as never,
      cb,
    );
    const opts = cb.mock.lastCall?.[1];
    expect(opts.origin).toBe('https://app.aegislabs.io');
    expect(opts.credentials).toBe(true);
  });

  it('rejects non-allow-listed origin (origin: false → no CORS header → browser blocks)', () => {
    const delegate = buildCorsDelegate({ managementOrigins: 'https://app.aegislabs.io' });
    delegate({ url: '/v1/agents/agt_abc', headers: { origin: 'https://evil.com' } } as never, cb);
    const opts = cb.mock.lastCall?.[1];
    expect(opts.origin).toBe(false);
    expect(opts.credentials).toBe(false);
  });

  it('isWildcard correctly identifies "*"', () => {
    expect(isWildcard('*')).toBe(true);
    expect(isWildcard(' * ')).toBe(true);
    expect(isWildcard('https://app.aegislabs.io')).toBe(false);
  });
});

// ─── helmet ─────────────────────────────────────────────────────────

describe('buildHelmetConfig', () => {
  it('enables HSTS with preload-list-eligible parameters in prod', () => {
    const cfg = buildHelmetConfig({ enableHsts: true });
    expect(cfg.strictTransportSecurity).toMatchObject({
      maxAge: 63_072_000,
      includeSubDomains: true,
      preload: true,
    });
  });

  it('disables HSTS in development', () => {
    const cfg = buildHelmetConfig({ enableHsts: false });
    expect(cfg.strictTransportSecurity).toBe(false);
  });

  it("CSP defaults to 'none' for everything (API only serves JSON)", () => {
    const cfg = buildHelmetConfig({ enableHsts: true });
    const csp = cfg.contentSecurityPolicy as { directives: Record<string, string[]> };
    expect(csp.directives.defaultSrc).toEqual(["'none'"]);
    expect(csp.directives.frameAncestors).toEqual(["'none'"]);
  });

  it('frameguard denies all frame embedding', () => {
    const cfg = buildHelmetConfig({ enableHsts: true });
    expect(cfg.frameguard).toEqual({ action: 'deny' });
  });
});

describe('buildSecurityTxt', () => {
  it('emits an RFC 9116-shaped security.txt with future Expires', () => {
    const out = buildSecurityTxt({ contactEmail: 'security@aegislabs.io' });
    expect(out).toMatch(/^Contact: mailto:security@aegislabs\.io$/m);
    expect(out).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
    expect(out).toMatch(/^Canonical: https:\/\/api\.aegislabs\.io/m);
  });
});

// ─── request-limits ─────────────────────────────────────────────────

describe('stripPrototypeProperties', () => {
  it('removes __proto__ at any depth', () => {
    const malicious = JSON.parse('{"a": 1, "__proto__": {"polluted": true}, "b": {"__proto__": {"x": 1}}}');
    const cleaned = stripPrototypeProperties(malicious);
    expect(cleaned).toEqual({ a: 1, b: {} });
  });

  it('removes constructor and prototype keys', () => {
    const malicious = { ok: 1, constructor: 'evil', prototype: { x: 1 } };
    expect(stripPrototypeProperties(malicious)).toEqual({ ok: 1 });
  });

  it('passes through arrays + primitives unchanged', () => {
    expect(stripPrototypeProperties([1, 'two', null, { x: 1 }])).toEqual([1, 'two', null, { x: 1 }]);
    expect(stripPrototypeProperties('plain')).toBe('plain');
    expect(stripPrototypeProperties(null)).toBe(null);
    expect(stripPrototypeProperties(undefined)).toBe(undefined);
  });
});
