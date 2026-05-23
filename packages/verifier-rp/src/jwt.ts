// Pure JWT helpers. No state, no I/O — separable from the verifier so the
// hot-path crypto can be reused inside Workers / edge runtimes that have
// strict bundle size budgets.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

import { b64uDecode, b64uDecodeJson } from './_internal/b64u.js';
import type { CerniqJwtClaims, CerniqJwtHeader } from './types.js';

// `@noble/ed25519` defers SHA-512 to the host. Wire up the synchronous helper
// once at module load — matches sdk-ts/crypto.ts so signing and verification
// agree on every byte.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface ParsedJws {
  header: CerniqJwtHeader;
  claims: CerniqJwtClaims;
  /** Raw bytes of "${headerB64}.${payloadB64}" — the signed input. */
  signingInput: Uint8Array;
  /** Raw signature bytes. */
  signature: Uint8Array;
  /** Original token, useful for caches keyed on the wire form. */
  token: string;
}

const enc = new TextEncoder();

const HEADER_LIKE = /^[A-Za-z0-9_-]+$/;

function isHeaderLike(s: string): boolean {
  return s.length > 0 && HEADER_LIKE.test(s);
}

function isCerniqJwtHeader(value: unknown): value is CerniqJwtHeader {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.alg !== 'EdDSA') return false;
  if (v.typ !== undefined && v.typ !== 'JWT') return false;
  if (v.kid !== undefined && typeof v.kid !== 'string') return false;
  return true;
}

function isCerniqJwtClaims(value: unknown): value is CerniqJwtClaims {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sub !== 'string' || v.sub.length === 0) return false;
  if (typeof v.pid !== 'string' || v.pid.length === 0) return false;
  if (typeof v.iat !== 'number' || !Number.isFinite(v.iat)) return false;
  if (typeof v.exp !== 'number' || !Number.isFinite(v.exp)) return false;
  if (typeof v.jti !== 'string' || v.jti.length === 0) return false;
  if (typeof v.act !== 'string' || v.act.length === 0) return false;
  if (v.amt !== undefined && (typeof v.amt !== 'number' || !Number.isFinite(v.amt))) return false;
  if (v.cur !== undefined && typeof v.cur !== 'string') return false;
  if (v.dom !== undefined && typeof v.dom !== 'string') return false;
  if (v.mid !== undefined && typeof v.mid !== 'string') return false;
  if (v.iss !== undefined && typeof v.iss !== 'string') return false;
  if (v.scopes !== undefined && !Array.isArray(v.scopes)) return false;
  if (v.ad !== undefined && !Array.isArray(v.ad)) return false;
  return true;
}

/**
 * Parse a compact JWS into header/claims/signature. Performs structural
 * validation only — does NOT verify the signature.
 *
 * Returns `null` on malformed input. We intentionally don't throw so callers
 * can map it to a clean INVALID_SIGNATURE outcome.
 */
export function parseCompactJws(token: string): ParsedJws | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  if (!isHeaderLike(h) || !isHeaderLike(p) || !isHeaderLike(s)) return null;

  let header: unknown;
  let claims: unknown;
  try {
    header = b64uDecodeJson(h);
    claims = b64uDecodeJson(p);
  } catch {
    return null;
  }
  if (!isCerniqJwtHeader(header)) return null;
  if (!isCerniqJwtClaims(claims)) return null;

  let signature: Uint8Array;
  try {
    signature = b64uDecode(s);
  } catch {
    return null;
  }
  if (signature.length !== 64) return null;

  const signingInput = enc.encode(`${h}.${p}`);
  return { header, claims, signature, signingInput, token };
}

/**
 * Verify an Ed25519 signature over the JWS signing input.
 *
 * @param parsed Output of {@link parseCompactJws}.
 * @param publicKey Raw 32-byte Ed25519 public key.
 */
export async function verifyEdDSA(parsed: ParsedJws, publicKey: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32) return false;
  try {
    return await ed.verifyAsync(parsed.signature, parsed.signingInput, publicKey);
  } catch {
    return false;
  }
}
