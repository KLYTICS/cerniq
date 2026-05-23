import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { encodeBase64Url } from '../../common/crypto/ed25519.util';
import type { AppConfigService } from '../../config/config.service';

import { WellknownController, etagMatches, quotedEtag } from './wellknown.controller';
import { WellknownService } from './wellknown.service';

const ZERO_KEY_B64 = encodeBase64Url(new Uint8Array(32));
const FIXED_ROTATED_AT = '2026-01-01T00:00:00.000Z';

function buildService(): WellknownService {
  const config = {
    cerniqSigningPublicKey: ZERO_KEY_B64,
    cerniqSigningKeyRotatedAt: FIXED_ROTATED_AT,
    apiBaseUrl: 'https://api.cerniq.io',
  } as unknown as AppConfigService;
  const svc = new WellknownService(config);
  svc.onModuleInit();
  return svc;
}

interface FakeRes {
  res: Response;
  headers: Record<string, string>;
  status: jest.Mock;
}

function fakeResponse(): FakeRes {
  const headers: Record<string, string> = {};
  const status = jest.fn();
  const res = {
    setHeader: jest.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status,
  } as unknown as Response;
  return { res, headers, status };
}

describe('WellknownController', () => {
  describe('GET /.well-known/audit-signing-key', () => {
    it('returns the full payload + ETag matching kid on first hit', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.auditSigningKey(undefined, res);

      expect(out).toBeDefined();
      expect(out!.kid).toBe(svc.getKid());
      expect(out!.publicKey).toBe(ZERO_KEY_B64);
      expect(out!.algorithm).toBe('EdDSA');
      expect(out!.curve).toBe('Ed25519');
      expect(out!.issuer).toBe('https://cerniq.io');
      expect(out!.purpose).toBe('audit-event-signing');
      expect(out!.rotatedAt).toBe(FIXED_ROTATED_AT);
      expect(headers.etag).toBe(`"${svc.getKid()}"`);
      expect(headers['content-type']).toMatch(/application\/json/);
    });

    it('returns 304 when If-None-Match matches the current kid', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      const out = ctl.auditSigningKey(`"${svc.getKid()}"`, res);

      expect(out).toBeUndefined();
      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('returns 200 when If-None-Match does not match', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      const out = ctl.auditSigningKey('"some-other-kid"', res);

      expect(out).toBeDefined();
      expect(status).not.toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('honours the wildcard If-None-Match: *', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      ctl.auditSigningKey('*', res);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('honours weak validators (W/"<kid>")', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      ctl.auditSigningKey(`W/"${svc.getKid()}"`, res);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });
  });

  describe('GET /.well-known/jwks.json', () => {
    it('returns RFC 8037-shaped JWKS + jwk-set+json content-type', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.jwks(undefined, res);

      expect(out).toBeDefined();
      expect(out!.keys).toHaveLength(1);
      expect(out!.keys[0]).toMatchObject({
        kty: 'OKP',
        crv: 'Ed25519',
        alg: 'EdDSA',
        use: 'sig',
        kid: svc.getKid(),
        x: ZERO_KEY_B64,
      });
      expect(headers.etag).toBe(`"${svc.getKid()}"`);
      expect(headers['content-type']).toMatch(/application\/jwk-set\+json/);
    });

    it('returns 304 on If-None-Match match', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      const out = ctl.jwks(`"${svc.getKid()}"`, res);

      expect(out).toBeUndefined();
      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('uses the same kid as audit-signing-key (single source of truth)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);

      const a = ctl.auditSigningKey(undefined, fakeResponse().res);
      const b = ctl.jwks(undefined, fakeResponse().res);

      expect(a!.kid).toBe(b!.keys[0].kid);
    });
  });

  describe('etagMatches helper', () => {
    const etag = quotedEtag('abc123');

    it('returns false when If-None-Match is undefined or empty', () => {
      expect(etagMatches(undefined, etag)).toBe(false);
      expect(etagMatches('', etag)).toBe(false);
    });

    it('matches exact and wildcard', () => {
      expect(etagMatches(etag, etag)).toBe(true);
      expect(etagMatches('*', etag)).toBe(true);
    });

    it('matches comma-separated lists', () => {
      expect(etagMatches(`"old", ${etag}, "newer"`, etag)).toBe(true);
    });

    it('matches weak validators', () => {
      expect(etagMatches(`W/${etag}`, etag)).toBe(true);
    });

    it('does NOT match unrelated tags', () => {
      expect(etagMatches('"different"', etag)).toBe(false);
    });
  });

  describe('GET /.well-known/cerniq-configuration', () => {
    it('returns the full discovery doc with stable schema', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.configuration(res);

      expect(out.issuer).toBe('https://api.cerniq.io');
      expect(out.spec_version).toBe('1.0.0');
      expect(out.jwks_uri).toBe('https://api.cerniq.io/.well-known/jwks.json');
      expect(out.audit_signing_key_uri).toBe('https://api.cerniq.io/.well-known/audit-signing-key');
      expect(out.security_txt).toBe('https://api.cerniq.io/.well-known/security.txt');
      expect(out.llms_txt).toBe('https://api.cerniq.io/.well-known/llms.txt');
      expect(out.endpoints.verify).toBe('https://api.cerniq.io/v1/verify');
      expect(out.endpoints.billing_webhook).toBe('https://api.cerniq.io/v1/billing/webhook');
      expect(out.supported_algorithms).toEqual(['EdDSA']);
      expect(out.supported_curves).toEqual(['Ed25519']);
      expect(out.trust_bands).toEqual(['FLAGGED', 'WATCH', 'VERIFIED', 'PLATINUM']);
      expect(headers['content-type']).toMatch(/application\/json/);
    });

    it('locks the canonical denial precedence order (ADR-0004)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.configuration(fakeResponse().res);

      expect(out.denial_reasons).toEqual([
        'AGENT_NOT_FOUND',
        'AGENT_REVOKED',
        'INVALID_SIGNATURE',
        'POLICY_REVOKED',
        'POLICY_EXPIRED',
        'SCOPE_NOT_GRANTED',
        'SPEND_LIMIT_EXCEEDED',
        'TRUST_SCORE_TOO_LOW',
        'ANOMALY_FLAGGED',
      ]);
    });

    it('lists every official SDK package by canonical name', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.configuration(fakeResponse().res);

      expect(out.sdks.typescript).toBe('@cerniq/sdk');
      expect(out.sdks.python).toBe('cerniq');
      expect(out.sdks.verifier_rp).toBe('@cerniq/verifier-rp');
      expect(out.sdks.mcp_bridge).toBe('@cerniq/mcp-bridge');
      expect(out.sdks.mcp_server).toBe('@cerniq/mcp-server');
    });

    it('falls back to canonical issuer when apiBaseUrl is unset', () => {
      const config = {
        cerniqSigningPublicKey: ZERO_KEY_B64,
        cerniqSigningKeyRotatedAt: FIXED_ROTATED_AT,
        apiBaseUrl: undefined,
      } as unknown as AppConfigService;
      const svc = new WellknownService(config);
      svc.onModuleInit();
      const ctl = new WellknownController(svc);
      const out = ctl.configuration(fakeResponse().res);

      expect(out.issuer).toBe('https://cerniq.io');
    });
  });

  describe('GET /.well-known/security.txt', () => {
    it('returns RFC 9116 plain text with mandatory Expires field', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.securityTxt(res);

      expect(out).toContain('Contact: mailto:security@cerniq.io');
      expect(out).toMatch(/Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(out).toContain('Preferred-Languages: en');
      expect(out).toContain('Canonical: https://api.cerniq.io/.well-known/security.txt');
      expect(out).toContain('Policy:');
      expect(headers['content-type']).toMatch(/text\/plain/);
    });

    it('Expires is roughly 365 days in the future', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.securityTxt(fakeResponse().res);

      const match = /Expires: (\S+)/.exec(out);
      expect(match).toBeTruthy();
      const expires = new Date(match![1]);
      const days = (expires.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(360);
      expect(days).toBeLessThan(370);
    });
  });

  describe('GET /.well-known/llms.txt', () => {
    it('returns markdown listing the public surfaces', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.llmsTxt(res);

      expect(out).toContain('# CERNIQ — Agent Gateway & Identity Stack');
      expect(out).toContain('https://api.cerniq.io/.well-known/cerniq-configuration');
      expect(out).toContain('POST https://api.cerniq.io/v1/verify');
      expect(out).toContain('npm install @cerniq/sdk');
      expect(out).toContain('pip install cerniq');
      expect(out).toContain('npm install @cerniq/verifier-rp');
      expect(out).toContain('AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE');
      expect(headers['content-type']).toMatch(/text\/markdown/);
    });
  });

  describe('GET /.well-known/retention-policy.json', () => {
    it('returns the contracted shape with all four PlanTier keys', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.retentionPolicy(res);

      expect(out.spec_version).toBe('1.0.0');
      expect(out.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Object.keys(out.tiers).sort()).toEqual(['DEVELOPER', 'ENTERPRISE', 'FREE', 'GROWTH']);
      expect(out.guarantees).toHaveLength(3);
      expect(out.guarantees[0]).toContain('chain remains verifiable');
      expect(out.operational.retention_run_interval_seconds).toBe(86_400);
      expect(out.operational.configurable_via_env).toBe('CERNIQ_AUDIT_RETENTION_INTERVAL_MS');
      expect(headers['content-type']).toMatch(/application\/json/);
      expect(headers['cache-control']).toBeUndefined();
      // Cache-Control comes from a Nest @Header decorator — fakeResponse only
      // sees handler-set headers, which is correct.
    });

    it('reflects the canonical retention_days from plans.ts (parity)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.retentionPolicy(fakeResponse().res);

      // Hard-coded mirror — drift means plans.ts changed and this spec
      // catches it. Update both intentionally with an ADR.
      expect(out.tiers.FREE.audit_retention_days).toBe(30);
      expect(out.tiers.DEVELOPER.audit_retention_days).toBe(90);
      expect(out.tiers.GROWTH.audit_retention_days).toBe(365);
      expect(out.tiers.ENTERPRISE.audit_retention_days).toBe(7 * 365);
    });

    it('emits a retention_reason format that matches audit-retention.service.ts', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.retentionPolicy(fakeResponse().res);

      expect(out.tiers.FREE.redaction_reason_format).toBe('retention_policy:plan=FREE:days=30');
      expect(out.tiers.DEVELOPER.redaction_reason_format).toBe(
        'retention_policy:plan=DEVELOPER:days=90',
      );
      expect(out.tiers.GROWTH.redaction_reason_format).toBe(
        'retention_policy:plan=GROWTH:days=365',
      );
      expect(out.tiers.ENTERPRISE.redaction_reason_format).toBe(
        'retention_policy:plan=ENTERPRISE:days=2555',
      );
    });

    it('marks every tier as redact-not-delete (chain integrity guarantee)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.retentionPolicy(fakeResponse().res);

      for (const key of Object.keys(out.tiers)) {
        expect(out.tiers[key].redaction_method).toBe('redact-not-delete');
      }
    });
  });

  describe('cerniq-configuration advertises retention-policy.json', () => {
    it('exposes retention_policy_uri pointing at the new well-known endpoint', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.configuration(fakeResponse().res);

      expect(out.retention_policy_uri).toBe(
        'https://api.cerniq.io/.well-known/retention-policy.json',
      );
    });
  });

  describe('cerniq-configuration advertises pricing.json', () => {
    it('exposes pricing_uri pointing at the new well-known endpoint', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.configuration(fakeResponse().res);

      expect(out.pricing_uri).toBe('https://api.cerniq.io/.well-known/pricing.json');
    });
  });

  describe('GET /.well-known/pricing.json', () => {
    it('returns the contracted shape with all four PlanTier keys', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.pricing(res);

      expect(out.spec_version).toBe('1.0.0');
      expect(out.currency).toBe('USD');
      expect(out.adr).toBe('ADR-0014');
      expect(out.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Object.keys(out.tiers).sort()).toEqual(['DEVELOPER', 'ENTERPRISE', 'FREE', 'GROWTH']);
      expect(out.currency_overage_unit).toContain('10⁻⁴');
      expect(out.billing_endpoints).toEqual({
        checkout: '/v1/billing/checkout',
        portal: '/v1/billing/portal',
        plan: '/v1/billing/plan',
      });
      expect(headers['content-type']).toMatch(/application\/json/);
    });

    it('encodes Number.POSITIVE_INFINITY as JSON null for FREE + ENTERPRISE quotas', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.pricing(fakeResponse().res);

      expect(out.tiers.FREE.monthly_verify_quota).toBeNull();
      expect(out.tiers.ENTERPRISE.monthly_verify_quota).toBeNull();
      expect(out.tiers.ENTERPRISE.agent_cap).toBeNull();
      // And the round-trip through JSON.stringify must not emit `null`-but-
      // also-not the literal string "Infinity".
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain('Infinity');
    });

    it('exposes lifetime_verify_quota only on FREE (TRIAL_LIFETIME_CAP)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.pricing(fakeResponse().res);

      expect(out.tiers.FREE.lifetime_verify_quota).toBe(10_000);
      expect(out.tiers.DEVELOPER.lifetime_verify_quota).toBeNull();
      expect(out.tiers.GROWTH.lifetime_verify_quota).toBeNull();
      expect(out.tiers.ENTERPRISE.lifetime_verify_quota).toBeNull();
    });

    it('mirrors monthly_price_cents from plans.ts (null for ENTERPRISE)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.pricing(fakeResponse().res);

      expect(out.tiers.FREE.monthly_price_cents).toBe(0);
      expect(out.tiers.DEVELOPER.monthly_price_cents).toBe(4_900);
      expect(out.tiers.GROWTH.monthly_price_cents).toBe(29_900);
      expect(out.tiers.ENTERPRISE.monthly_price_cents).toBeNull();
    });

    it('exposes the raw E4 overage rate (8 = $0.0008/verify) on paid metered tiers', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.pricing(fakeResponse().res);

      expect(out.tiers.FREE.overage_per_call_e4).toBeNull();
      expect(out.tiers.DEVELOPER.overage_per_call_e4).toBe(8);
      expect(out.tiers.GROWTH.overage_per_call_e4).toBe(8);
      expect(out.tiers.ENTERPRISE.overage_per_call_e4).toBeNull();
    });

    it('mirrors display names from plans.ts (Team rebrand for GROWTH)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const out = ctl.pricing(fakeResponse().res);

      expect(out.tiers.FREE.display_name).toBe('Free trial');
      expect(out.tiers.DEVELOPER.display_name).toBe('Developer');
      expect(out.tiers.GROWTH.display_name).toBe('Team');
      expect(out.tiers.ENTERPRISE.display_name).toBe('Enterprise');
    });
  });
});
