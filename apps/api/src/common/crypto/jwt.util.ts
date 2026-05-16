import './crypto.bootstrap.js';
import { Injectable, Logger } from '@nestjs/common';
import * as ed from '@noble/ed25519';
import { decodeBase64Url, encodeBase64Url } from './ed25519.util';

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

  // RFC 9101 (JAR — JWT Authorization Request) optional claims. Present
  // when the agent SDK constructs a JAR-conformant request object.
  // Backward compatible: tokens omitting these still validate as long
  // as no JAR-strict options are supplied at verify time.

  /** RFC 9101 / RFC 7519 §4.1.1 — Issuer. Should equal `sub` (the agent id)
   *  for AEGIS, but the field is preserved separately for FAPI interop
   *  where iss carries the FAPI client_id. */
  iss?: string;

  /** RFC 9101 / RFC 7519 §4.1.3 — Audience. The AEGIS issuer URL. Validated
   *  when verifyAndDecode is called with `options.requiredAudience`. */
  aud?: string;

  /** RFC 9396 RAR — inline authorization_details signed by the agent. When
   *  present, the verify path extracts these for downstream RAR evaluation.
   *  Signed-in-JWT means a man-in-the-middle cannot swap the RAR claims. */
  authorization_details?: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Optional JAR-strict validation knobs for `verifyAndDecode`. When all
 * are omitted, behavior matches the pre-JAR baseline (backward compat).
 * When provided, the corresponding claim is validated per RFC 9101.
 */
export interface JarValidationOptions {
  /** RFC 9101 — when set, claims.aud MUST equal this exact string.
   *  Mismatch → verification fails. Use the AEGIS issuer URL. */
  requiredAudience?: string;
  /** RFC 9101 — when set, claims.iss MUST equal this exact string. */
  requiredIssuer?: string;
  /** RFC 9101 — when set, the JWT is rejected if (now - iat) exceeds
   *  this many seconds. Defends against very-stale signed requests
   *  being replayed against a recently-rotated agent key. */
  maxAgeSeconds?: number;
}

const HEADER_B64 = encodeBase64Url(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));

@Injectable()
export class JwtUtil {
  private readonly logger = new Logger(JwtUtil.name);

  /**
   * Verify an Ed25519-signed JWT against the supplied base64url public key.
   * Returns the decoded claims on success, or `null` on any failure.
   *
   * SECURITY: This validates structure + signature + `exp` only by default.
   * Caller is responsible for any business-level checks (revocation, scope,
   * spend). Pass `options` to layer in RFC 9101 (JAR) claim validation
   * (audience, issuer, max iat age) — recommended for FAPI-shaped flows.
   *
   * The pre-JAR baseline behavior is preserved when `options` is omitted,
   * so existing callers and existing tokens remain valid. RFC 9101 mode
   * is opt-in until operator-side enforcement makes sense to default on.
   */
  async verifyAndDecode(
    token: string,
    publicKeyB64Url: string,
    options?: JarValidationOptions,
  ): Promise<AgentTokenClaims | null> {
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

      // RFC 9101 (JAR) — opt-in claim validation. Each check is enforced
      // ONLY when the caller has supplied the corresponding required value;
      // omitting all options preserves pre-JAR backward compat.
      if (options) {
        if (options.requiredAudience !== undefined) {
          if (claims.aud !== options.requiredAudience) {
            this.logger.debug(
              `JWT aud mismatch: required="${options.requiredAudience}" got="${String(claims.aud)}"`,
            );
            return null;
          }
        }
        if (options.requiredIssuer !== undefined) {
          if (claims.iss !== options.requiredIssuer) {
            this.logger.debug(
              `JWT iss mismatch: required="${options.requiredIssuer}" got="${String(claims.iss)}"`,
            );
            return null;
          }
        }
        if (options.maxAgeSeconds !== undefined) {
          if (typeof claims.iat !== 'number' || claims.iat <= 0) return null;
          if (now - claims.iat > options.maxAgeSeconds) {
            this.logger.debug(
              `JWT iat too old: now-iat=${now - claims.iat}s max=${options.maxAgeSeconds}s`,
            );
            return null;
          }
        }
      }

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
