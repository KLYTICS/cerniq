// Deterministic JSON canonicalization — byte-identical to the AEGIS
// signer's output. The signer uses a recursive sorted-key
// stable-stringify; we do the same here.
//
// This is NOT full RFC 8785 (we don't normalise number representation,
// don't enforce IEEE 754 round-trip, don't unicode-escape). The signer
// gates input upstream so pathological values (NaN, Infinity, very-
// large numbers) never reach the canonicalizer. If we ever expose the
// signing format to third-party signers, port to a vetted RFC 8785 lib
// at that point — but verifiers must stay byte-compatible with what
// the signer produced.
//
// Ports: this file is the second copy of the algorithm (the first lives
// in apps/api/src/common/crypto/audit-chain.util.ts:canonicalize). The
// chain.spec.ts cross-package parity test wires this against the API
// signer to guarantee they remain byte-identical.

const SORTABLE_TYPES = new Set(['object']);

/** Recursively sort object keys so JSON.stringify produces stable output.
 *  Arrays preserve order (semantic); only object keys are sorted. */
export function sortKeys(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || !SORTABLE_TYPES.has(typeof value)) return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

/** Canonicalize for signing — sorted keys, no whitespace. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** Encode bytes as base64url (no padding). Edge-runtime safe. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa is available in Node >= 16 and every browser/edge runtime.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url string to bytes. Tolerates absent padding. */
export function decodeBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const fill = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(fill));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UTF-8 encode a string. */
const ENCODER = new TextEncoder();
export function utf8(s: string): Uint8Array {
  return ENCODER.encode(s);
}
