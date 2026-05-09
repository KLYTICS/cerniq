import { describe, it, expect } from 'vitest';

import { canonicalize, decodeBase64Url, encodeBase64Url, sortKeys, utf8 } from './canonical.js';

describe('sortKeys', () => {
  it('sorts object keys recursively', () => {
    const got = sortKeys({ b: 1, a: { y: 2, x: 1 } });
    expect(JSON.stringify(got)).toBe('{"a":{"x":1,"y":2},"b":1}');
  });

  it('preserves array order', () => {
    const got = sortKeys([3, 1, 2]);
    expect(got).toEqual([3, 1, 2]);
  });

  it('handles null and primitives', () => {
    expect(sortKeys(null)).toBeNull();
    expect(sortKeys(42)).toBe(42);
    expect(sortKeys('x')).toBe('x');
    expect(sortKeys(true)).toBe(true);
  });

  it('produces byte-stable canonicalization for two equivalent objects', () => {
    const a = canonicalize({ z: 1, a: 2, m: { y: [3, 1, 2], x: 0 } });
    const b = canonicalize({ a: 2, m: { x: 0, y: [3, 1, 2] }, z: 1 });
    expect(a).toBe(b);
  });
});

describe('base64url round-trip', () => {
  it('encodes and decodes arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
  });

  it('omits padding on encode and tolerates absent padding on decode', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const encoded = encodeBase64Url(bytes);
    expect(encoded.endsWith('=')).toBe(false);
    expect(decodeBase64Url(encoded)).toEqual(bytes);
  });

  it('uses url-safe alphabet (- and _, never + or /)', () => {
    // 0xFB → byte that maps to '+' in base64; we want '-'
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const encoded = encodeBase64Url(bytes);
    expect(encoded.includes('+')).toBe(false);
    expect(encoded.includes('/')).toBe(false);
  });
});

describe('utf8', () => {
  it('encodes ASCII identically to TextEncoder', () => {
    expect(utf8('hello').length).toBe(5);
  });
  it('encodes multibyte sequences correctly', () => {
    expect(utf8('é').length).toBe(2);
  });
});
