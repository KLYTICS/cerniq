// JWKS loaders — fetch from a URL or read from a local file. The latter
// is the airgapped-audit pathway: download the JWKS once, hand-carry it
// to a sealed verification environment, run the verifier offline.

import { readFile } from 'node:fs/promises';

import type { JwksDocument, JwksKey } from './types.js';

const ED25519_PUBKEY_LEN = 32;

/** Fetch a JWKS from an HTTPS URL. Validates structure before returning. */
export async function loadJwksFromUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<JwksDocument> {
  const resp = await fetchImpl(url, {
    headers: { Accept: 'application/jwk-set+json, application/json' },
  });
  if (!resp.ok) {
    throw new Error(`audit-verifier: JWKS fetch ${url} returned HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as unknown;
  return validateJwks(body, url);
}

/** Read a JWKS from a local file. */
export async function loadJwksFromFile(path: string): Promise<JwksDocument> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(
      `audit-verifier: ${path} is not valid JSON — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return validateJwks(parsed, path);
}

/** Structural validation — every key must be a usable Ed25519 public key. */
export function validateJwks(value: unknown, source: string): JwksDocument {
  if (!value || typeof value !== 'object') {
    throw new Error(`audit-verifier: ${source} did not contain a JWKS object`);
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.keys)) {
    throw new Error(`audit-verifier: ${source} has no "keys" array`);
  }
  const keys: JwksKey[] = [];
  for (const [idx, raw] of (obj.keys as unknown[]).entries()) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`audit-verifier: ${source} keys[${idx}] is not an object`);
    }
    const k = raw as Record<string, unknown>;
    if (k.kty !== 'OKP') {
      throw new Error(`audit-verifier: ${source} keys[${idx}].kty must be "OKP", got "${String(k.kty)}"`);
    }
    if (k.crv !== 'Ed25519') {
      throw new Error(`audit-verifier: ${source} keys[${idx}].crv must be "Ed25519", got "${String(k.crv)}"`);
    }
    if (typeof k.x !== 'string' || k.x.length === 0) {
      throw new Error(`audit-verifier: ${source} keys[${idx}].x is missing or non-string`);
    }
    if (typeof k.kid !== 'string' || k.kid.length === 0) {
      throw new Error(`audit-verifier: ${source} keys[${idx}].kid is missing or non-string`);
    }
    if (k.use !== undefined && k.use !== 'sig') {
      throw new Error(
        `audit-verifier: ${source} keys[${idx}].use must be "sig" or absent, got ${JSON.stringify(k.use)}`,
      );
    }
    keys.push({
      kty: 'OKP',
      crv: 'Ed25519',
      x: k.x,
      kid: k.kid,
      use: 'sig',
      rotated_at: typeof k.rotated_at === 'string' ? k.rotated_at : undefined,
      expires_at: typeof k.expires_at === 'string' ? k.expires_at : undefined,
    });
  }
  if (keys.length === 0) {
    throw new Error(`audit-verifier: ${source} JWKS has zero keys`);
  }
  return { keys };
}

/** Find a public key by kid. Returns the raw 32-byte key or null. */
export function lookupPublicKey(jwks: JwksDocument, kid: string): Uint8Array | null {
  const key = jwks.keys.find((k) => k.kid === kid);
  if (!key) return null;
  // We can't import canonical's decodeBase64Url here (avoid cycle); inline the decode.
  const padded = key.x.replace(/-/g, '+').replace(/_/g, '/');
  const fill = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(fill));
  if (bin.length !== ED25519_PUBKEY_LEN) {
    throw new Error(
      `audit-verifier: kid="${kid}" decoded to ${bin.length} bytes, expected ${ED25519_PUBKEY_LEN}`,
    );
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
