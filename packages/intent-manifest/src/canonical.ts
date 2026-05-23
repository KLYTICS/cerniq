// Deterministic JSON canonicalization — byte-identical to the AEGIS signer
// canonical output. Port of `packages/audit-verifier/src/canonical.ts` with
// the same parity contract: the API-side signer and any verifier reading
// our manifest must agree byte-for-byte on the canonical pre-image.
//
// NOT full RFC 8785. Same reasoning as audit-verifier — the signer gates
// pathological values upstream (NaN/Infinity/very-large-numbers) so a
// stable-sorted JSON.stringify is sufficient. If we ever expose the
// signing format to third-party signers, swap to a vetted library here
// AND in the API-side mirror in one ADR-tracked change.

const SORTABLE_TYPES = new Set(['object']);

/** Recursively sort object keys so JSON.stringify produces stable output.
 *  Arrays preserve order (semantic); only object keys are sorted. */
export function sortKeys(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || !SORTABLE_TYPES.has(typeof value)) return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

/** Canonical JSON string — stable across runtimes given a closed value set. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** URL-safe base64 (RFC 4648 §5) without padding. Edge-runtime safe. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa is available in Node 16+ and all edge runtimes.
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inverse of encodeBase64Url. Throws on invalid input shape. */
export function decodeBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
