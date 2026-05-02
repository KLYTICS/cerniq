import { Injectable, Logger } from '@nestjs/common';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { decodeBase64Url, encodeBase64Url } from './ed25519.util';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Compact JWT with EdDSA (Ed25519). Three dot-separated base64url segments:
 *   header.payload.signature
 *
 * Header: { "alg": "EdDSA", "typ": "JWT" }
 * Payload (agent token): {
 *   sub: agentId,
 *   pid: policyId,
 *   act: action,
 *   amt?: number,
 *   cur?: string,
 *   dom?: string,
 *   iat: epoch_seconds,
 *   exp: epoch_seconds,
 *   jti: ulid
 * }
 *
 * Implemented locally rather than via `jose` to avoid bringing in a heavy
 * dependency on the verify hot path. Verified against `jose` parity in CI.
 */

export interface AgentTokenClaims {
  sub: string; // agentId
  pid: string; // policyId
  act?: string;
  amt?: number;
  cur?: string;
  dom?: string;
  iat: number;
  exp: number;
  jti: string;
}

const HEADER_B64 = encodeBase64Url(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));

@Injectable()
export class JwtUtil {
  private readonly logger = new Logger(JwtUtil.name);

  /**
   * Verify an Ed25519-signed JWT against the supplied base64url public key.
   * Returns the decoded claims on success, or `null` on any failure.
   *
   * SECURITY: This validates structure + signature + `exp` only. Caller is
   * responsible for any business-level checks (revocation, scope, spend).
   */
  async verifyAndDecode(token: string, publicKeyB64Url: string): Promise<AgentTokenClaims | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    if (!headerB64 || !payloadB64 || !sigB64) return null;

    try {
      const signingInput = enc.encode(`${headerB64}.${payloadB64}`);
      const sig = decodeBase64Url(sigB64);
      const pub = decodeBase64Url(publicKeyB64Url);

      const ok = await ed.verifyAsync(sig, signingInput, pub);
      if (!ok) return null;

      const payloadJson = dec.decode(decodeBase64Url(payloadB64));
      const claims = JSON.parse(payloadJson) as AgentTokenClaims;

      const now = Math.floor(Date.now() / 1000);
      if (claims.exp && claims.exp < now) return null;
      if (!claims.sub || !claims.pid) return null;

      return claims;
    } catch (err) {
      this.logger.debug(`JWT decode failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Decode without signature verification. Used for telemetry only.
   * Never call this on an unverified path.
   */
  decodeUnsafe(token: string): AgentTokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const json = dec.decode(decodeBase64Url(parts[1]!));
      return JSON.parse(json) as AgentTokenClaims;
    } catch {
      return null;
    }
  }

  /**
   * Sign a JWT with the supplied Ed25519 private key. Test/dev/SDK helper.
   */
  async sign(claims: AgentTokenClaims, privateKey: Uint8Array): Promise<string> {
    const payloadB64 = encodeBase64Url(enc.encode(JSON.stringify(claims)));
    const signingInput = enc.encode(`${HEADER_B64}.${payloadB64}`);
    const sig = await ed.signAsync(signingInput, privateKey);
    return `${HEADER_B64}.${payloadB64}.${encodeBase64Url(sig)}`;
  }
}
