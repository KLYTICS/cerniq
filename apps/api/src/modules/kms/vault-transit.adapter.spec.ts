import '../../common/crypto/crypto.bootstrap';
import * as ed from '@noble/ed25519';

import { encodeBase64Url } from '../../common/crypto/ed25519.util';

import { VaultTransitAdapter, parseVaultSignature, type VaultTransitKey, type VaultClientLike } from './vault-transit.adapter';

class FakeVault implements VaultClientLike {
  public callCount = 0;
  public failures = 0;
  constructor(
    private readonly priv: Uint8Array,
    private readonly version: number,
    private readonly failuresBeforeOk = 0,
  ) {}
  async signTransit(input: { name: string; input: string }): Promise<{ data: { signature: string } }> {
    this.callCount++;
    if (this.callCount <= this.failuresBeforeOk) {
      this.failures++;
      throw new Error('vault 503');
    }
    const msg = Buffer.from(input.input, 'base64');
    const sig = await ed.signAsync(msg, this.priv);
    return { data: { signature: `vault:v${this.version}:${Buffer.from(sig).toString('base64')}` } };
  }
}

async function makeKey(version = 1): Promise<{ key: VaultTransitKey; pub: Uint8Array; priv: Uint8Array }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const key: VaultTransitKey = {
    kid: `kid-vault-test-v${version}`,
    transitName: 'aegis-audit',
    version,
    publicKey: encodeBase64Url(pub),
    algorithm: 'EdDSA',
    validFrom: new Date().toISOString(),
    validUntil: null,
  };
  return { key, pub, priv };
}

describe('VaultTransitAdapter', () => {
  it('signs via Vault and returns a verifiable Ed25519 signature', async () => {
    const { key, pub, priv } = await makeKey();
    const vault = new FakeVault(priv, 1);
    const adapter = new VaultTransitAdapter({ keys: { AUDIT: [key] } }, vault);
    const signer = await adapter.getActiveKey('AUDIT');
    const msg = new TextEncoder().encode('audit-payload');
    const sig = await signer.sign(msg);
    expect(sig.length).toBe(64);
    expect(await ed.verifyAsync(sig, msg, pub)).toBe(true);
  });

  it('retries once on transient failure', async () => {
    const { key, priv } = await makeKey();
    const vault = new FakeVault(priv, 1, 1); // one failure, then success
    const adapter = new VaultTransitAdapter({ keys: { AUDIT: [key] } }, vault);
    const signer = await adapter.getActiveKey('AUDIT');
    await signer.sign(new Uint8Array(8));
    expect(vault.failures).toBe(1);
    expect(vault.callCount).toBe(2);
  });

  it('throws when version envelope drifts', async () => {
    const { key, priv } = await makeKey(2);
    const vault = new FakeVault(priv, 7); // returns v7, key claims v2
    const adapter = new VaultTransitAdapter({ keys: { AUDIT: [{ ...key, version: 2 }] } }, vault);
    const signer = await adapter.getActiveKey('AUDIT');
    await expect(signer.sign(new Uint8Array(8))).rejects.toThrow(/version drift/);
  });
});

describe('parseVaultSignature', () => {
  it('parses vault:v1:<b64>', () => {
    const b64 = Buffer.from(new Uint8Array(64)).toString('base64');
    const out = parseVaultSignature(`vault:v1:${b64}`, 1);
    expect(out.length).toBe(64);
  });
  it('rejects malformed envelopes', () => {
    expect(() => parseVaultSignature('not-vault', 1)).toThrow(/malformed/);
  });
});
