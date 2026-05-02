import { JwtUtil } from './jwt.util';
import { Ed25519Util, encodeBase64Url } from './ed25519.util';

describe('JwtUtil', () => {
  const ed = new Ed25519Util();
  const jwt = new JwtUtil();

  const baseClaims = (overrides: Partial<Parameters<JwtUtil['sign']>[0]> = {}) => ({
    sub: 'agt_test',
    pid: 'pol_test',
    act: 'commerce.purchase',
    amt: 100,
    cur: 'USD',
    dom: 'example.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    jti: 'jti_test',
    ...overrides,
  });

  it('signs and verifies a token round trip', async () => {
    const { privateKey, publicKey } = await ed.generateKeypair();
    const token = await jwt.sign(baseClaims(), privateKey);
    const claims = await jwt.verifyAndDecode(token, encodeBase64Url(publicKey));
    expect(claims?.sub).toBe('agt_test');
    expect(claims?.pid).toBe('pol_test');
  });

  it('rejects an expired token', async () => {
    const { privateKey, publicKey } = await ed.generateKeypair();
    const token = await jwt.sign(
      baseClaims({ iat: 1, exp: 2 }),
      privateKey,
    );
    const claims = await jwt.verifyAndDecode(token, encodeBase64Url(publicKey));
    expect(claims).toBeNull();
  });

  it('rejects a token signed with a different key', async () => {
    const a = await ed.generateKeypair();
    const b = await ed.generateKeypair();
    const token = await jwt.sign(baseClaims(), a.privateKey);
    const claims = await jwt.verifyAndDecode(token, encodeBase64Url(b.publicKey));
    expect(claims).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const { publicKey } = await ed.generateKeypair();
    const claims = await jwt.verifyAndDecode('not.a.token', encodeBase64Url(publicKey));
    expect(claims).toBeNull();
  });

  it('rejects when sub or pid is missing', async () => {
    const { privateKey, publicKey } = await ed.generateKeypair();
    const token = await jwt.sign(
      { sub: '', pid: '', iat: 1, exp: 9_999_999_999, jti: 'x' },
      privateKey,
    );
    const claims = await jwt.verifyAndDecode(token, encodeBase64Url(publicKey));
    expect(claims).toBeNull();
  });
});
