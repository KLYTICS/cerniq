// Real cryptographic primitives — @noble/ed25519 + @noble/hashes.
// Identical libraries used by apps/api in production (CLAUDE.md
// invariant #1 ensures cryptographic singularity).
//
// @noble/ed25519 v2 ships an async API that doesn't require manual
// sha512 wiring — sufficient for our scenarios (no sync hot path here).

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2';

export type Keypair = { publicKey: Uint8Array; privateKey: Uint8Array };

export async function generateKeypair(): Promise<Keypair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}

export async function sign(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.signAsync(message, privateKey);
}

export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function sha256Hex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = sha256(bytes);
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function b64UrlEncode(bytes: Uint8Array): string {
  // Base64URL without padding, RFC 4648 §5.
  let b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Canonical JSON: keys sorted recursively, no whitespace, undefined values
 *  dropped (matches JSON.stringify semantics + AEGIS audit-chain canonical form).
 *  This is the same shape `apps/api/src/common/crypto/audit-chain.util.ts` produces. */
export function canonicalize(value: unknown): string {
  if (value === undefined) return 'null'; // top-level undefined → null
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Arrays preserve undefined as null per JSON.stringify behavior.
    return '[' + value.map((v) => v === undefined ? 'null' : canonicalize(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  // Drop keys whose value is undefined — same as JSON.stringify default.
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}
