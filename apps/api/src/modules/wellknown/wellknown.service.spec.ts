import { createHash } from 'node:crypto';
import { WellknownService, computeKid } from './wellknown.service';
import { encodeBase64Url, decodeBase64Url } from '../../common/crypto/ed25519.util';
import type { AppConfigService } from '../../config/config.service';

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
});
