import './crypto.bootstrap';
import { generateHybridKeypair, signHybrid, verifyHybrid, packHybrid, unpackHybrid } from './pq.util';

describe('pq hybrid sign/verify', () => {
  it('round-trips a hybrid signature successfully', async () => {
    const kp = await generateHybridKeypair();
    const msg = new TextEncoder().encode('audit-event-123');
    const sig = await signHybrid(msg, kp.classical.secretKey, kp.pq.secretKey);
    const ok = await verifyHybrid(msg, sig, kp.classical.publicKey, kp.pq.publicKey);
    expect(ok).toBe(true);
  });

  it('rejects when classical half is tampered (byte-flip in classical region)', async () => {
    const kp = await generateHybridKeypair();
    const msg = new TextEncoder().encode('payload');
    const sig = await signHybrid(msg, kp.classical.secretKey, kp.pq.secretKey);
    // First 4 bytes are the BE length; next 64 bytes are the classical sig.
    sig[5] ^= 0x01;
    const ok = await verifyHybrid(msg, sig, kp.classical.publicKey, kp.pq.publicKey);
    expect(ok).toBe(false);
  });

  it('rejects when PQ half is tampered', async () => {
    const kp = await generateHybridKeypair();
    const msg = new TextEncoder().encode('payload');
    const sig = await signHybrid(msg, kp.classical.secretKey, kp.pq.secretKey);
    // PQ region starts at 4 + 64 + 4 = 72.
    sig[100] ^= 0xff;
    const ok = await verifyHybrid(msg, sig, kp.classical.publicKey, kp.pq.publicKey);
    expect(ok).toBe(false);
  });

  it('rejects when wrong classical public key is supplied', async () => {
    const kp1 = await generateHybridKeypair();
    const kp2 = await generateHybridKeypair();
    const msg = new TextEncoder().encode('payload');
    const sig = await signHybrid(msg, kp1.classical.secretKey, kp1.pq.secretKey);
    expect(await verifyHybrid(msg, sig, kp2.classical.publicKey, kp1.pq.publicKey)).toBe(false);
  });

  it('rejects when wrong PQ public key is supplied', async () => {
    const kp1 = await generateHybridKeypair();
    const kp2 = await generateHybridKeypair();
    const msg = new TextEncoder().encode('payload');
    const sig = await signHybrid(msg, kp1.classical.secretKey, kp1.pq.secretKey);
    expect(await verifyHybrid(msg, sig, kp1.classical.publicKey, kp2.pq.publicKey)).toBe(false);
  });

  it('returns false for malformed envelope (no throw)', async () => {
    const kp = await generateHybridKeypair();
    const msg = new TextEncoder().encode('payload');
    const truncated = new Uint8Array(4); // length prefix only
    expect(await verifyHybrid(msg, truncated, kp.classical.publicKey, kp.pq.publicKey)).toBe(false);
  });
});

describe('packHybrid / unpackHybrid', () => {
  it('round-trips arbitrary byte sequences', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([10, 20, 30]);
    const packed = packHybrid(a, b);
    expect(packed.length).toBe(4 + 5 + 4 + 3);
    const unpacked = unpackHybrid(packed);
    expect(Array.from(unpacked.classical)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(unpacked.pq)).toEqual([10, 20, 30]);
  });

  it('throws on truncated envelope', () => {
    expect(() => unpackHybrid(new Uint8Array([0, 0, 0]))).toThrow(/too short/);
  });

  it('throws when classical length prefix exceeds envelope', () => {
    const bogus = new Uint8Array(20);
    new DataView(bogus.buffer).setUint32(0, 999, false);
    expect(() => unpackHybrid(bogus)).toThrow(/classical length exceeds/);
  });

  it('throws on trailing bytes', () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    const packed = packHybrid(a, b);
    const withTrailing = new Uint8Array(packed.length + 2);
    withTrailing.set(packed);
    expect(() => unpackHybrid(withTrailing)).toThrow(/trailing bytes/);
  });
});
