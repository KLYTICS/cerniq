import '../../common/crypto/crypto.bootstrap';
import * as ed from '@noble/ed25519';
import { encodeBase64Url } from '../../common/crypto/ed25519.util';
import { AwsKmsAdapter, type AwsWrappedKey, type KmsClientLike } from './aws-kms.adapter';

class FakeKmsClient implements KmsClientLike {
  constructor(private readonly plaintexts: Map<string, Uint8Array>) {}
  async decrypt({ CiphertextBlob }: { CiphertextBlob: Uint8Array }): Promise<{ Plaintext?: Uint8Array }> {
    const key = Buffer.from(CiphertextBlob).toString('base64url');
    const plain = this.plaintexts.get(key);
    if (!plain) throw new Error('fake KMS: ciphertext not found');
    return { Plaintext: plain };
  }
}

async function makeWrapped(): Promise<{ wrapped: AwsWrappedKey; client: FakeKmsClient; pub: Uint8Array }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const ciphertext = new Uint8Array([1, 2, 3, 4, 5, ...Array(27).fill(0)]); // arbitrary blob
  const ctB64 = Buffer.from(ciphertext).toString('base64url');
  const client = new FakeKmsClient(new Map([[ctB64, priv]]));
  const wrapped: AwsWrappedKey = {
    kid: 'kid-aws-test',
    wrappedPrivateKeyB64: ctB64,
    publicKey: encodeBase64Url(pub),
    algorithm: 'EdDSA',
    validFrom: new Date().toISOString(),
    validUntil: null,
  };
  return { wrapped, client, pub };
}

describe('AwsKmsAdapter', () => {
  it('unwraps a wrapped key at init() and signs with it', async () => {
    const { wrapped, client } = await makeWrapped();
    const adapter = new AwsKmsAdapter({ region: 'us-east-1', keys: { AUDIT: wrapped } }, client);
    await adapter.init();
    const signer = await adapter.getActiveKey('AUDIT');
    expect(signer.metadata.kid).toBe('kid-aws-test');
    const sig = await signer.sign(new TextEncoder().encode('hello'));
    expect(sig.length).toBe(64); // Ed25519 signature
  });

  it('verify-side getKeyByKid returns the public key', async () => {
    const { wrapped, client } = await makeWrapped();
    const adapter = new AwsKmsAdapter({ region: 'us-east-1', keys: { AUDIT: wrapped } }, client);
    await adapter.init();
    const k = await adapter.getKeyByKid('kid-aws-test');
    expect(k).not.toBeNull();
    expect(k?.algorithm).toBe('EdDSA');
    expect(await adapter.getKeyByKid('kid-does-not-exist')).toBeNull();
  });

  it('listKeys filters by purpose', async () => {
    const { wrapped, client } = await makeWrapped();
    const adapter = new AwsKmsAdapter({ region: 'us-east-1', keys: { AUDIT: wrapped } }, client);
    await adapter.init();
    expect((await adapter.listKeys('AUDIT')).length).toBe(1);
    expect((await adapter.listKeys('JWT')).length).toBe(0);
  });

  it('throws when no active key registered for a purpose', async () => {
    const adapter = new AwsKmsAdapter({ region: 'us-east-1', keys: {} }, new FakeKmsClient(new Map()));
    await adapter.init();
    await expect(adapter.getActiveKey('JWT')).rejects.toThrow(/no active/i);
  });

  it('init() rejects if KMS returns wrong-length plaintext', async () => {
    const ciphertext = new Uint8Array([9, 9, 9]);
    const ctB64 = Buffer.from(ciphertext).toString('base64url');
    const client = new FakeKmsClient(new Map([[ctB64, new Uint8Array(16)]])); // 16 bytes, not 32
    const wrapped: AwsWrappedKey = {
      kid: 'kid-bad', wrappedPrivateKeyB64: ctB64, publicKey: 'AA',
      algorithm: 'EdDSA', validFrom: new Date().toISOString(), validUntil: null,
    };
    const adapter = new AwsKmsAdapter({ region: 'us-east-1', keys: { AUDIT: wrapped } }, client);
    await expect(adapter.init()).rejects.toThrow(/expected 32-byte/);
  });

  it('destroy() zeroes private key bytes', async () => {
    const { wrapped, client } = await makeWrapped();
    const adapter = new AwsKmsAdapter({ region: 'us-east-1', keys: { AUDIT: wrapped } }, client);
    await adapter.init();
    adapter.destroy();
    await expect(adapter.getKeyByKid('kid-aws-test')).resolves.toBeNull();
  });
});
