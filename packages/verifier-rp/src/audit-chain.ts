// Audit-chain verifier — pure functions a relying party can run offline.
//
// Mirrors the construction in apps/api/src/common/crypto/audit-chain.util.ts.
// Closes the gap captured by tests/e2e-continuous/README.md TODO #2
// (continuous E2E was forced to do structural-only checks because this
// helper didn't exist) and gives third parties an auditable offline path
// that doesn't depend on AEGIS being online — the central promise of
// the platform per docs/SECURITY.md § "Audit chain integrity".
//
// Wire format (v2 payload, ADR-0006 redactable):
//   prev_hash    = sha256( prev_event.signature_bytes || utf8(prev_event.id) )
//                  — for the genesis event, prev_hash = sha256("AEGIS-AUDIT-GENESIS-v1")
//   canonical    = JSON.stringify(sortKeysRecursive(payload))
//   sign_input   = prev_hash (32B) || canonical (UTF-8 bytes)
//   signature    = ed25519.sign(privateKey, sign_input)
//
// Runtime constraints:
//   • No `node:crypto`. Uses @noble/hashes + @noble/ed25519 (already
//     deps; matches src/jwt.ts pattern). Works in browsers, Cloudflare
//     Workers, Deno, Bun, Node — anywhere the SDK ships.
//   • Pure functions. No I/O, no caches. The caller supplies events
//     and a JWKS document — typically `events = GET /v1/audit/events`
//     and `jwks = GET /.well-known/audit-signing-key`.

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

import { b64uDecode } from './_internal/b64u.js';

// `@noble/ed25519` defers SHA-512 to the host. Wire up once at module
// load — matches src/jwt.ts so signing and verification agree.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();

/** Genesis sentinel — apps/api audit-chain-util uses this verbatim. */
const GENESIS_SENTINEL = 'AEGIS-AUDIT-GENESIS-v1';

/**
 * v2 audit payload (ADR-0006 GDPR-redactable). v1 omitted the hash
 * fields; this verifier accepts both but treats v1 as deprecated.
 */
export interface AegisAuditPayload {
  v: 1 | 2;
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
  actionHash: string | null;
  relyingPartyHash: string | null;
  requestedAmountHash: string | null;
  policySnapshotHash: string | null;
}

export interface AegisAuditEvent {
  /** Event id (stable UUID). */
  id: string;
  /** Id of the immediately preceding event in this chain, or null for genesis. */
  prevEventId: string | null;
  /** base64url Ed25519 signature of the preceding event, or null for genesis. */
  prevSignatureB64Url: string | null;
  /** base64url Ed25519 signature of THIS event (over prev_hash || canonical(payload)). */
  signature: string;
  /** Key id from JWKS that signed this event. */
  signingKeyId: string;
  /** The signed payload. */
  payload: AegisAuditPayload;
}

export interface AegisAuditJwks {
  keys: Array<{
    kid: string;
    kty: 'OKP';
    crv: 'Ed25519';
    /** base64url Ed25519 public key (raw 32-byte x). */
    x: string;
    use?: string;
    alg?: 'EdDSA';
  }>;
}

export type AuditChainBreakReason =
  | 'INVALID_SIGNATURE'
  | 'UNKNOWN_SIGNING_KEY'
  | 'BROKEN_PREV_LINK'
  | 'OUT_OF_ORDER_TIMESTAMP'
  | 'EMPTY_CHAIN';

export interface AuditChainVerificationResult {
  /** True iff every event verifies and links to its predecessor. */
  valid: boolean;
  /** Number of events successfully verified before any break (or total if valid). */
  verified: number;
  /** If !valid, where it broke. Index is into the input array. */
  brokenAt?: {
    index: number;
    eventId: string;
    reason: AuditChainBreakReason;
    detail?: string;
  };
}

/**
 * Canonical JSON: keys sorted recursively, no whitespace. Must match
 * apps/api audit-chain-util byte-for-byte or signatures fail to verify.
 *
 * Sort uses standard string-comparison on object keys; the API uses
 * exactly this algorithm (see audit-chain.util.ts sortKeys).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/**
 * Compute the prev_hash chain link. Returns 32-byte sha256.
 *
 * Genesis: both args null → sha256(GENESIS_SENTINEL).
 * Non-genesis: both args set → sha256(sigBytes || utf8(prevEventId)).
 * Mixed → throws (caller bug).
 */
export function prevHash(
  prevEventId: string | null,
  prevSignatureB64Url: string | null,
): Uint8Array {
  if (prevEventId === null && prevSignatureB64Url === null) {
    return sha256(enc.encode(GENESIS_SENTINEL));
  }
  if (prevEventId === null || prevSignatureB64Url === null) {
    throw new Error(
      'verifyAuditChain: prevEventId and prevSignatureB64Url must both be set or both be null',
    );
  }
  const sigBytes = b64uDecode(prevSignatureB64Url);
  const idBytes = enc.encode(prevEventId);
  const concat = new Uint8Array(sigBytes.length + idBytes.length);
  concat.set(sigBytes, 0);
  concat.set(idBytes, sigBytes.length);
  return sha256(concat);
}

/**
 * Verify a single audit event against its expected predecessor.
 *
 * Exposed because some callers (e.g. tests/e2e-continuous) want to
 * verify a tail of events without loading the whole chain. Most callers
 * should use {@link verifyAuditChain}.
 *
 * @param event              the event to verify
 * @param expectedPrevEventId predecessor's id (or null if `event` is genesis)
 * @param expectedPrevSigB64  predecessor's signature (or null if genesis)
 * @param publicKeyB64Url    Ed25519 public key (raw 32-byte x, base64url)
 * @returns                  true iff signature over prev_hash || canonical(payload) verifies
 */
export async function verifyAuditEvent(
  event: AegisAuditEvent,
  expectedPrevEventId: string | null,
  expectedPrevSigB64: string | null,
  publicKeyB64Url: string,
): Promise<boolean> {
  // Chain linkage: the event's stored prevEventId / prevSignatureB64Url
  // MUST match what the caller observed in the preceding row. If they
  // don't, the chain has been reordered or an event was inserted —
  // signature could still verify against the embedded prev pointers,
  // but the chain at the caller's order is broken.
  if (
    event.prevEventId !== expectedPrevEventId ||
    event.prevSignatureB64Url !== expectedPrevSigB64
  ) {
    return false;
  }

  const prev = prevHash(event.prevEventId, event.prevSignatureB64Url);
  const canonical = enc.encode(canonicalize(event.payload));
  const message = new Uint8Array(prev.length + canonical.length);
  message.set(prev, 0);
  message.set(canonical, prev.length);

  try {
    const sigBytes = b64uDecode(event.signature);
    const pubBytes = b64uDecode(publicKeyB64Url);
    return await ed.verifyAsync(sigBytes, message, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Verify a sequence of audit events offline.
 *
 * Events must be supplied in chronological order — typically the order
 * returned by `GET /v1/audit/events?cursor=...&order=asc`. The function
 * walks the chain, verifying each event's signature and linkage, and
 * reports the FIRST break it encounters (so an SOC2 auditor sees a
 * precise event id to investigate, not a generic "chain broken").
 *
 * Key rotation: events carry `signingKeyId`. The function selects the
 * matching key from the supplied JWKS by `kid`. If a kid isn't present
 * in the JWKS, the chain is `UNKNOWN_SIGNING_KEY` — caller should
 * re-fetch the JWKS (a key rotation may have happened mid-fetch) and
 * retry before treating it as a hard failure.
 *
 * Timestamp ordering: monotonic non-decreasing ISO timestamps are also
 * checked because the chain hash links via signature bytes, NOT via
 * timestamp — an attacker who acquired the signing key could otherwise
 * forge an event with a back-dated timestamp that still chains. The
 * timestamp check makes that observable.
 */
export async function verifyAuditChain(
  events: readonly AegisAuditEvent[],
  jwks: AegisAuditJwks,
): Promise<AuditChainVerificationResult> {
  if (events.length === 0) {
    return { valid: false, verified: 0, brokenAt: undefined };
  }

  const keysByKid = new Map(jwks.keys.map((k) => [k.kid, k.x] as const));
  let expectedPrevId: string | null = null;
  let expectedPrevSig: string | null = null;
  let lastTimestamp = '';

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const pubB64 = keysByKid.get(ev.signingKeyId);
    if (!pubB64) {
      return {
        valid: false,
        verified: i,
        brokenAt: {
          index: i,
          eventId: ev.id,
          reason: 'UNKNOWN_SIGNING_KEY',
          detail: `kid="${ev.signingKeyId}" not in supplied JWKS`,
        },
      };
    }

    if (ev.prevEventId !== expectedPrevId || ev.prevSignatureB64Url !== expectedPrevSig) {
      return {
        valid: false,
        verified: i,
        brokenAt: {
          index: i,
          eventId: ev.id,
          reason: 'BROKEN_PREV_LINK',
          detail: `expected prevEventId=${expectedPrevId ?? 'genesis'}, got ${ev.prevEventId ?? 'genesis'}`,
        },
      };
    }

    if (ev.payload.timestamp < lastTimestamp) {
      return {
        valid: false,
        verified: i,
        brokenAt: {
          index: i,
          eventId: ev.id,
          reason: 'OUT_OF_ORDER_TIMESTAMP',
          detail: `event timestamp ${ev.payload.timestamp} < prior ${lastTimestamp}`,
        },
      };
    }

    const ok = await verifyAuditEvent(ev, expectedPrevId, expectedPrevSig, pubB64);
    if (!ok) {
      return {
        valid: false,
        verified: i,
        brokenAt: {
          index: i,
          eventId: ev.id,
          reason: 'INVALID_SIGNATURE',
        },
      };
    }

    expectedPrevId = ev.id;
    expectedPrevSig = ev.signature;
    lastTimestamp = ev.payload.timestamp;
  }

  return { valid: true, verified: events.length };
}
