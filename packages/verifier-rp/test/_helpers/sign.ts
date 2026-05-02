// Test-only signing helper. Mirrors `packages/sdk-ts/src/crypto.ts` so the
// verifier can be tested against the SAME wire format the SDK produces. We
// inline this rather than depending on the sibling package because workspace
// resolution isn't required for vitest in CI.
//
// Source: packages/sdk-ts/src/crypto.ts (signAgentToken).

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import { b64uEncode, b64uDecode } from '../../src/_internal/b64u.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();

export interface SignContext {
  action: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
  merchantId?: string;
  ttlSeconds?: number;
  scopes?: string[];
  allowedDomains?: string[];
  trustBand?: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  principalId?: string;
  /** Override iat for test purposes. */
  iat?: number;
  /** Override jti for test purposes. */
  jti?: string;
  /** Override kid in the header (default omitted). */
  kid?: string;
}

export async function generateKeypair(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

let counter = 0;
function fakeJti(): string {
  counter += 1;
  return `tst_${Date.now()}_${counter}`;
}

export async function signTestToken(
  privateKey: Uint8Array,
  agentId: string,
  policyId: string,
  ctx: SignContext,
): Promise<string> {
  const headerObj: Record<string, string> = { alg: 'EdDSA', typ: 'JWT' };
  if (ctx.kid) headerObj.kid = ctx.kid;
  const headerB64 = b64uEncode(enc.encode(JSON.stringify(headerObj)));

  const iat = ctx.iat ?? Math.floor(Date.now() / 1000);
  const exp = iat + (ctx.ttlSeconds ?? 60);
  const claims: Record<string, unknown> = {
    sub: agentId,
    pid: policyId,
    iat,
    exp,
    jti: ctx.jti ?? fakeJti(),
    act: ctx.action,
  };
  if (ctx.amount !== undefined) claims.amt = ctx.amount;
  if (ctx.currency) claims.cur = ctx.currency;
  if (ctx.merchantDomain) claims.dom = ctx.merchantDomain;
  if (ctx.merchantId) claims.mid = ctx.merchantId;
  if (ctx.scopes) claims.scopes = ctx.scopes;
  if (ctx.allowedDomains) claims.ad = ctx.allowedDomains;
  if (ctx.trustBand) claims.tb = ctx.trustBand;
  if (ctx.principalId) claims.iss = ctx.principalId;

  const payloadB64 = b64uEncode(enc.encode(JSON.stringify(claims)));
  const signingInput = enc.encode(`${headerB64}.${payloadB64}`);
  const sig = await ed.signAsync(signingInput, privateKey);
  return `${headerB64}.${payloadB64}.${b64uEncode(sig)}`;
}

export function tamperToken(token: string, segmentIndex: 0 | 1 | 2): string {
  const parts = token.split('.');
  const seg = parts[segmentIndex] ?? '';
  // Flip the first byte of the chosen segment by replacing the first decoded
  // byte with its XOR-1, then re-encoding. This guarantees a different bit
  // pattern but valid base64url shape.
  let bytes: Uint8Array;
  try {
    bytes = b64uDecode(seg);
  } catch {
    bytes = new Uint8Array(0);
  }
  if (bytes.length === 0) {
    parts[segmentIndex] = `${seg}A`;
  } else {
    const tampered = new Uint8Array(bytes);
    tampered[0] = ((tampered[0] ?? 0) ^ 0x01) & 0xff;
    parts[segmentIndex] = b64uEncode(tampered);
  }
  return parts.join('.');
}
