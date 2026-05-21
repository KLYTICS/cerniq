// DPoP (RFC 9449) — Demonstrating Proof of Possession at the application
// layer. Per ADR-0010, AEGIS adopts DPoP with a single-curve constraint:
// the proof keypair is Ed25519, matching ADR-0002.
//
// What a DPoP proof looks like (compact JWT, three base64url segments):
//   header  = {"typ":"dpop+jwt","alg":"EdDSA","jwk":{"kty":"OKP","crv":"Ed25519","x":"<b64u>"}}
//   payload = {"htm":"POST","htu":"https://aegis.example/v1/verify","iat":<unix>,
//              "jti":"<ulid>","ath":"<b64u(sha256(access_token))>"}
//   signature over header.payload signed by the private key whose public
//                                 half is in `header.jwk.x`.
//
// Verification surface (RFC 9449 §4.3):
//   1. Header `typ` is "dpop+jwt" and `alg` is "EdDSA".
//   2. `jwk` claim parses as an Ed25519 OKP key.
//   3. Signature verifies under that key.
//   4. `htm` matches the actual request method (uppercase).
//   5. `htu` matches the actual request URL (RFC §4.2 normalization).
//   6. `iat` is within ±maxClockSkew of server time.
//   7. `ath` matches base64url(sha256(access_token)) — binds to one token.
//   8. `jti` not seen before in the replay window — replay-cache check.
//   9. (When access token has `cnf.jkt`) the proof's JWK thumbprint
//      matches `cnf.jkt`.
//
// All checks above are required; failures are not granular — caller
// receives `{ valid: false, reason: "DPoP_<...>" }` and converts to
// INVALID_SIGNATURE per ADR-0004 denial precedence.
//
// This module has zero NestJS / Prisma deps; it can run on Cloudflare
// Workers (ADR-0003). Replay cache is supplied by the caller as a tiny
// `Has(jti) -> bool` + `Add(jti, ttl)` interface.

import './crypto.bootstrap.js';
import { createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';

import { decodeBase64Url, encodeBase64Url } from './ed25519.util.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

const DEFAULT_MAX_CLOCK_SKEW_S = 30;
const DEFAULT_REPLAY_WINDOW_S = 90;

export interface DpopJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  /** base64url Ed25519 public key (32 bytes). */
  x: string;
}

export interface DpopProofClaims {
  htm: string;
  htu: string;
  iat: number;
  jti: string;
  /** base64url(sha256(access_token)) — token binding. */
  ath?: string;
}

export interface DpopVerifyContext {
  /** HTTP method in uppercase, e.g. "POST". For MCP stdio the bridge synthesizes "MCP". */
  method: string;
  /** Full request URL with query string. Fragment stripped. */
  url: string;
  /** The bearer token whose `ath` binding the proof must match. */
  accessToken: string;
  /** Optional `cnf.jkt` thumbprint extracted from the access token. */
  expectedJkt?: string;
  /** Replay cache. The caller persists the jti for `replayWindowSeconds`. */
  replayCache: ReplayCache;
  /** Override clocks/limits in tests. */
  now?: () => number;
  maxClockSkewSeconds?: number;
  replayWindowSeconds?: number;
}

export interface ReplayCache {
  /** Returns true iff this jti has been seen within the window. */
  has(jti: string): Promise<boolean>;
  /** Records jti, expiring after `ttlSeconds`. */
  add(jti: string, ttlSeconds: number): Promise<void>;
}

export type DpopVerifyResult =
  | { valid: true; jkt: string; claims: DpopProofClaims }
  | { valid: false; reason: DpopFailureReason };

export type DpopFailureReason =
  | 'DPoP_MALFORMED'
  | 'DPoP_BAD_HEADER'
  | 'DPoP_BAD_KEY'
  | 'DPoP_SIGNATURE'
  | 'DPoP_HTM_MISMATCH'
  | 'DPoP_HTU_MISMATCH'
  | 'DPoP_CLOCK_SKEW'
  | 'DPoP_ATH_MISMATCH'
  | 'DPoP_REPLAY'
  | 'DPoP_JKT_MISMATCH';

/**
 * Verify a DPoP proof JWT. See RFC 9449 §4.3 for the full check list.
 * Returns a discriminated result; never throws on protocol-level failures.
 *
 * SECURITY NOTE: This function performs every check listed in the module
 * docstring. The caller MUST treat any `valid: false` as INVALID_SIGNATURE
 * per ADR-0004 denial precedence. Do NOT invent partial-trust modes.
 */
export async function verifyDpopProof(proof: string, ctx: DpopVerifyContext): Promise<DpopVerifyResult> {
  const parts = proof.split('.');
  if (parts.length !== 3) return fail('DPoP_MALFORMED');
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return fail('DPoP_MALFORMED');

  let header: { typ?: string; alg?: string; jwk?: DpopJwk };
  let claims: DpopProofClaims;
  try {
    header = JSON.parse(dec.decode(decodeBase64Url(headerB64))) as { typ?: string; alg?: string; jwk?: DpopJwk };
    claims = JSON.parse(dec.decode(decodeBase64Url(payloadB64))) as DpopProofClaims;
  } catch {
    return fail('DPoP_MALFORMED');
  }

  if (header.typ !== 'dpop+jwt' || header.alg !== 'EdDSA') return fail('DPoP_BAD_HEADER');
  if (header.jwk?.kty !== 'OKP' || header.jwk.crv !== 'Ed25519' || typeof header.jwk.x !== 'string') {
    return fail('DPoP_BAD_KEY');
  }

  // Signature verify.
  let publicKey: Uint8Array;
  try {
    publicKey = decodeBase64Url(header.jwk.x);
  } catch {
    return fail('DPoP_BAD_KEY');
  }
  if (publicKey.length !== 32) return fail('DPoP_BAD_KEY');

  const signingInput = enc.encode(`${headerB64}.${payloadB64}`);
  let sig: Uint8Array;
  try {
    sig = decodeBase64Url(sigB64);
  } catch {
    return fail('DPoP_MALFORMED');
  }
  let sigOk: boolean;
  try {
    sigOk = await ed.verifyAsync(sig, signingInput, publicKey);
  } catch {
    return fail('DPoP_SIGNATURE');
  }
  if (!sigOk) return fail('DPoP_SIGNATURE');

  // Claim checks. Order matters for ergonomic debugging — htm/htu first
  // (cheap, common operator misconfig), then time, then replay, then jkt.
  if (typeof claims.htm !== 'string' || claims.htm.toUpperCase() !== ctx.method.toUpperCase()) {
    return fail('DPoP_HTM_MISMATCH');
  }
  if (typeof claims.htu !== 'string' || !urlsMatch(claims.htu, ctx.url)) {
    return fail('DPoP_HTU_MISMATCH');
  }

  const now = ctx.now ? ctx.now() / 1000 : Date.now() / 1000;
  const skewLimit = ctx.maxClockSkewSeconds ?? DEFAULT_MAX_CLOCK_SKEW_S;
  if (typeof claims.iat !== 'number' || Math.abs(claims.iat - now) > skewLimit) {
    return fail('DPoP_CLOCK_SKEW');
  }

  // ath (access-token-hash) binding: required per ADR-0010.
  const expectedAth = encodeBase64Url(createHash('sha256').update(ctx.accessToken).digest());
  if (claims.ath !== expectedAth) return fail('DPoP_ATH_MISMATCH');

  // Replay check + insert. Cache call ordering: check first, then add — a
  // race between two parallel verifies of the same jti is handled by the
  // cache implementation (Redis SETNX). Tests inject a deterministic stub.
  if (typeof claims.jti !== 'string' || claims.jti.length === 0) return fail('DPoP_MALFORMED');
  if (await ctx.replayCache.has(claims.jti)) return fail('DPoP_REPLAY');
  await ctx.replayCache.add(claims.jti, ctx.replayWindowSeconds ?? DEFAULT_REPLAY_WINDOW_S);

  // Optional cnf.jkt binding: when the access token has `cnf.jkt`, the
  // proof's key thumbprint must match. Without this, an attacker who
  // captured the access token + a freshly-issued DPoP proof for one
  // request could mint proofs for other requests using a key of their
  // choosing. cnf.jkt locks the binding.
  const jkt = await jwkThumbprint(header.jwk);
  if (ctx.expectedJkt && ctx.expectedJkt !== jkt) return fail('DPoP_JKT_MISMATCH');

  return { valid: true, jkt, claims };
}

/**
 * Compute the JWK SHA-256 thumbprint per RFC 7638. For Ed25519 OKP keys
 * the canonical members are exactly `{crv, kty, x}` in lexicographic
 * order; we hardcode that order rather than running a generic
 * canonicalizer because there's only one shape we accept.
 */
export async function jwkThumbprint(jwk: DpopJwk): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  const digest = createHash('sha256').update(canonical, 'utf8').digest();
  return encodeBase64Url(digest);
}

function urlsMatch(claimed: string, actual: string): boolean {
  // RFC 9449 §4.2: scheme + host case-insensitive, path + query exact,
  // fragment ignored. We normalize both sides and compare.
  try {
    const a = new URL(claimed);
    const b = new URL(actual);
    a.hash = '';
    b.hash = '';
    if (a.protocol.toLowerCase() !== b.protocol.toLowerCase()) return false;
    if (a.host.toLowerCase() !== b.host.toLowerCase()) return false;
    if (a.pathname !== b.pathname) return false;
    if (a.search !== b.search) return false;
    return true;
  } catch {
    return false;
  }
}

function fail(reason: DpopFailureReason): DpopVerifyResult {
  return { valid: false, reason };
}
