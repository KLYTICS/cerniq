import { randomBytes } from 'node:crypto';

import type { AppConfigService } from '../../config/config.service';
import { InternalError } from '../errors/okoro-error';

import { WebhookSecretCipher } from './webhook-secret-cipher';

function stubConfig(opts: { dekB64?: string; nodeEnv?: 'development' | 'production' | 'test' } = {}): AppConfigService {
  // type-rationale: we stub only the two fields WebhookSecretCipher reads.
  // A full AppConfigService would force exporting the Zod schema purely for
  // tests; this narrow shape keeps the spec close to the actual contract.
  return {
    webhookSecretDekB64: opts.dekB64,
    nodeEnv: opts.nodeEnv ?? 'test',
  } as unknown as AppConfigService;
}

const DEK_A = randomBytes(32).toString('base64');
const DEK_B = randomBytes(32).toString('base64');

describe('WebhookSecretCipher', () => {
  it('round-trips a plaintext secret', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    const pt = 'whsec_abcDEF123_xyz';
    const ct = cipher.encrypt(pt);
    expect(ct.startsWith('v1:')).toBe(true);
    expect(cipher.decrypt(ct)).toBe(pt);
  });

  it('produces a different ciphertext on every call (fresh IV)', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    const pt = 'whsec_repeat';
    const a = cipher.encrypt(pt);
    const b = cipher.encrypt(pt);
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe(pt);
    expect(cipher.decrypt(b)).toBe(pt);
  });

  describe('isEncrypted', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    it('returns true on a v1: envelope', () => {
      expect(cipher.isEncrypted(cipher.encrypt('hello'))).toBe(true);
    });
    it('returns false on a legacy plaintext whsec_ value', () => {
      expect(cipher.isEncrypted('whsec_legacy_secret_value')).toBe(false);
    });
    it('returns false on the empty string', () => {
      expect(cipher.isEncrypted('')).toBe(false);
    });
  });

  it('rejects decryption with a different DEK (auth tag fails)', () => {
    const a = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    const b = new WebhookSecretCipher(stubConfig({ dekB64: DEK_B }));
    const ct = a.encrypt('whsec_only_a_can_decrypt');
    expect(() => b.decrypt(ct)).toThrow(InternalError);
  });

  it('rejects tampered ciphertext (auth tag fails)', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    const ct = cipher.encrypt('whsec_tamper_target');
    const parts = ct.split(':');
    // Flip one byte of the ciphertext segment.
    const ctBuf = Buffer.from(parts[3], 'base64url');
    ctBuf[0] = ctBuf[0] ^ 0x01;
    parts[3] = ctBuf.toString('base64url');
    const tampered = parts.join(':');
    expect(() => cipher.decrypt(tampered)).toThrow(InternalError);
  });

  it('rejects tampered IV (auth tag fails)', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    const ct = cipher.encrypt('whsec_iv_tamper');
    const parts = ct.split(':');
    const ivBuf = Buffer.from(parts[1], 'base64url');
    ivBuf[0] = ivBuf[0] ^ 0x01;
    parts[1] = ivBuf.toString('base64url');
    const tampered = parts.join(':');
    expect(() => cipher.decrypt(tampered)).toThrow(InternalError);
  });

  it('rejects tampered tag', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    const ct = cipher.encrypt('whsec_tag_tamper');
    const parts = ct.split(':');
    const tagBuf = Buffer.from(parts[2], 'base64url');
    tagBuf[0] = tagBuf[0] ^ 0x01;
    parts[2] = tagBuf.toString('base64url');
    const tampered = parts.join(':');
    expect(() => cipher.decrypt(tampered)).toThrow(InternalError);
  });

  it('rejects malformed envelopes (wrong segment count)', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    expect(() => cipher.decrypt('v1:onlyonefield')).toThrow(InternalError);
    expect(() => cipher.decrypt('v1:a:b')).toThrow(InternalError);
    expect(() => cipher.decrypt('not-an-envelope')).toThrow(InternalError);
    expect(() => cipher.decrypt('')).toThrow(InternalError);
  });

  it('rejects unsupported version tags', () => {
    const cipher = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    // Build a structurally valid 4-segment value with v2 prefix.
    const ct = cipher.encrypt('hi');
    const swapped = 'v2' + ct.slice(2);
    // isEncrypted only checks `v1:`, so this should not be encrypted-shaped.
    expect(cipher.isEncrypted(swapped)).toBe(false);
    expect(() => cipher.decrypt(swapped)).toThrow(InternalError);
  });

  it('two different DEKs produce non-overlapping ciphertexts that cannot cross-decrypt', () => {
    const a = new WebhookSecretCipher(stubConfig({ dekB64: DEK_A }));
    const b = new WebhookSecretCipher(stubConfig({ dekB64: DEK_B }));
    const pt = 'whsec_cross_check';
    const ctA = a.encrypt(pt);
    const ctB = b.encrypt(pt);
    expect(ctA).not.toBe(ctB);
    expect(a.decrypt(ctA)).toBe(pt);
    expect(b.decrypt(ctB)).toBe(pt);
    expect(() => a.decrypt(ctB)).toThrow(InternalError);
    expect(() => b.decrypt(ctA)).toThrow(InternalError);
  });

  describe('boot-time DEK handling', () => {
    it('throws in production when DEK is missing', () => {
      expect(() => new WebhookSecretCipher(stubConfig({ nodeEnv: 'production' }))).toThrow(InternalError);
    });

    it('generates an ephemeral DEK and warns in development', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Late-bound to avoid jest mock hoisting interactions; static import causes the spy to wire up on the wrong prototype.
      const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const cipher = new WebhookSecretCipher(stubConfig({ nodeEnv: 'development' }));
        expect(warn).toHaveBeenCalled();
        const msg = warn.mock.calls[0]?.[0];
        expect(typeof msg).toBe('string');
        expect(msg).toContain('OKORO_WEBHOOK_SECRET_DEK_B64');
        // Sanity: the cipher with its ephemeral key still round-trips.
        expect(cipher.decrypt(cipher.encrypt('x'))).toBe('x');
      } finally {
        warn.mockRestore();
      }
    });

    it('rejects a DEK that is not 32 bytes', () => {
      const shortDek = randomBytes(16).toString('base64');
      expect(() => new WebhookSecretCipher(stubConfig({ dekB64: shortDek }))).toThrow(InternalError);
    });
  });
});
