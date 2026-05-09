import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { ulid } from 'ulid';
import type { SignContext } from './types';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();

export function b64uEncode(bytes: Uint8Array): string {
  // base64url, no padding — node and browsers.
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64url');
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(s, 'base64url'));
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const HEADER_B64 = b64uEncode(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));

/**
 * Generate a fresh Ed25519 keypair. Both halves are returned in base64url
 * (32 bytes each). Persist the private key client-side; AEGIS never receives it.
 */
export async function generateKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { privateKey: b64uEncode(priv), publicKey: b64uEncode(pub) };
}

/**
 * Sign a per-request agent token. Returns a compact JWT (header.payload.sig).
 *
 * The payload always carries `sub` (agentId) and `pid` (policyId) plus an
 * `exp` of `iat + ttlSeconds` (default 60 s — short-lived to limit replay).
 */
export async function signAgentToken(
  privateKeyB64u: string,
  agentId: string,
  policyId: string,
  ctx: SignContext,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (ctx.ttlSeconds ?? 60);

  const claims: Record<string, unknown> = {
    sub: agentId,
    pid: policyId,
    iat,
    exp,
    jti: ulid(),
    act: ctx.action,
  };
  if (ctx.amount !== undefined) claims.amt = ctx.amount;
  if (ctx.currency) claims.cur = ctx.currency;
  if (ctx.merchantDomain) claims.dom = ctx.merchantDomain;
  if (ctx.merchantId) claims.mid = ctx.merchantId;

  const payloadB64 = b64uEncode(enc.encode(JSON.stringify(claims)));
  const signingInput = enc.encode(`${HEADER_B64}.${payloadB64}`);
  const sig = await ed.signAsync(signingInput, b64uDecode(privateKeyB64u));
  return `${HEADER_B64}.${payloadB64}.${b64uEncode(sig)}`;
}

/**
 * Sign a handshake challenge issued by `POST /v1/agents/:id/challenge`.
 *
 * The server returns a `message` string of the form
 * `aegis-handshake-v1::{agentId}::{challenge}`. Sign those exact UTF-8 bytes
 * with the agent's Ed25519 private key and post the resulting signature back
 * to `POST /v1/agents/:id/verify-handshake` to prove proof-of-possession.
 *
 * Domain separation: the `aegis-handshake-v1::` prefix prevents this signature
 * from being meaningful in any other AEGIS sub-protocol (verify-token JWTs sign
 * different bytes), so the same private key is safe to use for both flows.
 */
export async function signHandshake(
  privateKeyB64u: string,
  message: string,
): Promise<string> {
  const sig = await ed.signAsync(enc.encode(message), b64uDecode(privateKeyB64u));
  return b64uEncode(sig);
}

/**
 * Decode a token's claims without verifying the signature. Test/debug only.
 */
export function decodeUnsafe(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = new TextDecoder().decode(b64uDecode(parts[1]));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
