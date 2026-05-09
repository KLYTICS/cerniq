// Public surface of @aegis/audit-verifier.
//
// Stability guarantee:
//   - The exported types in `./types` are part of the wire contract.
//     Adding fields is non-breaking; renames or removals require a
//     major version bump.
//   - The verify function `verifyChain` is the canonical entry point.
//   - canonicalize / computePrevHash / buildSignedMessage are exposed
//     so external auditors can independently verify the construction
//     of the bytes-being-signed.

export type {
  AuditChainPayload,
  AuditEventRow,
  ChainReport,
  JwksDocument,
  JwksKey,
  RotationEvent,
  RowVerdict,
  VerifyChainOptions,
} from './types.js';

export { canonicalize, decodeBase64Url, encodeBase64Url, sortKeys, utf8 } from './canonical.js';
export { loadJwksFromFile, loadJwksFromUrl, lookupPublicKey, validateJwks } from './jwks.js';
export { buildSignedMessage, computePrevHash, verifyChain, verifyRow } from './chain.js';

/** Convenience helper: parse an NDJSON file or string into AuditEventRow[]
 *  via line-streaming. Permissive — silently drops blank lines and rejects
 *  non-object lines with a clear error so callers can inspect the row id. */
export function parseAuditNdjson(ndjson: string): import('./types.js').AuditEventRow[] {
  const rows: import('./types.js').AuditEventRow[] = [];
  let lineNo = 0;
  for (const line of ndjson.split('\n')) {
    lineNo++;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`audit-verifier: NDJSON line ${lineNo} is not valid JSON — ${(err as Error).message}`);
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`audit-verifier: NDJSON line ${lineNo} is not an object`);
    }
    rows.push(parsed as import('./types.js').AuditEventRow);
  }
  return rows;
}
