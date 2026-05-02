// Cryptographic helpers used by the e2e suite to mint agent keypairs and
// agent-signed JWTs. Matches the production primitives from
// apps/api/src/common/crypto/jwt.util.ts and ed25519.util.ts so a token
// signed here verifies under the verify hot path without modification.

import { randomUUID } from 'node:crypto';

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import { encodeBase64Url } from '../../../src/common/crypto/ed25519.util';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();
const HEADER_B64 = encodeBase64Url(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));

export interface AgentKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  privateKeyB64Url: string;
  publicKeyB64Url: string;
}

export async function generateAgentKeypair(): Promise<AgentKeypair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKey,
    privateKeyB64Url: encodeBase64Url(privateKey),
    publicKeyB64Url: encodeBase64Url(publicKey),
  };
}

/**
 * Claim shape matches `AgentTokenClaims` in jwt.util.ts.
 * `sub` = agentId, `pid` = policyId. `act` / `amt` / `cur` / `dom` are the
 * action/amount/currency/domain envelope.
 */
export interface AgentTokenInput {
  agentId: string;
  policyId: string;
  action?: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
  /** Seconds; default 60. */
  ttlSeconds?: number;
  /** Override now() for tests that need explicit `iat`. */
  nowSec?: number;
}

/**
 * Sign an Ed25519 JWT in the exact wire format the verify path expects.
 * Bypassing `jose` here keeps this helper dependency-aligned with the
 * production `JwtUtil`, so a parity drift in the JWT shape is caught
 * by the e2e suite (not silently absorbed by `jose`'s leniency).
 */
export async function signAgentToken(
  privateKey: Uint8Array,
  input: AgentTokenInput,
): Promise<string> {
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds ?? 60);

  const payload: Record<string, unknown> = {
    sub: input.agentId,
    pid: input.policyId,
    iat: now,
    exp,
    jti: randomUUID(),
  };
  if (input.action) payload.act = input.action;
  if (input.amount != null) payload.amt = input.amount;
  if (input.currency) payload.cur = input.currency;
  if (input.merchantDomain) payload.dom = input.merchantDomain;

  const payloadB64 = encodeBase64Url(enc.encode(JSON.stringify(payload)));
  const signingInput = enc.encode(`${HEADER_B64}.${payloadB64}`);
  const sig = await ed.signAsync(signingInput, privateKey);
  return `${HEADER_B64}.${payloadB64}.${encodeBase64Url(sig)}`;
}

/**
 * Tamper helper for the INVALID_SIGNATURE precedence test. Flips a single
 * byte in the signature segment; the structure is still parseable so the
 * algorithm reaches the crypto check rather than failing earlier.
 */
export function tamperJwtSignature(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  const sig = parts[2]!;
  // Flip the first character (deterministic, avoids randomness in tests).
  const swapped = sig.startsWith('A') ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
  return `${parts[0]}.${parts[1]}.${swapped}`;
}
