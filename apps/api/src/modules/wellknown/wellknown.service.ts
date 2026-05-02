import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfigService } from '../../config/config.service';
import { decodeBase64Url, encodeBase64Url } from '../../common/crypto/ed25519.util';
import type { AuditSigningKeyDto, JwkEd25519Dto, JwksDto } from './dto/jwks.dto';

const ISSUER = 'https://aegislabs.io';
const VERIFICATION_GUIDE = 'https://docs.aegislabs.io/audit/verify';
const ED25519_PUBKEY_LEN = 32;

/**
 * Publishes AEGIS's audit-event-signing public key.
 *
 * CLAUDE.md invariants:
 * - #3 (audit chain): the published key is what relying parties use to verify
 *   the chain signature on every AuditEvent.
 * - #4 (no silent failures, no fabricated data): we throw at boot if the
 *   signing key is unset, and we mark the rotation timestamp DEGRADED if
 *   AEGIS_SIGNING_KEY_ROTATED_AT is missing rather than fabricate it
 *   per-request.
 */
@Injectable()
export class WellknownService implements OnModuleInit {
  private readonly logger = new Logger(WellknownService.name);

  // Memoised — computed once at module init so request-time cost is zero.
  private publicKeyB64Url!: string;
  private kid!: string;
  private rotatedAt!: string;
  private rotatedAtIsDegradedFallback = false;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const raw = this.config.aegisSigningPublicKey;
    if (!raw || raw.length === 0) {
      throw new Error(
        'AEGIS_SIGNING_PUBLIC_KEY env var must be set; generate with `pnpm --filter @aegis/scripts run keys`',
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = decodeBase64Url(raw);
    } catch (err) {
      throw new Error(`AEGIS_SIGNING_PUBLIC_KEY is not valid base64url: ${(err as Error).message}`);
    }

    if (bytes.length !== ED25519_PUBKEY_LEN) {
      throw new Error(
        `AEGIS_SIGNING_PUBLIC_KEY decoded to ${bytes.length} bytes; expected ${ED25519_PUBKEY_LEN} (raw Ed25519).`,
      );
    }

    // Normalise to a canonical base64url form (in case the source had padding).
    this.publicKeyB64Url = encodeBase64Url(bytes);
    this.kid = computeKid(bytes);

    const rotatedAtEnv = this.config.aegisSigningKeyRotatedAt;
    if (rotatedAtEnv) {
      this.rotatedAt = rotatedAtEnv;
      this.rotatedAtIsDegradedFallback = false;
    } else {
      // Captured ONCE at construction so it's not a fabricated wall-clock time
      // at request time. Logged + flagged DEGRADED — this is the "soft path"
      // explicitly carved out in the module spec.
      this.rotatedAt = new Date().toISOString();
      this.rotatedAtIsDegradedFallback = true;
      this.logger.warn(
        'AEGIS_SIGNING_KEY_ROTATED_AT not set — using process-start timestamp. ' +
          'DEGRADED: relying parties cannot pin actual rotation time.',
      );
    }
  }

  /** True if rotatedAt is the captured-at-init fallback rather than configured. */
  isRotatedAtDegraded(): boolean {
    return this.rotatedAtIsDegradedFallback;
  }

  getKid(): string {
    return this.kid;
  }

  getAuditSigningKey(): AuditSigningKeyDto {
    return {
      kid: this.kid,
      publicKey: this.publicKeyB64Url,
      algorithm: 'EdDSA',
      curve: 'Ed25519',
      issuer: ISSUER,
      rotatedAt: this.rotatedAt,
      purpose: 'audit-event-signing',
      verificationGuide: VERIFICATION_GUIDE,
    };
  }

  getJwks(): JwksDto {
    const jwk: JwkEd25519Dto = {
      kty: 'OKP',
      crv: 'Ed25519',
      alg: 'EdDSA',
      use: 'sig',
      kid: this.kid,
      x: this.publicKeyB64Url,
    };
    return { keys: [jwk] };
  }
}

/**
 * RFC 8037 § 2 leaves `kid` choice to the implementer. We use
 * `sha256(rawPublicKeyBytes)` truncated to the first 16 chars of base64url —
 * collision-resistant for our key population (one active + maybe one
 * rotating-out at any time) and short enough to fit in HTTP ETag headers
 * without bloating cache layers.
 */
export function computeKid(rawPublicKey: Uint8Array): string {
  const digest = createHash('sha256').update(rawPublicKey).digest();
  return encodeBase64Url(new Uint8Array(digest)).slice(0, 16);
}
