// Chain verification core. Pure async function; no I/O, no globals.
// Accepts an iterable or async-iterable of `AuditEventRow`s plus a JWKS,
// returns a `ChainReport`. Designed to scale: streams the input,
// constant memory per row regardless of total chain length.

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { sha512 } from '@noble/hashes/sha2';

import { canonicalize, decodeBase64Url, utf8 } from './canonical.js';
import { lookupPublicKey } from './jwks.js';
import type {
  AuditChainPayload,
  AuditEventRow,
  ChainReport,
  RotationEvent,
  RowVerdict,
  VerifyChainOptions,
} from './types.js';

// @noble/ed25519 v2 requires a sha512 implementation be configured once
// at module load. The package ships sha512 from @noble/hashes; wiring
// here keeps the audit-verifier package self-contained (no dependence
// on the API's bootstrap module).
ed.etc.sha512Sync = (...m): Uint8Array => sha512(ed.etc.concatBytes(...m));

const GENESIS_BYTES = utf8('OKORO-AUDIT-GENESIS-v1');

function genesisHash(): Uint8Array {
  return sha256(GENESIS_BYTES);
}

/** Recompute prev_hash using the same construction the signer used:
 *  - genesis row (both prev fields null) → sha256("OKORO-AUDIT-GENESIS-v1")
 *  - other rows → sha256(prev_signature_bytes || prev_event_id_utf8) */
export function computePrevHash(
  prevEventId: string | null,
  prevSignatureB64Url: string | null,
): Uint8Array {
  if (prevEventId === null && prevSignatureB64Url === null) return genesisHash();
  if (prevEventId === null || prevSignatureB64Url === null) {
    throw new Error('audit-verifier: prevEventId and prevSignature must both be set or both null');
  }
  const sigBytes = decodeBase64Url(prevSignatureB64Url);
  const idBytes = utf8(prevEventId);
  const concat = new Uint8Array(sigBytes.length + idBytes.length);
  concat.set(sigBytes, 0);
  concat.set(idBytes, sigBytes.length);
  return sha256(concat);
}

/** Build the bytes the signer would have signed for this row. */
export function buildSignedMessage(
  prevEventId: string | null,
  prevSignatureB64Url: string | null,
  payload: AuditChainPayload,
): Uint8Array {
  const prev = computePrevHash(prevEventId, prevSignatureB64Url);
  const canonical = utf8(canonicalize(payload));
  const out = new Uint8Array(prev.length + canonical.length);
  out.set(prev, 0);
  out.set(canonical, prev.length);
  return out;
}

/** Verify a single row's signature + chain link given the predecessor. */
export async function verifyRow(
  row: AuditEventRow,
  publicKey: Uint8Array,
  expectedPrevEventId: string | null,
  expectedPrevSignature: string | null,
): Promise<{ signatureValid: boolean; chainLinkValid: boolean; reason?: string }> {
  // Chain-link check: the row's claimed prev pointer must match what we
  // observed in the previous row. Catches reordering and dropped rows.
  const linkOk =
    row.prevEventId === expectedPrevEventId && row.prevSignature === expectedPrevSignature;

  let sigOk = false;
  let reason: string | undefined;
  try {
    const message = buildSignedMessage(row.prevEventId, row.prevSignature, row.payload);
    const signature = decodeBase64Url(row.signature);
    sigOk = await ed.verifyAsync(signature, message, publicKey);
    if (!sigOk) reason = 'signature did not verify against the published public key';
  } catch (err) {
    reason = `verify failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!linkOk) {
    const linkReason = `chain link mismatch — row claims prev=(${row.prevEventId ?? 'null'}, ${
      row.prevSignature ? row.prevSignature.slice(0, 10) + '…' : 'null'
    }) but predecessor was (${expectedPrevEventId ?? 'null'}, ${
      expectedPrevSignature ? expectedPrevSignature.slice(0, 10) + '…' : 'null'
    })`;
    reason = reason ? `${linkReason}; ${reason}` : linkReason;
  }
  return { signatureValid: sigOk, chainLinkValid: linkOk, reason };
}

/** Walk the chain from start to end. Constant memory per row. */
export async function verifyChain(
  events: Iterable<AuditEventRow> | AsyncIterable<AuditEventRow>,
  opts: VerifyChainOptions,
): Promise<ChainReport> {
  const failFast = opts.failFast ?? true;
  const maxRowDetail = Math.max(0, opts.maxRowDetail ?? 100);
  const startedAt = Date.now();

  let totalRows = 0;
  let firstBreak: RowVerdict | null = null;
  const signingKeys = new Set<string>();
  const rotationEvents: RotationEvent[] = [];
  const rows: RowVerdict[] = [];
  let lastKid: string | null = null;
  let expectedPrevEventId: string | null = null;
  let expectedPrevSignature: string | null = null;

  const iter: AsyncIterable<AuditEventRow> =
    Symbol.asyncIterator in events
      ? (events)
      : asyncFromIterable(events);

  for await (const row of iter) {
    const idx = totalRows;
    totalRows++;

    signingKeys.add(row.signingKeyId);
    if (lastKid !== null && lastKid !== row.signingKeyId) {
      rotationEvents.push({ atIndex: idx, fromKid: lastKid, toKid: row.signingKeyId });
    }
    lastKid = row.signingKeyId;

    const pubkey = lookupPublicKey(opts.jwks, row.signingKeyId);
    let verdict: RowVerdict;
    if (!pubkey) {
      verdict = {
        index: idx,
        eventId: row.eventId,
        signingKeyId: row.signingKeyId,
        signatureValid: false,
        chainLinkValid: false,
        reason: `kid "${row.signingKeyId}" not present in JWKS — cannot verify`,
      };
    } else {
      const { signatureValid, chainLinkValid, reason } = await verifyRow(
        row,
        pubkey,
        expectedPrevEventId,
        expectedPrevSignature,
      );
      verdict = {
        index: idx,
        eventId: row.eventId,
        signingKeyId: row.signingKeyId,
        signatureValid,
        chainLinkValid,
        reason,
      };
    }

    if (rows.length < maxRowDetail) rows.push(verdict);

    const ok = verdict.signatureValid && verdict.chainLinkValid;
    if (!ok && firstBreak === null) {
      firstBreak = verdict;
      if (failFast) break;
    }

    expectedPrevEventId = row.eventId;
    expectedPrevSignature = row.signature;
  }

  return {
    valid: firstBreak === null,
    totalRows,
    signingKeys: Array.from(signingKeys),
    rotationEvents,
    firstBreak,
    rows,
    durationMs: Date.now() - startedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- AsyncIterable<T> contract requires the async modifier even with no await.
async function* asyncFromIterable<T>(it: Iterable<T>): AsyncIterable<T> {
  for (const x of it) yield x;
}
