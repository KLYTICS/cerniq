import { Ed25519Util, encodeBase64Url } from './ed25519.util';

describe('Ed25519Util', () => {
  const util = new Ed25519Util();

  it('generates a 32-byte private key and 32-byte public key', async () => {
    const kp = await util.generateKeypair();
    expect(kp.privateKey).toHaveLength(32);
    expect(kp.publicKey).toHaveLength(32);
  });

  it('signs and verifies a round trip', async () => {
    const { privateKey, publicKey } = await util.generateKeypair();
    const msg = 'hello okoro';

    const sig = await util.sign(msg, privateKey);
    const ok = await util.verify(msg, sig, encodeBase64Url(publicKey));
    expect(ok).toBe(true);
  });

  it('rejects a signature from a different key', async () => {
    const a = await util.generateKeypair();
    const b = await util.generateKeypair();

    const sig = await util.sign('hello', a.privateKey);
    const ok = await util.verify('hello', sig, encodeBase64Url(b.publicKey));
    expect(ok).toBe(false);
  });

  it('rejects a tampered message', async () => {
    const { privateKey, publicKey } = await util.generateKeypair();
    const sig = await util.sign('hello', privateKey);
    const ok = await util.verify('hello!', sig, encodeBase64Url(publicKey));
    expect(ok).toBe(false);
  });

  it('returns false on malformed inputs rather than throwing', async () => {
    await expect(util.verify('m', 'not-base64-url-!!!', 'also-bad')).resolves.toBe(false);
  });
});
