import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import {
  deriveKid,
  fromB64Url,
  generateKeypair,
  toB64Url,
  toEnvFile,
  toJwkPublic,
  writeArtifacts,
} from './generate-okoro-keys.js';

describe('generate-okoro-keys', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) {
      const d = dirs.pop();
      if (d) await rm(d, { recursive: true, force: true });
    }
  });

  async function tmpDir(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'okoro-keys-'));
    dirs.push(d);
    return d;
  }

  it('roundtrips base64url for the private+public key bytes', async () => {
    const m = await generateKeypair();
    const priv = fromB64Url(m.privateKeyB64Url);
    const pub = fromB64Url(m.publicKeyB64Url);
    expect(priv.length).toBe(32);
    expect(pub.length).toBe(32);
    expect(toB64Url(priv)).toBe(m.privateKeyB64Url);
    expect(toB64Url(pub)).toBe(m.publicKeyB64Url);
  });

  it('produces a stable kid for a given public key (sha256 prefix, 16 chars b64url)', () => {
    // Two identical public keys must map to the same kid.
    const pub = new Uint8Array(32).fill(7);
    const a = deriveKid(pub);
    const b = deriveKid(pub);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('different public keys yield different kids', () => {
    const pubA = new Uint8Array(32).fill(1);
    const pubB = new Uint8Array(32).fill(2);
    expect(deriveKid(pubA)).not.toBe(deriveKid(pubB));
  });

  it('toJwkPublic emits a JWKS-shaped object with exact fields', async () => {
    const m = await generateKeypair();
    const jwk = toJwkPublic(m);
    expect(jwk).toEqual({
      kty: 'OKP',
      crv: 'Ed25519',
      kid: m.kid,
      use: 'sig',
      alg: 'EdDSA',
      x: m.publicKeyB64Url,
    });
  });

  it('toEnvFile emits the three documented env vars', async () => {
    const m = await generateKeypair();
    const env = toEnvFile(m, '2026-01-01T00:00:00.000Z');
    expect(env).toContain(`OKORO_SIGNING_PRIVATE_KEY=${m.privateKeyB64Url}`);
    expect(env).toContain(`OKORO_SIGNING_PUBLIC_KEY=${m.publicKeyB64Url}`);
    expect(env).toContain(`OKORO_SIGNING_KID=${m.kid}`);
  });

  it('writeArtifacts writes both files and the env file is mode 0600', async () => {
    const out = await tmpDir();
    const m = await generateKeypair();
    const r = await writeArtifacts(m, { outDir: out, format: 'both', force: false });
    expect(r.envPath).toBeTruthy();
    expect(r.jwkPath).toBeTruthy();
    const envStat = await stat(r.envPath!);
    // mask off file-type bits, check perm bits
    expect(envStat.mode & 0o777).toBe(0o600);
    const jwkBody = JSON.parse(await readFile(r.jwkPath!, 'utf8')) as { kid: string };
    expect(jwkBody.kid).toBe(m.kid);
  });

  it('writeArtifacts refuses to overwrite without --force', async () => {
    const out = await tmpDir();
    const m = await generateKeypair();
    await writeArtifacts(m, { outDir: out, format: 'both', force: false });
    await expect(
      writeArtifacts(m, { outDir: out, format: 'both', force: false }),
    ).rejects.toThrow(/refusing to overwrite/);
  });

  it('writeArtifacts overwrites when --force is set', async () => {
    const out = await tmpDir();
    const m1 = await generateKeypair();
    const m2 = await generateKeypair();
    await writeArtifacts(m1, { outDir: out, format: 'both', force: false });
    await writeArtifacts(m2, { outDir: out, format: 'both', force: true });
    const jwk = JSON.parse(
      await readFile(join(out, 'okoro-signing.jwk.json'), 'utf8'),
    ) as { kid: string };
    expect(jwk.kid).toBe(m2.kid);
    expect(jwk.kid).not.toBe(m1.kid);
  });
});
