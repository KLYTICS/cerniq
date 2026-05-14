// Base64url codec — universal across Node, browsers, Workers, Deno, Bun.
// Mirrors packages/sdk-ts/src/crypto.ts so signing and verification share
// byte-identical encodings. Do not reach for a third-party base64 lib.

export function b64uEncode(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }
  // Manual base64url for environments without Buffer (browsers, edge runtimes).
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(s, 'base64url'));
  }
  const padded = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function b64uDecodeJson(s: string): unknown {
  const bytes = b64uDecode(s);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as unknown;
}
