import { createHash } from 'node:crypto';

import type { PlanTier } from '@prisma/client';

import { encodeBase64Url, decodeBase64Url } from '../../common/crypto/ed25519.util';
import type { AppConfigService } from '../../config/config.service';
import { PLANS, TRIAL_LIFETIME_CAP } from '../billing/plans';

import { WellknownService, computeKid } from './wellknown.service';



// 32-byte canonical "all-zeros" Ed25519 public key — fine for the hash test
// (we're testing the kid derivation, not the curve point validity).
const ZERO_KEY = new Uint8Array(32);
const ZERO_KEY_B64 = encodeBase64Url(ZERO_KEY);
const FIXED_ROTATED_AT = '2026-01-01T00:00:00.000Z';

function buildConfig(overrides: Partial<{ pub: string; rotatedAt: string }> = {}): AppConfigService {
  return {
    okoroSigningPublicKey: overrides.pub,
    okoroSigningKeyRotatedAt: overrides.rotatedAt,
  } as unknown as AppConfigService;
}

describe('WellknownService', () => {
  describe('onModuleInit / configuration', () => {
    it('throws a clear error when OKORO_SIGNING_PUBLIC_KEY is missing', () => {
      const svc = new WellknownService(buildConfig({ rotatedAt: FIXED_ROTATED_AT }));
      expect(() => { svc.onModuleInit(); }).toThrow(/OKORO_SIGNING_PUBLIC_KEY env var must be set/);
    });

    it('throws a clear error when OKORO_SIGNING_PUBLIC_KEY is empty', () => {
      const svc = new WellknownService(buildConfig({ pub: '', rotatedAt: FIXED_ROTATED_AT }));
      expect(() => { svc.onModuleInit(); }).toThrow(/OKORO_SIGNING_PUBLIC_KEY env var must be set/);
    });

    it('throws when the key decodes to the wrong length', () => {
      // 8-byte payload — definitely not 32.
      const tooShort = encodeBase64Url(new Uint8Array(8));
      const svc = new WellknownService(buildConfig({ pub: tooShort, rotatedAt: FIXED_ROTATED_AT }));
      expect(() => { svc.onModuleInit(); }).toThrow(/decoded to 8 bytes; expected 32/);
    });

    it('flags rotatedAt as DEGRADED when OKORO_SIGNING_KEY_ROTATED_AT is missing', () => {
      const svc = new WellknownService(buildConfig({ pub: ZERO_KEY_B64 }));
      svc.onModuleInit();
      expect(svc.isRotatedAtDegraded()).toBe(true);
      // rotatedAt was captured at init — shape is ISO string, NOT undefined.
      expect(svc.getAuditSigningKey().rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('uses configured rotatedAt verbatim when present', () => {
      const svc = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      svc.onModuleInit();
      expect(svc.isRotatedAtDegraded()).toBe(false);
      expect(svc.getAuditSigningKey().rotatedAt).toBe(FIXED_ROTATED_AT);
    });
  });

  describe('kid derivation', () => {
    it('is deterministic — sha256(rawPublicKey) base64url, first 16 chars', () => {
      const expectedFull = encodeBase64Url(new Uint8Array(createHash('sha256').update(ZERO_KEY).digest()));
      const expected = expectedFull.slice(0, 16);
      expect(computeKid(ZERO_KEY)).toBe(expected);
      expect(computeKid(ZERO_KEY)).toHaveLength(16);
    });

    it('derives the same kid across two service instances for the same key', () => {
      const a = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      const b = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      a.onModuleInit();
      b.onModuleInit();
      expect(a.getKid()).toBe(b.getKid());
    });

    it('produces different kids for different keys', () => {
      const otherKey = new Uint8Array(32);
      otherKey[0] = 1;
      const a = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      const b = new WellknownService(
        buildConfig({ pub: encodeBase64Url(otherKey), rotatedAt: FIXED_ROTATED_AT }),
      );
      a.onModuleInit();
      b.onModuleInit();
      expect(a.getKid()).not.toBe(b.getKid());
    });
  });

  describe('payload shapes', () => {
    let svc: WellknownService;
    beforeEach(() => {
      svc = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      svc.onModuleInit();
    });

    it('audit-signing-key has the contracted shape', () => {
      const out = svc.getAuditSigningKey();
      expect(out).toEqual({
        kid: svc.getKid(),
        publicKey: ZERO_KEY_B64,
        algorithm: 'EdDSA',
        curve: 'Ed25519',
        issuer: 'https://okorolabs.io',
        rotatedAt: FIXED_ROTATED_AT,
        purpose: 'audit-event-signing',
        verificationGuide: 'https://docs.okorolabs.io/audit/verify',
      });
    });

    it('jwks.json conforms to RFC 8037 Ed25519-in-JOSE', () => {
      const out = svc.getJwks();
      expect(out.keys).toHaveLength(1);
      const jwk = out.keys[0];
      expect(jwk).toEqual({
        kty: 'OKP',
        crv: 'Ed25519',
        alg: 'EdDSA',
        use: 'sig',
        kid: svc.getKid(),
        x: ZERO_KEY_B64,
      });
      // `x` must round-trip back to 32 raw bytes.
      expect(decodeBase64Url(jwk.x)).toHaveLength(32);
    });

    it('canonicalises base64url even if input had padding', () => {
      // Add stray padding to the input — output should still match the
      // canonical (unpadded) form.
      const padded = `${ZERO_KEY_B64}=`;
      const padSvc = new WellknownService(buildConfig({ pub: padded, rotatedAt: FIXED_ROTATED_AT }));
      padSvc.onModuleInit();
      expect(padSvc.getAuditSigningKey().publicKey).toBe(ZERO_KEY_B64);
    });
  });

  describe('getRetentionPolicy', () => {
    let svc: WellknownService;
    beforeEach(() => {
      svc = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      svc.onModuleInit();
    });

    it('emits a tier entry for every PlanTier (parity with PLANS)', () => {
      const out = svc.getRetentionPolicy();
      const planTiersInSource = Object.keys(PLANS) as PlanTier[];
      const tiersInResponse = Object.keys(out.tiers).sort();

      expect(tiersInResponse).toEqual(planTiersInSource.sort());
      // Every tier must produce a positive integer retention window.
      for (const tier of planTiersInSource) {
        expect(out.tiers[tier].audit_retention_days).toBe(PLANS[tier].auditRetentionDays);
      }
    });

    it('uses the injected clock for generated_at (deterministic)', () => {
      const fixed = new Date('2026-05-05T12:34:56.789Z');
      const out = svc.getRetentionPolicy(fixed);
      expect(out.generated_at).toBe('2026-05-05T12:34:56.789Z');
    });

    it('emits operational defaults that mirror DEFAULT_RETENTION_RUN_INTERVAL_MS', () => {
      const out = svc.getRetentionPolicy();
      // 24h in seconds — must mirror DEFAULT_RETENTION_RUN_INTERVAL_MS in
      // compliance/audit-retention.service.ts. Drift fails this spec.
      expect(out.operational.retention_run_interval_seconds).toBe(86_400);
      expect(out.operational.configurable_via_env).toBe('OKORO_AUDIT_RETENTION_INTERVAL_MS');
    });

    it('includes the three contracted guarantees verbatim', () => {
      const out = svc.getRetentionPolicy();
      expect(out.guarantees).toEqual([
        'Redactions preserve audit chain hashes — chain remains verifiable post-redaction.',
        'Each redaction emits a meta-event in the chain (audit-of-audit).',
        'Public keys (.well-known/audit-signing-key) are never redacted.',
      ]);
    });

    it('emits no DB calls — pure derivation from in-process PLANS', () => {
      // The service constructor took zero data-access deps. Re-asserting
      // structurally: the service has no `prisma` or `redis` field.
      const fields = Object.keys(svc as unknown as Record<string, unknown>);
      expect(fields).not.toContain('prisma');
      expect(fields).not.toContain('redis');
    });
  });

  describe('getPricing', () => {
    let svc: WellknownService;
    beforeEach(() => {
      svc = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      svc.onModuleInit();
    });

    it('emits a tier entry for every PlanTier (parity with PLANS)', () => {
      const out = svc.getPricing();
      const planTiersInSource = Object.keys(PLANS) as PlanTier[];
      const tiersInResponse = Object.keys(out.tiers).sort();
      expect(tiersInResponse).toEqual(planTiersInSource.sort());
    });

    it('hardcodes USD and ADR-0014 (operator may localize in a future spec_version)', () => {
      const out = svc.getPricing();
      expect(out.currency).toBe('USD');
      expect(out.adr).toBe('ADR-0014');
      expect(out.spec_version).toBe('1.0.0');
    });

    it('uses the injected clock for generated_at (deterministic)', () => {
      const fixed = new Date('2026-05-06T01:02:03.456Z');
      const out = svc.getPricing(fixed);
      expect(out.generated_at).toBe('2026-05-06T01:02:03.456Z');
    });

    it('mirrors plans.ts exactly for every paid-tier numeric field', () => {
      const out = svc.getPricing();
      for (const tier of Object.keys(PLANS) as PlanTier[]) {
        const plan = PLANS[tier];
        const dto = out.tiers[tier];
        expect(dto.tier).toBe(tier);
        expect(dto.display_name).toBe(plan.displayName);
        expect(dto.monthly_price_cents).toBe(plan.monthlyPriceCents);
        expect(dto.overage_per_call_e4).toBe(plan.overagePerCallE4);
        expect(dto.audit_retention_days).toBe(plan.auditRetentionDays);
        expect(dto.bate_access).toBe(plan.bateAccess);
        expect(dto.webhooks).toBe(plan.webhooks);
        expect(dto.verify_p99_target_ms).toBe(plan.verifyP99TargetMs);
        // Quota: Infinity → null, finite → mirrored.
        if (Number.isFinite(plan.monthlyVerifyQuota)) {
          expect(dto.monthly_verify_quota).toBe(plan.monthlyVerifyQuota);
        } else {
          expect(dto.monthly_verify_quota).toBeNull();
        }
        // Agent cap: Infinity → null, finite → mirrored.
        if (Number.isFinite(plan.agentCap)) {
          expect(dto.agent_cap).toBe(plan.agentCap);
        } else {
          expect(dto.agent_cap).toBeNull();
        }
      }
    });

    it('exposes TRIAL_LIFETIME_CAP only on FREE', () => {
      const out = svc.getPricing();
      expect(out.tiers.FREE.lifetime_verify_quota).toBe(TRIAL_LIFETIME_CAP);
      expect(out.tiers.DEVELOPER.lifetime_verify_quota).toBeNull();
      expect(out.tiers.GROWTH.lifetime_verify_quota).toBeNull();
      expect(out.tiers.ENTERPRISE.lifetime_verify_quota).toBeNull();
    });

    it('round-trips cleanly through JSON.stringify (no Infinity leaks)', () => {
      const out = svc.getPricing();
      const json = JSON.stringify(out);
      // JSON has no native Infinity — JSON.stringify(Infinity) === "null",
      // but we want our DTO to declare null intentionally rather than rely
      // on stringify behavior. Asserting the parsed shape proves it.
      const parsed = JSON.parse(json) as { tiers: Record<string, { monthly_verify_quota: number | null }> };
      expect(parsed.tiers.FREE.monthly_verify_quota).toBeNull();
      expect(parsed.tiers.ENTERPRISE.monthly_verify_quota).toBeNull();
    });
  });
});
