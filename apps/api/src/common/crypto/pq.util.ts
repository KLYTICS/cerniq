// pq.util.ts — Post-quantum hybrid signing scaffold per ADR-0013.
//
// Wire format committed in ADR-0013 §4 (length-prefixed binary):
//
//   [4-byte BE length of classical sig][classical sig (64B for Ed25519)]
//   [4-byte BE length of PQ sig      ][PQ sig (3293B for ML-DSA-65)    ]
//
// Total hybrid signature size: 8 (length prefixes) + 64 (Ed25519) + 3293
// (ML-DSA-65) = 3365 bytes. Length-prefixing makes the format
// alg-agnostic — when ML-DSA-65 gives way to ML-DSA-87 or Falcon, the
// envelope absorbs it.
//
// Behavior:
//   - signHybrid(msg, edPriv, pqPriv)   → Uint8Array (concat envelope)
//   - verifyHybrid(msg, sig, edPub, pqPub)
//        Both halves MUST verify. No "either/or" fallback — that would
//        defeat the security purpose. (Fail-closed; classical compromise
//        + PQ verify-pass is rejected.)
//
// Feature flag: CERNIQ_HYBRID_PQ_ENABLED. When OFF, this util is dormant
// (no PQ signature produced; CERNIQ runs pure Ed25519 per ADR-0002).
// When ON, audit chain entries are signed hybrid; pre-flag entries
// remain pure Ed25519 and are verifiable as long as their kid stays
// in JWKS.
//
// Dependency: `@noble/post-quantum` v1.x (Cure53-audited). NIST FIPS 204
// finalized August 2024; algorithm name `ML-DSA-65` (a.k.a.
// CRYSTALS-Dilithium 3 in pre-FIPS literature).

import * as ed from '@noble/ed25519';
// `@noble/post-quantum` v1+ exports ml-dsa as namespace.
// Re-import shim keeps the top-of-file clean and tree-shakes well.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';

import './crypto.bootstrap.js';

export type HybridAlgorithm = 'EdDSA+ML-DSA-65';

export interface HybridKeypair {
  algorithm: HybridAlgorithm;
  classical: { publicKey: Uint8Array; secretKey: Uint8Array };
  pq: { publicKey: Uint8Array; secretKey: Uint8Array };
}

const ED25519_SIG_LEN = 64;
// FIPS 204 (final, Aug 2024) ML-DSA-65 signature is 3309 bytes. The
// pre-FIPS draft-04 used 3293; we track the FIPS-final spec since
// `@noble/post-quantum` v0.4 produces 3309. The wire envelope uses
// length-prefixing per ADR-0013 §4 so future algo upgrades don't
// require changing this constant — it's a defense-in-depth check.
const ML_DSA_65_SIG_LEN = 3309;

/**
 * Generate a fresh hybrid keypair. Both halves are independent — Ed25519
 * uses its 32-byte key, ML-DSA-65 uses its much larger key (1952B pub,
 * 4032B priv). Operators distribute the 32+1952=1984B public material
 * via JWKS.
 */
export async function generateHybridKeypair(): Promise<HybridKeypair> {
  const edSk = ed.utils.randomPrivateKey();
  const edPk = await ed.getPublicKeyAsync(edSk);
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const pq = ml_dsa65.keygen(seed);
  return {
    algorithm: 'EdDSA+ML-DSA-65',
    classical: { publicKey: edPk, secretKey: edSk },
    pq: { publicKey: pq.publicKey, secretKey: pq.secretKey },
  };
}

/**
 * Sign `message` under both halves. Order: classical first, then PQ.
 * Output is the binary envelope from ADR-0013 §4.
 */
export async function signHybrid(
  message: Uint8Array,
  classicalPriv: Uint8Array,
  pqPriv: Uint8Array,
): Promise<Uint8Array> {
  const edSig = await ed.signAsync(message, classicalPriv);
  if (edSig.length !== ED25519_SIG_LEN) {
    throw new Error(`pq: classical sig length=${edSig.length}, expected ${ED25519_SIG_LEN}`);
  }
  const pqSig = ml_dsa65.sign(pqPriv, message);
  if (pqSig.length !== ML_DSA_65_SIG_LEN) {
    throw new Error(`pq: ml-dsa-65 sig length=${pqSig.length}, expected ${ML_DSA_65_SIG_LEN}`);
  }
  return packHybrid(edSig, pqSig);
}

/**
 * Verify the hybrid envelope. Returns true iff BOTH halves verify
 * against their respective public keys. Any failure (parse, classical
 * verify, PQ verify) returns false; no granular reason is exposed —
 * caller treats as INVALID_SIGNATURE per ADR-0004 denial precedence.
 */
export async function verifyHybrid(
  message: Uint8Array,
  envelope: Uint8Array,
  classicalPub: Uint8Array,
  pqPub: Uint8Array,
): Promise<boolean> {
  let parsed: { classical: Uint8Array; pq: Uint8Array };
  try {
    parsed = unpackHybrid(envelope);
  } catch {
    return false;
  }
  try {
    const okClassical = await ed.verifyAsync(parsed.classical, message, classicalPub);
    if (!okClassical) return false;
  } catch {
    return false;
  }
  try {
    return ml_dsa65.verify(pqPub, message, parsed.pq);
  } catch {
    return false;
  }
}

/** Pack [4B BE len][classical][4B BE len][pq]. */
export function packHybrid(classical: Uint8Array, pq: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + classical.length + 4 + pq.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, classical.length, false);
  out.set(classical, 4);
  view.setUint32(4 + classical.length, pq.length, false);
  out.set(pq, 4 + classical.length + 4);
  return out;
}

/** Unpack the hybrid envelope. Throws on malformed length prefixes. */
export function unpackHybrid(env: Uint8Array): { classical: Uint8Array; pq: Uint8Array } {
  if (env.length < 8) throw new Error('pq: envelope too short for length prefixes');
  const view = new DataView(env.buffer, env.byteOffset, env.byteLength);
  const classicalLen = view.getUint32(0, false);
  if (classicalLen > env.length - 8) throw new Error('pq: classical length exceeds envelope');
  const classicalEnd = 4 + classicalLen;
  const pqLen = view.getUint32(classicalEnd, false);
  if (pqLen > env.length - classicalEnd - 4) throw new Error('pq: pq length exceeds envelope');
  const pqStart = classicalEnd + 4;
  if (pqStart + pqLen !== env.length) {
    throw new Error('pq: trailing bytes after pq segment');
  }
  return {
    classical: env.slice(4, classicalEnd),
    pq: env.slice(pqStart, pqStart + pqLen),
  };
}
