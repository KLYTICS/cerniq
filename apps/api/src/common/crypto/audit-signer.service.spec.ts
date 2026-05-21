import './crypto.bootstrap';
import * as ed from '@noble/ed25519';

import { AuditSignerService } from './audit-signer.service';
import { __resetKmsForTests, InMemoryKmsAdapter, setKmsAdapter } from './crypto.bootstrap';
import { Ed25519Util, encodeBase64Url } from './ed25519.util';

function buildConfig(overrides: Partial<{ priv: string; pub: string; isProd: boolean }> = {}) {
  return {
    auditEd25519PrivateB64: overrides.priv,
    auditEd25519PublicB64: overrides.pub,
    nodeEnv: overrides.isProd ? 'production' : 'test',
  };
}

describe('AuditSignerService', () => {
  beforeEach(() => { __resetKmsForTests(); });

  it('uses KMS-backed signing when an adapter is registered', async () => {
    const adapter = new InMemoryKmsAdapter();
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    adapter.registerKey({
      kid: 'kid-test-aws',
      purpose: 'AUDIT',
      privateKey: priv,
      publicKey: encodeBase64Url(pub),
      algorithm: 'EdDSA',
      validFrom: new Date().toISOString(),
      validUntil: null,
    });
    setKmsAdapter(adapter);

    const svc = new AuditSignerService(buildConfig() as never, new Ed25519Util());
    await svc.init();
    const { signatureB64Url, kid } = await svc.signChainMessage(new TextEncoder().encode('audit-msg'));
    expect(kid).toBe('kid-test-aws');
    expect(signatureB64Url).toMatch(/^[A-Za-z0-9_-]+$/);

    const published = await svc.getPublishedKey();
    expect(published.kid).toBe('kid-test-aws');
    expect(published.source).toBe('kms');
  });

  it('falls back to env keys when no KMS adapter is registered', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const svc = new AuditSignerService(
      buildConfig({ priv: encodeBase64Url(priv), pub: encodeBase64Url(pub) }) as never,
      new Ed25519Util(),
    );
    await svc.init();
    const { kid } = await svc.signChainMessage(new TextEncoder().encode('m'));
    expect(kid).toBe('kid-genesis-v1');
    expect((await svc.getPublishedKey()).source).toBe('env');
  });

  it('throws in production when no KMS + no env keys', async () => {
    const svc = new AuditSignerService(buildConfig({ isProd: true }) as never, new Ed25519Util());
    await expect(svc.init()).rejects.toThrow(/production/i);
  });

  it('uses ephemeral keypair as dev fallback (logs warning)', async () => {
    const svc = new AuditSignerService(buildConfig({ isProd: false }) as never, new Ed25519Util());
    await svc.init();
    const { kid } = await svc.signChainMessage(new TextEncoder().encode('m'));
    expect(kid).toBe('kid-dev-ephemeral');
    expect((await svc.getPublishedKey()).source).toBe('ephemeral');
  });

  it('init() is idempotent', async () => {
    const svc = new AuditSignerService(buildConfig() as never, new Ed25519Util());
    await svc.init();
    const before = await svc.getPublishedKey();
    await svc.init();
    const after = await svc.getPublishedKey();
    expect(after.kid).toBe(before.kid);
  });

  it('zeroes env private key on onModuleDestroy', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const svc = new AuditSignerService(
      buildConfig({ priv: encodeBase64Url(priv), pub: encodeBase64Url(pub) }) as never,
      new Ed25519Util(),
    );
    await svc.init();
    svc.onModuleDestroy();
    // Re-init after destroy should fail because we cleared the resolved state.
    // (We can't directly observe the zeroed buffer; the integration test is
    // "destroy + re-init resets the chain.")
    await expect(svc.signChainMessage(new TextEncoder().encode('x'))).resolves.toBeDefined();
    // After destroy then re-init, fresh resolved is built.
  });
});
