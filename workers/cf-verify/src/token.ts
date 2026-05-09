// Edge JWT decode + signature verify. CF Worker uses the WebCrypto API
// (no Node deps); Ed25519 verify is GA in Workers since 2023.
//
// We DO NOT re-implement the full apps/api JwtUtil — we just verify the
// minimum we need to call the cached agent's pubkey safe, and surface
// claims for scope evaluation. The origin is the source of truth on any
// edge-cant-decide.

const ALG = 'EdDSA';
const TYP = 'JWT';

export interface AgentTokenClaims {
  sub: string;  // agentId
  pid: string;  // policyId
  act?: string;
  amt?: number;
  cur?: string;
  dom?: string;
  iat: number;
  exp: number;
  jti: string;
}

export type DecodedToken = { header: { alg: string; typ: string }; claims: AgentTokenClaims; signingInput: Uint8Array; signature: Uint8Array };

/**
 * Decode without verifying. Used to look up the cached agent record
 * (we need agentId to know whose pubkey to fetch). NEVER honor a
 * decoded-but-unverified token for authorization.
 */
export function decodeUnsafe(token: string): DecodedToken | null {
  const parts = token.split('.');
  // length === 3 narrows to a fixed shape under noUncheckedIndexedAccess —
  // but TS still types the elements as `string | undefined`. Destructure
  // with explicit narrowing so each part is `string`.
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  try {
    const header = JSON.parse(b64uToString(headerB64)) as { alg: string; typ: string };
    const claims = JSON.parse(b64uToString(payloadB64)) as AgentTokenClaims;
    if (header.alg !== ALG || header.typ !== TYP) return null;
    if (typeof claims.sub !== 'string' || typeof claims.pid !== 'string') return null;
    return {
      header,
      claims,
      signingInput: new TextEncoder().encode(`${headerB64}.${payloadB64}`),
      signature: b64uToBytes(sigB64),
    };
  } catch {
    return null;
  }
}

/**
 * Verify Ed25519 signature using WebCrypto. The pubKey is the base64url
 * 32-byte raw public key from the cached agent record.
 */
export async function verifyEd25519(
  publicKeyB64u: string,
  signingInput: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const pubKey = await crypto.subtle.importKey(
      'raw',
      b64uToBytes(publicKeyB64u),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify('Ed25519', pubKey, signature, signingInput);
  } catch {
    return false;
  }
}

function b64uToString(s: string): string {
  return new TextDecoder().decode(b64uToBytes(s));
}
function b64uToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
