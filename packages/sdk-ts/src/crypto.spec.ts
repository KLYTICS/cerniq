import { generateKeypair, signAgentToken, decodeUnsafe, b64uDecode } from './crypto';

describe('@aegis/sdk crypto', () => {
  it('generates keypairs in base64url', async () => {
    const kp = await generateKeypair();
    expect(b64uDecode(kp.privateKey)).toHaveLength(32);
    expect(b64uDecode(kp.publicKey)).toHaveLength(32);
  });

  it('signs a token whose claims round-trip through decodeUnsafe', async () => {
    const { privateKey } = await generateKeypair();
    const token = await signAgentToken(privateKey, 'agt_x', 'pol_x', {
      action: 'commerce.purchase',
      amount: 100,
      currency: 'USD',
      merchantDomain: 'delta.com',
    });
    const claims = decodeUnsafe(token);
    expect(claims?.sub).toBe('agt_x');
    expect(claims?.pid).toBe('pol_x');
    expect(claims?.act).toBe('commerce.purchase');
    expect(claims?.amt).toBe(100);
    expect(claims?.dom).toBe('delta.com');
  });

  it('produces a 3-part compact JWT', async () => {
    const { privateKey } = await generateKeypair();
    const token = await signAgentToken(privateKey, 'a', 'p', { action: 'x' });
    expect(token.split('.')).toHaveLength(3);
  });
});
