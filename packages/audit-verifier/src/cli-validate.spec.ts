import { describe, expect, it } from 'vitest';

import {
  ManifestValidationError,
  SAFE_MANIFEST_IDENTIFIER,
  validateSignedManifest,
} from './cli-validate.js';

/**
 * Build a baseline well-formed signed-manifest shape that the
 * validator accepts. Tests override individual fields to exercise
 * specific rejection paths.
 */
function baseManifest(overrides: { body?: Record<string, unknown> } & Record<string, unknown> = {}) {
  const { body: bodyOverride, ...topOverride } = overrides;
  return {
    signatureAlg: 'ed25519',
    signatureB64Url: 'sig-base64url-placeholder',
    ...topOverride,
    body: {
      manifestId: 'manifest-2026-05-15-001',
      tenantSliceId: 'tenant-01HXX:bucket-7',
      signingKeyId: 'kid-genesis-v1',
      firstSeq: 1,
      lastSeq: 100,
      rowCount: 100,
      ...(bodyOverride ?? {}),
    },
  };
}

describe('SAFE_MANIFEST_IDENTIFIER', () => {
  it.each([
    'kid-genesis-v1',
    'tenant-01HXX:bucket-7',
    'manifest_with_underscores',
    'has.dots.in.id',
    'A',
    'a'.repeat(128),
  ])('accepts %s', (s) => {
    expect(SAFE_MANIFEST_IDENTIFIER.test(s)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['ANSI escape (red)', '\x1b[31mkid-bad'],
    ['NUL byte', 'kid\x00bad'],
    ['newline', 'kid\nbad'],
    ['space', 'kid bad'],
    ['backtick', 'kid`bad'],
    ['dollar', 'kid$bad'],
    ['semicolon', 'kid;bad'],
    ['shell pipe', 'kid|bad'],
    ['non-ASCII', 'kid–emdash'],
    ['too long (129)', 'a'.repeat(129)],
  ])('rejects %s', (_label, s) => {
    expect(SAFE_MANIFEST_IDENTIFIER.test(s)).toBe(false);
  });
});

describe('validateSignedManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = baseManifest();
    expect(() => validateSignedManifest(m, 'ok.manifest.json')).not.toThrow();
  });

  it('rejects non-object root', () => {
    expect(() => validateSignedManifest(null, 'x')).toThrow(ManifestValidationError);
    expect(() => validateSignedManifest('not-an-object', 'x')).toThrow(/top-level/);
  });

  it('rejects missing body', () => {
    const m = { signatureAlg: 'ed25519', signatureB64Url: 'sig' };
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body/);
  });

  it('rejects missing signatureB64Url', () => {
    const m = baseManifest();
    delete (m as Record<string, unknown>).signatureB64Url;
    expect(() => validateSignedManifest(m, 'x')).toThrow(/signatureB64Url/);
  });

  it('rejects non-ed25519 signatureAlg', () => {
    const m = baseManifest({ signatureAlg: 'rs256' });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/signatureAlg/);
  });

  // ── identifier charset enforcement ───────────────────────────────────────

  it('rejects ANSI escape sequence in signingKeyId — terminal-injection guard', () => {
    const m = baseManifest({ body: { signingKeyId: '\x1b[31mkid-bad' } });
    try {
      validateSignedManifest(m, 'attack.manifest.json');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestValidationError);
      const ve = err as ManifestValidationError;
      expect(ve.field).toBe('body.signingKeyId');
      // The offending value itself MUST NOT appear in the error message —
      // we are not going to print attacker bytes to the operator's terminal
      // even via the rejection path.
      expect(ve.message).not.toContain('\x1b');
      expect(ve.message).toContain('disallowed characters');
    }
  });

  it('rejects newline in tenantSliceId', () => {
    const m = baseManifest({ body: { tenantSliceId: 'tenant-x\nbucket-7' } });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body\.tenantSliceId/);
  });

  it('rejects shell metacharacter in manifestId', () => {
    const m = baseManifest({ body: { manifestId: 'manifest;$(rm -rf /)' } });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body\.manifestId/);
  });

  it('rejects identifier over 128 chars', () => {
    const m = baseManifest({ body: { manifestId: 'a'.repeat(129) } });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body\.manifestId/);
  });

  it('rejects empty-string identifier', () => {
    const m = baseManifest({ body: { signingKeyId: '' } });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body\.signingKeyId/);
  });

  // ── numeric field validation ─────────────────────────────────────────────

  it('rejects string in numeric field', () => {
    const m = baseManifest({ body: { firstSeq: '100' } });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body\.firstSeq/);
  });

  it('rejects NaN in numeric field', () => {
    const m = baseManifest({ body: { rowCount: NaN } });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body\.rowCount/);
  });

  it('rejects Infinity in numeric field', () => {
    const m = baseManifest({ body: { lastSeq: Number.POSITIVE_INFINITY } });
    expect(() => validateSignedManifest(m, 'x')).toThrow(/body\.lastSeq/);
  });

  // ── error shape ──────────────────────────────────────────────────────────

  it('attaches source + field + reason on the typed error', () => {
    const m = baseManifest({ body: { firstSeq: 'not-a-number' } });
    try {
      validateSignedManifest(m, 'corpus/slice-7/m-001.manifest.json');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestValidationError);
      const ve = err as ManifestValidationError;
      expect(ve.source).toBe('corpus/slice-7/m-001.manifest.json');
      expect(ve.field).toBe('body.firstSeq');
      expect(ve.reason).toMatch(/finite number/);
      expect(ve.name).toBe('ManifestValidationError');
    }
  });
});
