import { createHash } from 'node:crypto';
import { WellknownService, computeKid } from './wellknown.service';
import { encodeBase64Url, decodeBase64Url } from '../../common/crypto/ed25519.util';
import { PLANS, TRIAL_LIFETIME_CAP } from '../billing/plans';
import type { AppConfigService } from '../../config/config.service';
import type { PlanTier } from '@prisma/client';

// 32-byte canonical "all-zeros" Ed25519 public key — fine for the hash test
// (we're testing the kid derivation, not the curve point validity).
const ZERO_KEY = new Uint8Array(32);
const ZERO_KEY_B64 = encodeBase64Url(ZERO_KEY);
const FIXED_ROTATED_AT = '2026-01-01T00:00:00.000Z';

function buildConfig(overrides: Partial<{ pub: string; rotatedAt: string }> = {}): AppConfigService {
  return {
    aegisSigningPublicKey: overrides.pub,
    aegisSigningKeyRotatedAt: overrides.rotatedAt,
  } as unknown as AppConfigService;
}

describe('WellknownService', () => {
  describe('onModuleInit / configuration', () => {
    it('throws a clear error when AEGIS_SIGNING_PUBLIC_KEY is missing', () => {
      const svc = new WellknownService(buildConfig({ rotatedAt: FIXED_ROTATED_AT }));
      expect(() => svc.onModuleInit()).toThrow(/AEGIS_SIGNING_PUBLIC_KEY env var must be set/);
    });

    it('throws a clear error when AEGIS_SIGNING_PUBLIC_KEY is empty', () => {
      const svc = new WellknownService(buildConfig({ pub: '', rotatedAt: FIXED_ROTATED_AT }));
      expect(() => svc.onModuleInit()).toThrow(/AEGIS_SIGNING_PUBLIC_KEY env var must be set/);
    });

    it('throws when the key decodes to the wrong length', () => {
      // 8-byte payload — definitely not 32.
      const tooShort = encodeBase64Url(new Uint8Array(8));
      const svc = new WellknownService(buildConfig({ pub: tooShort, rotatedAt: FIXED_ROTATED_AT }));
      expect(() => svc.onModuleInit()).toThrow(/decoded to 8 bytes; expected 32/);
    });

    it('flags rotatedAt as DEGRADED when AEGIS_SIGNING_KEY_ROTATED_AT is missing', () => {
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
        issuer: 'https://aegislabs.io',
        rotatedAt: FIXED_ROTATED_AT,
        purpose: 'audit-event-signing',
        verificationGuide: 'https://docs.aegislabs.io/audit/verify',
      });
    });

    it('jwks.json conforms to RFC 8037 Ed25519-in-JOSE', () => {
      const out = svc.getJwks();
      expect(out.keys).toHaveLength(1);
      const jwk = out.keys[0]!;
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

  describe('getAegisConfiguration — FAPI-2.0-aligned metadata (1.1.0)', () => {
    // Locks the wedge into the discovery surface: every claim made on the
    // marketing site that maps to a standards-binding should be discoverable
    // by `curl /.well-known/aegis-configuration` so a buyer can self-verify.
    let svc: WellknownService;

    beforeEach(() => {
      svc = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      svc.onModuleInit();
    });

    afterEach(() => {
      delete process.env.AEGIS_OP_POLICY_URI;
      delete process.env.AEGIS_OP_TOS_URI;
    });

    it('spec_version was bumped to 1.4.0 (RFC-9101 JAR promoted)', () => {
      const cfg = svc.getAegisConfiguration();
      expect(cfg.spec_version).toBe('1.4.0');
    });

    it('publishes a stable FAPI profile identifier', () => {
      const cfg = svc.getAegisConfiguration();
      expect(cfg.fapi_profile).toBe('aegis-fapi-2.0-aligned-1.0');
      expect(cfg.fapi_profile_spec_uri).toMatch(/05_FAPI_2_0_PROFILE/);
    });

    it('standards_implemented contains only standards backed by running code', () => {
      const cfg = svc.getAegisConfiguration();
      // Each RFC here must correspond to demonstrable behavior. Adding to
      // this list without a backing implementation is a CLAUDE.md invariant
      // #4 violation (no fabricated data). If you add an entry, add a test
      // that exercises the binding.
      expect(cfg.standards_implemented).toEqual(
        expect.arrayContaining([
          'RFC-8032', // EdDSA
          'RFC-7517', // JWKS
          'RFC-9116', // security.txt
          'RFC-9396', // RAR — promoted 2026-05-15
          'RFC-8414', // OAuth AS Metadata — promoted 2026-05-15
          'RFC-6749', // OAuth error envelope — promoted 2026-05-15
          'RFC-9101', // JAR — promoted 2026-05-16
        ]),
      );
      // Negative: only what's truly still roadmap'd remains here.
      expect(cfg.standards_implemented).not.toContain('RFC-9449'); // DPoP
      expect(cfg.standards_implemented).not.toContain('RFC-9421'); // HTTP Sig
    });

    it('standards_aligned contains only roadmap items NOT yet bindingly compliant', () => {
      const cfg = svc.getAegisConfiguration();
      expect(cfg.standards_aligned).toEqual(
        expect.arrayContaining([
          'RFC-9449', // DPoP
          'RFC-9421', // HTTP Message Signatures
        ]),
      );
      // Promoted RFCs must no longer appear in aligned.
      expect(cfg.standards_aligned).not.toContain('RFC-9396');
      expect(cfg.standards_aligned).not.toContain('RFC-8414');
      expect(cfg.standards_aligned).not.toContain('RFC-6749');
      expect(cfg.standards_aligned).not.toContain('RFC-9101');
    });

    it('RFC-8414 + RFC-6749 + RFC-9101 are in standards_implemented (1.3.0 + 1.4.0)', () => {
      const cfg = svc.getAegisConfiguration();
      expect(cfg.standards_implemented).toContain('RFC-8414');
      expect(cfg.standards_implemented).toContain('RFC-6749');
      expect(cfg.standards_implemented).toContain('RFC-9101');
      expect(cfg.standards_aligned).not.toContain('RFC-8414');
      expect(cfg.standards_aligned).not.toContain('RFC-6749');
      expect(cfg.standards_aligned).not.toContain('RFC-9101');
    });

    it('authorization_details_types_supported lists the 4 registered RAR types', () => {
      const cfg = svc.getAegisConfiguration();
      expect(cfg.authorization_details_types_supported).toEqual(
        expect.arrayContaining([
          'trading_order',
          'payment_initiation',
          'data_access',
          'agent_action',
        ]),
      );
      // The list must match REGISTERED_AUTH_DETAIL_TYPES in rar.types.ts;
      // any drift means the wedge claim ('RAR-implemented with 4 types') is
      // out of sync between the discovery doc and the evaluator. If you
      // add a type to rar.types.ts, add it to AUTHORIZATION_DETAILS_TYPES_SUPPORTED
      // in wellknown.service.ts in the same change.
      expect(cfg.authorization_details_types_supported).toHaveLength(4);
    });

    it('standards_implemented and standards_aligned are disjoint sets', () => {
      // A standard cannot be both "implemented" and "aligned" — those terms
      // are deliberately separated. If you start implementing something,
      // move it from aligned → implemented in one atomic change.
      const cfg = svc.getAegisConfiguration();
      const overlap = cfg.standards_implemented.filter((s) =>
        cfg.standards_aligned.includes(s),
      );
      expect(overlap).toEqual([]);
    });

    it('signing alg fields advertise EdDSA only (Ed25519 invariant per ADR-0002)', () => {
      const cfg = svc.getAegisConfiguration();
      expect(cfg.signing_alg_values_supported).toEqual(['EdDSA']);
      expect(cfg.agent_signing_alg_values_supported).toEqual(['EdDSA']);
    });

    it('agent_authentication_methods_supported names the bespoke ed25519_canonical_json (not FAPI private_key_jwt yet)', () => {
      // Honesty-by-construction: we do NOT yet implement RFC 7523 private_key_jwt
      // over JAR. The discovery doc names what we actually do today.
      const cfg = svc.getAegisConfiguration();
      expect(cfg.agent_authentication_methods_supported).toEqual([
        'ed25519_canonical_json',
      ]);
      expect(cfg.agent_authentication_methods_supported).not.toContain('private_key_jwt');
    });

    it('op_policy_uri is undefined when AEGIS_OP_POLICY_URI env is unset', () => {
      delete process.env.AEGIS_OP_POLICY_URI;
      const cfg = svc.getAegisConfiguration();
      expect(cfg.op_policy_uri).toBeUndefined();
    });

    it('op_policy_uri is populated when AEGIS_OP_POLICY_URI env is set', () => {
      process.env.AEGIS_OP_POLICY_URI = 'https://aegis.klytics.io/security';
      const cfg = svc.getAegisConfiguration();
      expect(cfg.op_policy_uri).toBe('https://aegis.klytics.io/security');
    });

    it('op_tos_uri follows the same env-override pattern', () => {
      delete process.env.AEGIS_OP_TOS_URI;
      expect(svc.getAegisConfiguration().op_tos_uri).toBeUndefined();
      process.env.AEGIS_OP_TOS_URI = 'https://aegis.klytics.io/terms';
      expect(svc.getAegisConfiguration().op_tos_uri).toBe('https://aegis.klytics.io/terms');
    });

    it('preserves all 1.0.0 + 1.1.0 + 1.2.0 fields (backwards-compatible additive only)', () => {
      // Locks the additive guarantee. If a future change removes any of
      // these, this test fails AND spec_version major bump is required.
      const cfg = svc.getAegisConfiguration();
      const requiredV1Fields: ReadonlyArray<keyof typeof cfg> = [
        'issuer', 'spec_version', 'api_version', 'documentation', 'openapi_spec',
        'jwks_uri', 'audit_signing_key_uri', 'endpoints', 'supported_algorithms',
        'supported_curves', 'denial_reasons', 'trust_bands', 'rate_limits',
        'supported_runtimes', 'sdks', 'build', 'security_txt', 'llms_txt',
        'retention_policy_uri', 'pricing_uri',
      ];
      for (const f of requiredV1Fields) {
        expect(cfg).toHaveProperty(f);
      }
    });
  });

  describe('getOAuthAuthorizationServerMetadata — RFC 8414 (1.3.0)', () => {
    // Locks the RFC 8414 binding. Buyers running OAuth/FAPI tooling
    // can fetch /.well-known/oauth-authorization-server and get a
    // parseable response with the AEGIS-honest subset of fields.
    let svc: WellknownService;

    beforeEach(() => {
      svc = new WellknownService(buildConfig({ pub: ZERO_KEY_B64, rotatedAt: FIXED_ROTATED_AT }));
      svc.onModuleInit();
    });

    afterEach(() => {
      delete process.env.AEGIS_OP_POLICY_URI;
      delete process.env.AEGIS_OP_TOS_URI;
    });

    it('contains RFC 8414 §2 required field `issuer`', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      expect(md.issuer).toBeDefined();
      expect(typeof md.issuer).toBe('string');
      expect(md.issuer.length).toBeGreaterThan(0);
    });

    it('contains RFC 8414 §2 required field `response_types_supported` (empty — AEGIS issues no auth codes)', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      // Empty array is honest, NOT lying-by-omission. AEGIS is not a
      // full OAuth AS; it does not issue authorization codes.
      expect(Array.isArray(md.response_types_supported)).toBe(true);
      expect(md.response_types_supported).toEqual([]);
    });

    it('contains jwks_uri pointing at /.well-known/jwks.json', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      expect(md.jwks_uri).toMatch(/\/\.well-known\/jwks\.json$/);
    });

    it('introspection_endpoint points at /v1/verify (verify IS the introspection-shaped decision)', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      expect(md.introspection_endpoint).toMatch(/\/v1\/verify$/);
      expect(md.introspection_endpoint_auth_methods_supported).toContain('api_key_bearer');
    });

    it('signing alg fields advertise EdDSA only (Ed25519 invariant)', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      expect(md.token_endpoint_auth_signing_alg_values_supported).toEqual(['EdDSA']);
      expect(md.request_object_signing_alg_values_supported).toEqual(['EdDSA']);
    });

    it('authorization_details_types_supported mirrors discovery doc (RFC 9396 cross-link)', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      const cfg = svc.getAegisConfiguration();
      expect(md.authorization_details_types_supported).toEqual(
        cfg.authorization_details_types_supported,
      );
    });

    it('aegis_service_type clearly disambiguates AEGIS from a full OAuth AS', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      expect(md.aegis_service_type).toBe('authorization-decision-and-audit-layer');
    });

    it('aegis_rar_evaluate_endpoint points at /v1/verify/rar/evaluate', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      expect(md.aegis_rar_evaluate_endpoint).toMatch(/\/v1\/verify\/rar\/evaluate$/);
    });

    it('aegis_fapi_profile matches the discovery doc fapi_profile field', () => {
      const md = svc.getOAuthAuthorizationServerMetadata();
      const cfg = svc.getAegisConfiguration();
      expect(md.aegis_fapi_profile).toBe(cfg.fapi_profile);
    });

    it('op_policy_uri / op_tos_uri honor the same env-override pattern as aegis-configuration', () => {
      delete process.env.AEGIS_OP_POLICY_URI;
      delete process.env.AEGIS_OP_TOS_URI;
      const md1 = svc.getOAuthAuthorizationServerMetadata();
      expect(md1.op_policy_uri).toBeUndefined();
      expect(md1.op_tos_uri).toBeUndefined();
      process.env.AEGIS_OP_POLICY_URI = 'https://aegis.klytics.io/security';
      process.env.AEGIS_OP_TOS_URI = 'https://aegis.klytics.io/terms';
      const md2 = svc.getOAuthAuthorizationServerMetadata();
      expect(md2.op_policy_uri).toBe('https://aegis.klytics.io/security');
      expect(md2.op_tos_uri).toBe('https://aegis.klytics.io/terms');
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
        expect(out.tiers[tier]!.audit_retention_days).toBe(PLANS[tier].auditRetentionDays);
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
      expect(out.operational.configurable_via_env).toBe('AEGIS_AUDIT_RETENTION_INTERVAL_MS');
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
        const dto = out.tiers[tier]!;
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
      expect(out.tiers.FREE!.lifetime_verify_quota).toBe(TRIAL_LIFETIME_CAP);
      expect(out.tiers.DEVELOPER!.lifetime_verify_quota).toBeNull();
      expect(out.tiers.GROWTH!.lifetime_verify_quota).toBeNull();
      expect(out.tiers.ENTERPRISE!.lifetime_verify_quota).toBeNull();
    });

    it('round-trips cleanly through JSON.stringify (no Infinity leaks)', () => {
      const out = svc.getPricing();
      const json = JSON.stringify(out);
      // JSON has no native Infinity — JSON.stringify(Infinity) === "null",
      // but we want our DTO to declare null intentionally rather than rely
      // on stringify behavior. Asserting the parsed shape proves it.
      const parsed = JSON.parse(json) as { tiers: Record<string, { monthly_verify_quota: number | null }> };
      expect(parsed.tiers.FREE!.monthly_verify_quota).toBeNull();
      expect(parsed.tiers.ENTERPRISE!.monthly_verify_quota).toBeNull();
    });
  });
});
