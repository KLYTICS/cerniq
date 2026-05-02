// Audit hash chain utility — builds the tamper-evident chain referenced in
// docs/ARCHITECTURE.md § "The audit chain" and docs/SECURITY.md § "Audit
// chain integrity".
//
// Chain construction (per event):
//   prev_hash    = sha256(prev_event.signature || prev_event.id)   (32B)
//   canonical    = canonicalize(payload)                           (RFC 8785-ish)
//   sign_input   = prev_hash || canonical
//   signature    = ed25519.sign(aegisAuditPrivateKey, sign_input)
//
// Verifier (third party):
//   1. Fetch /.well-known/audit-signing-key
//   2. For each event in chronological order:
//        recompute prev_hash, canonicalize payload, verify signature
//   3. Any mismatch = tampering or storage corruption.
//
// Note on canonicalization: full RFC 8785 implementation is heavy; we use a
// deterministic stable-stringify that sorts object keys recursively. This
// is sufficient because we control both signer and verifier surfaces. If
// we ever expose the signing format to third parties as a verification
// library, port to a vetted RFC 8785 lib at that point.

import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import * as ed from '@noble/ed25519';

import { decodeBase64Url, encodeBase64Url } from './ed25519.util.js';

const enc = new TextEncoder();

/**
 * Audit chain payload — v2 (GDPR-redactable; ADR-0006).
 *
 * Replaces v1's raw `action`/`relyingParty`/`requestedAmount`/`policySnapshot`
 * fields with their `*Hash` commitments. Raw values live in nullable DB
 * columns and may be erased under GDPR Art. 17 without breaking the
 * signature — verifiers walk the chain by hashing the raw values back to
 * the persisted hashes (or accepting the persisted hash directly when raw
 * is null).
 */
export interface AuditChainPayload {
  agentId: string;
  /** What the request claimed; never redactable. Distinct from `agentId` for AGENT_NOT_FOUND audit rows. */
  claimedAgentId: string | null;
  principalId: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason: string | null;
  policyId: string | null;
  trustScoreAtEvent: number;
  trustBandAtEvent: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  currency: string | null;
  timestamp: string; // ISO
  // Hash commitments. Each is base64url(sha256(value)) when value present,
  // null when value was absent at write time. The DB persists raw + hash
  // in separate columns; the signature is computed over THIS payload.
  actionHash: string | null;
  relyingPartyHash: string | null;
  requestedAmountHash: string | null;
  policySnapshotHash: string | null;
  /** Schema version. v1 omitted hashes; v2 onwards uses them. */
  v: 2;
}

/** Inputs to build a chain payload from raw values. The util computes the hashes. */
export interface AuditChainPayloadInput {
  agentId: string;
  claimedAgentId: string | null;
  principalId: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason: string | null;
  policyId: string | null;
  trustScoreAtEvent: number;
  trustBandAtEvent: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  currency: string | null;
  timestamp: string;
  // raw values — hashed by the util before signing
  action: string | null;
  relyingParty: string | null;
  /** Decimal-as-string with 2dp; matches the existing canonicalization for numeric audit fields. */
  requestedAmount: string | null;
  policySnapshot: unknown | null;
}

/** Result of buildPayload — both the signed payload and the persistable hashes (so callers can write the *Hash columns alongside raw). */
export interface BuiltAuditPayload {
  signed: AuditChainPayload;
  rawHashes: {
    actionHash: string | null;
    relyingPartyHash: string | null;
    requestedAmountHash: string | null;
    policySnapshotHash: string | null;
  };
}

export interface AuditChainInput {
  eventId: string;
  prevEventId: string | null;
  prevSignatureB64Url: string | null;
  payload: AuditChainPayload;
}

@Injectable()
export class AuditChainUtil {
  /**
   * Canonical JSON: keys sorted recursively, no whitespace. Deterministic.
   * Numbers are stringified by JSON.stringify natively (no NaN/Infinity in
   * payload by construction; surface validation forbids them upstream).
   */
  canonicalize(value: unknown): string {
    return JSON.stringify(sortKeys(value));
  }

  /**
   * Compute the base64url(sha256(...)) commitment for a raw value. Strings
   * use UTF-8 bytes; objects go through {@link canonicalize}; numbers must
   * be passed pre-stringified by the caller (decimal precision is the
   * caller's responsibility — see `BuiltAuditPayload.rawHashes` for usage).
   *
   * Returns null iff `value === null || value === undefined` — preserves
   * the v2 invariant "absent field → null hash; present-but-empty → real hash".
   */
  hashLeaf(value: string | object | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const bytes =
      typeof value === 'string' ? enc.encode(value) : enc.encode(this.canonicalize(value));
    return encodeBase64Url(createHash('sha256').update(bytes).digest());
  }

  /**
   * Build a v2 signed payload from raw values. Computes hashes for the
   * redactable fields; pass-through for everything else.
   */
  buildPayload(input: AuditChainPayloadInput): BuiltAuditPayload {
    const actionHash = this.hashLeaf(input.action);
    const relyingPartyHash = this.hashLeaf(input.relyingParty);
    const requestedAmountHash = this.hashLeaf(input.requestedAmount);
    const policySnapshotHash =
      input.policySnapshot === null || input.policySnapshot === undefined
        ? null
        : this.hashLeaf(input.policySnapshot as object);

    const signed: AuditChainPayload = {
      agentId: input.agentId,
      claimedAgentId: input.claimedAgentId,
      principalId: input.principalId,
      decision: input.decision,
      denialReason: input.denialReason,
      policyId: input.policyId,
      trustScoreAtEvent: input.trustScoreAtEvent,
      trustBandAtEvent: input.trustBandAtEvent,
      currency: input.currency,
      timestamp: input.timestamp,
      actionHash,
      relyingPartyHash,
      requestedAmountHash,
      policySnapshotHash,
      v: 2,
    };
    return {
      signed,
      rawHashes: { actionHash, relyingPartyHash, requestedAmountHash, policySnapshotHash },
    };
  }

  /**
   * Compute the prev_hash chain link. Returns 32-byte sha256 buffer.
   *
   * For the first event in a chain, both args are null and prev_hash is
   * the sha256 of the literal string "AEGIS-AUDIT-GENESIS-v1".
   */
  prevHash(prevEventId: string | null, prevSignatureB64Url: string | null): Buffer {
    if (prevEventId === null && prevSignatureB64Url === null) {
      return createHash('sha256').update('AEGIS-AUDIT-GENESIS-v1').digest();
    }
    if (prevEventId === null || prevSignatureB64Url === null) {
      throw new Error('prevEventId and prevSignatureB64Url must both be set or both be null');
    }
    const sigBytes = decodeBase64Url(prevSignatureB64Url);
    return createHash('sha256').update(sigBytes).update(prevEventId, 'utf8').digest();
  }

  /**
   * Sign one audit event. Returns base64url signature; caller persists it.
   */
  async sign(input: AuditChainInput, privateKey: Uint8Array): Promise<string> {
    const prev = this.prevHash(input.prevEventId, input.prevSignatureB64Url);
    const canonical = enc.encode(this.canonicalize(input.payload));
    const message = Buffer.concat([prev, canonical]);
    const sig = await ed.signAsync(message, privateKey);
    return encodeBase64Url(sig);
  }

  /**
   * Verify a single event's signature. Returns true iff the chain link is
   * intact for this event given the prior event's id+signature.
   */
  async verify(
    input: AuditChainInput,
    expectedSignatureB64Url: string,
    publicKeyB64Url: string,
  ): Promise<boolean> {
    try {
      const prev = this.prevHash(input.prevEventId, input.prevSignatureB64Url);
      const canonical = enc.encode(this.canonicalize(input.payload));
      const message = Buffer.concat([prev, canonical]);
      const sig = decodeBase64Url(expectedSignatureB64Url);
      const pub = decodeBase64Url(publicKeyB64Url);
      return await ed.verifyAsync(sig, message, pub);
    } catch {
      return false;
    }
  }
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}
