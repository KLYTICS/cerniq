import '../../common/crypto/crypto.bootstrap';
import * as ed from '@noble/ed25519';

import { encodeBase64Url } from '../../common/crypto/ed25519.util';

import { GcpKmsAdapter, type GcpKmsKey, type GcpKmsClientLike } from './gcp-kms.adapter';

class FakeGcpKms implements GcpKmsClientLike {
  constructor(private readonly keys: Map<string, Uint8Array>) {}
  async asymmetricSign({ name, data }: { name: string; data: Uint8Array }): Promise<{ signature: Uint8Array }> {
    const priv = this.keys.get(name);
    if (!priv) throw new Error(`fake gcp kms: unknown resource ${name}`);
    return { signature: await ed.signAsync(data, priv) };
  }
}

async function makeKey(): Promise<{ key: GcpKmsKey; pub: Uint8Array; client: FakeGcpKms }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const resourceName = 'projects/p/locations/global/keyRings/kr/cryptoKeys/k/cryptoKeyVersions/1';
  const key: GcpKmsKey = {
    kid: 'kid-gcp-test',
    resourceName,
    publicKey: encodeBase64Url(pub),
    algorithm: 'EdDSA',
    validFrom: new Date().toISOString(),
    validUntil: null,
  };
  const client = new FakeGcpKms(new Map([[resourceName, priv]]));
  return { key, pub, client };
}

describe('GcpKmsAdapter', () => {
  it('signs via the GCP KMS client and returns a 64-byte Ed25519 signature', async () => {
    const { key, pub, client } = await makeKey();
    const adapter = new GcpKmsAdapter({ keys: { AUDIT: [key] } }, client);
    const signer = await adapter.getActiveKey('AUDIT');
    const msg = new TextEncoder().encode('payload');
    const sig = await signer.sign(msg);
    expect(sig.length).toBe(64);
    expect(await ed.verifyAsync(sig, msg, pub)).toBe(true);
  });

  it('throws on KMS-returned signature with wrong length', async () => {
    const broken: GcpKmsClientLike = {
      asymmetricSign: async () => ({ signature: new Uint8Array(32) }),
    };
    const { key } = await makeKey();
    const adapter = new GcpKmsAdapter({ keys: { AUDIT: [key] } }, broken);
    const signer = await adapter.getActiveKey('AUDIT');
    await expect(signer.sign(new Uint8Array(1))).rejects.toThrow(/invalid Ed25519 signature length/);
  });

  it('treats validUntil != null as historical (not active) but still verifiable', async () => {
    const { key, client } = await makeKey();
    const oldKey: GcpKmsKey = { ...key, kid: 'kid-old', validUntil: new Date().toISOString() };
    const adapter = new GcpKmsAdapter({ keys: { AUDIT: [oldKey, key] } }, client);
    const active = await adapter.getActiveKey('AUDIT');
    expect(active.metadata.kid).toBe('kid-gcp-test'); // not 'kid-old'
    expect(await adapter.getKeyByKid('kid-old')).not.toBeNull();
  });

  it('listKeys filters by purpose', async () => {
    const { key, client } = await makeKey();
    const adapter = new GcpKmsAdapter({ keys: { AUDIT: [key] } }, client);
    expect((await adapter.listKeys('AUDIT')).length).toBe(1);
    expect((await adapter.listKeys('JWT')).length).toBe(0);
  });
});
