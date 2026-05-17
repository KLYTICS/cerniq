// Cross-package parity — @aegis/intent-manifest ↔ @aegis/audit-verifier
//
// Why this exists (load-bearing):
//   intent-manifest's scaffold commit (1a05696) explicitly documented:
//   "canonical.ts — RFC-8785-style canonical JSON, byte-compatible with
//    @aegis/audit-verifier; same {sortKeys, canonicalize, base64url}
//    primitives so a future cross-package parity test can pin them
//    byte-identical against the API-side signer."
//
//   The "future" parity test is this file. Two independent implementations
//   of canonicalize — one in audit-verifier (signs audit-compression
//   manifests), one in intent-manifest (signs intent manifests) — must
//   produce byte-identical output for any common input. Otherwise:
//
//   - An intent manifest signed by AEGIS on the issuance path would
//     fail to verify on the audit-verifier-based relying-party path
//     (or vice versa), even though both use the same Ed25519 key.
//   - The drift would be SILENT: the signed bytes simply differ by
//     a sort order or escape sequence, so verifyManifest returns
//     ok=false with an opaque 'invalid_signature'.
//   - Operators would see verification failures with no obvious cause
//     and chase ghost keys / clock drift / pubkey rotation before
//     finding the actual cause weeks later.
//
//   Mirrors the existing audit-chain-parity.spec.ts and
//   audit-manifest-parity.spec.ts pattern. SEV-1 class of bug.
//
// What this spec DOES NOT cover:
//   - intent-manifest ↔ apps/api parity. apps/api does not yet sign
//     intent manifests with its own canonicalize — the live runtime
//     in apps/api/src/modules/intent/** imports and calls the
//     audit-verifier-side canonicalize directly. So the
//     intent-manifest ↔ audit-verifier parity pinned here transitively
//     covers the API path. If apps/api ever introduces its own
//     intent-manifest canonical, add a third axis here.
//   - Ed25519 sign/verify round-trip. intent-manifest's manifest.ts
//     covers that with its own deterministic-signature spec. Drift
//     in the SIGNED BYTES is what this spec is for; drift in the
//     SIGNATURE BYTES is what manifest.spec.ts is for.

import { describe, expect, it } from 'vitest';

// audit-verifier side (portable kernel, no node:crypto).
import {
  canonicalize as avCanonicalize,
  decodeBase64Url as avDecodeBase64Url,
  encodeBase64Url as avEncodeBase64Url,
  sortKeys as avSortKeys,
} from '../../packages/audit-verifier/src/canonical';

// intent-manifest side (independent port, same primitives).
import {
  canonicalize as imCanonicalize,
  decodeBase64Url as imDecodeBase64Url,
  encodeBase64Url as imEncodeBase64Url,
  sortKeys as imSortKeys,
} from '../../packages/intent-manifest/src/canonical';

// Representative input corpus. Lifted from audit-manifest-parity.spec.ts
// (which battle-tested these shapes for the apps/api ↔ audit-verifier
// axis) plus shapes specific to intent-manifest's IntentClaim variants.
//
// Each shape tests a property where two independent canonicalize ports
// could plausibly diverge:
//   - Object key ordering (sortKeys correctness)
//   - String escape sequences (JSON.stringify behavior)
//   - Numeric coercion edges (JS number → JSON number)
//   - Unicode handling (surrogate pairs, multi-byte chars)
//   - Null vs absent vs empty
//   - Array order preservation (must NOT be sorted)
const PARITY_CORPUS: ReadonlyArray<{ name: string; value: unknown }> = [
  // Object-key sort surface.
  { name: 'flat primitive object', value: { b: 1, a: 'x', c: null } },
  { name: 'nested objects', value: { z: { y: { x: 1 } }, a: 'first' } },
  { name: 'arrays preserve order', value: { items: [3, 1, 2], meta: { k: 'v' } } },
  { name: 'array of objects with mixed key order', value: { rows: [{ b: 1, a: 2 }, { a: 3, b: 4 }] } },

  // Type-coercion edges.
  { name: 'numeric values incl. zero/negative/float', value: { n: 0, m: -1, p: 1.5 } },
  { name: 'boolean + null mix', value: { flag: true, off: false, miss: null } },
  { name: 'empty containers', value: { obj: {}, arr: [] } },

  // String-escape edges where JSON.stringify could diverge between
  // independent ports if either side ever swapped to a custom serializer.
  { name: 'empty-string key', value: { '': 'empty', a: 1 } },
  { name: 'embedded double-quote in value', value: { s: 'has "quote" inside' } },
  { name: 'embedded backslash in value', value: { s: 'path\\to\\thing' } },
  { name: 'embedded control chars (\\n \\t \\r)', value: { s: 'line1\nline2\ttab\rreturn' } },
  { name: 'embedded quote in key', value: { 'k"q': 1, a: 2 } },

  // Unicode surface.
  { name: 'unicode keys + values', value: { 'ünicode': 'café', a: 'b' } },
  { name: 'high-codepoint Unicode (surrogate pair)', value: { emoji: '🦅', name: 'AEGIS' } },
  { name: 'mixed Unicode in keys', value: { 'café': 1, 'cafe': 2, 'カフェ': 3 } },
  { name: 'key sort with numeric-looking strings', value: { '10': 'a', '2': 'b', '1': 'c' } },

  // IntentManifestBody shape (intent-specific surface).
  {
    name: 'http-call intent body',
    value: {
      schemaVersion: 1,
      manifestId: '01HZZZAA0000000000000ABCDE',
      issuedAt: 1715000000,
      expiresAt: 1715000060,
      principalId: 'principal_acme',
      agentId: 'agent_xyz',
      intent: {
        kind: 'http-call',
        url: 'https://example.com/api',
        method: 'POST',
        maxCalls: 5,
      },
      reconciliation: { strictness: 'strict' },
      verifyTokenJti: 'jti_12345',
      verifyTokenSha256B64Url: 'tokenHashB64Url',
    },
  },
  {
    name: 'commerce-action intent body with amount cap',
    value: {
      schemaVersion: 1,
      manifestId: '01HZZZAA0000000000000ABCDE',
      issuedAt: 1715000000,
      expiresAt: 1715000060,
      principalId: 'principal_acme',
      agentId: 'agent_xyz',
      intent: {
        kind: 'commerce-action',
        action: 'stripe.charge',
        merchantId: 'merch_99',
        maxCalls: 1,
        amountCap: { amount: '49.00', currency: 'USD' },
      },
      reconciliation: { strictness: 'graduated', tolerance: 20 },
      verifyTokenJti: 'jti_67890',
      verifyTokenSha256B64Url: 'tokenHashB64Url',
    },
  },
  {
    name: 'tool-invocation intent body',
    value: {
      schemaVersion: 1,
      manifestId: '01HZZZAA0000000000000ABCDE',
      issuedAt: 1715000000,
      expiresAt: 1715000060,
      principalId: 'principal_acme',
      agentId: 'agent_xyz',
      intent: {
        kind: 'tool-invocation',
        toolName: 'fs.read_file',
        argsSha256B64Url: 'argsHashB64Url',
        maxCalls: 3,
      },
      reconciliation: { strictness: 'advisory' },
      verifyTokenJti: 'jti_abcdef',
      verifyTokenSha256B64Url: 'tokenHashB64Url',
    },
  },
];

describe('canonicalize — byte parity audit-verifier ↔ intent-manifest', () => {
  for (const { name, value } of PARITY_CORPUS) {
    it(`parity: ${name}`, () => {
      expect(avCanonicalize(value)).toBe(imCanonicalize(value));
    });
  }

  it('produces no whitespace from either implementation', () => {
    // Both implementations rely on JSON.stringify without indent arg;
    // pin that contract on both sides so a future "pretty print for
    // debugging" toggle on one side doesn't silently invalidate every
    // signature.
    const sample = PARITY_CORPUS[0]!.value;
    expect(avCanonicalize(sample)).not.toMatch(/\s/u);
    expect(imCanonicalize(sample)).not.toMatch(/\s/u);
  });
});

describe('sortKeys — structural parity audit-verifier ↔ intent-manifest', () => {
  // canonicalize() is sortKeys + JSON.stringify. If JSON.stringify ever
  // varies (it shouldn't — it's host-provided), the sortKeys output
  // alone could still drift. Pin that primitive separately.
  for (const { name, value } of PARITY_CORPUS) {
    it(`sortKeys parity: ${name}`, () => {
      expect(avSortKeys(value)).toEqual(imSortKeys(value));
    });
  }
});

describe('base64url — byte parity audit-verifier ↔ intent-manifest', () => {
  // Signed manifests carry signatures, kids, hashes — all base64url.
  // Both implementations must agree on the alphabet, padding stripping,
  // and decode tolerance. A divergence here corrupts kid lookups and
  // signature decoding silently.
  const ENCODE_CORPUS: ReadonlyArray<{ name: string; bytes: number[] }> = [
    { name: 'empty', bytes: [] },
    { name: 'single byte', bytes: [0x42] },
    { name: '32-byte (ed25519 pubkey size)', bytes: Array(32).fill(0).map((_, i) => i % 256) },
    { name: '64-byte (ed25519 sig size)', bytes: Array(64).fill(0).map((_, i) => (i * 7) % 256) },
    { name: 'all 0x00', bytes: Array(16).fill(0) },
    { name: 'all 0xFF', bytes: Array(16).fill(0xff) },
    { name: 'with padding-trigger length (1 byte)', bytes: [0x01] },
    { name: 'with padding-trigger length (2 bytes)', bytes: [0x01, 0x02] },
    { name: 'with padding-trigger length (3 bytes)', bytes: [0x01, 0x02, 0x03] },
  ];

  for (const { name, bytes } of ENCODE_CORPUS) {
    it(`encode parity: ${name}`, () => {
      const arr = new Uint8Array(bytes);
      expect(avEncodeBase64Url(arr)).toBe(imEncodeBase64Url(arr));
    });
  }

  it('round-trips byte-identical across both implementations', () => {
    // av-encoded bytes decoded by im → same as im-encoded bytes decoded
    // by av. Both ports must agree on the encode AND decode halves.
    const original = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255]);
    const avEncoded = avEncodeBase64Url(original);
    const imEncoded = imEncodeBase64Url(original);
    expect(avEncoded).toBe(imEncoded);
    const avDecoded = avDecodeBase64Url(imEncoded);
    const imDecoded = imDecodeBase64Url(avEncoded);
    expect(Array.from(avDecoded)).toEqual(Array.from(original));
    expect(Array.from(imDecoded)).toEqual(Array.from(original));
  });
});
