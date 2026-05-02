import { Injectable, Logger } from '@nestjs/common';
import { type AppConfig, configSchema } from './config.schema';

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private readonly config: AppConfig;

  constructor() {
    const parsed = configSchema.safeParse(process.env);
    if (!parsed.success) {
      this.logger.error('Invalid environment configuration', parsed.error.format());
      throw new Error(`Configuration validation failed: ${parsed.error.message}`);
    }
    this.config = parsed.data;
  }

  get nodeEnv(): AppConfig['NODE_ENV'] {
    return this.config.NODE_ENV;
  }
  get port(): number {
    return this.config.PORT;
  }
  get logLevel(): AppConfig['LOG_LEVEL'] {
    return this.config.LOG_LEVEL;
  }
  get apiBaseUrl(): string {
    return this.config.API_BASE_URL;
  }
  get databaseUrl(): string {
    return this.config.DATABASE_URL;
  }
  get redisUrl(): string {
    return this.config.REDIS_URL;
  }
  get apiKeyBcryptCost(): number {
    return this.config.API_KEY_BCRYPT_COST;
  }
  get throttleVerifyPerMin(): number {
    return this.config.THROTTLE_VERIFY_PER_MIN;
  }
  get throttleDefaultPerMin(): number {
    return this.config.THROTTLE_DEFAULT_PER_MIN;
  }
  get enableBate(): boolean {
    return this.config.ENABLE_BATE;
  }
  get enableWebhooks(): boolean {
    return this.config.ENABLE_WEBHOOKS;
  }
  get enableSwagger(): boolean {
    return this.config.ENABLE_SWAGGER;
  }
  get auditSigningKeyB64(): string | undefined {
    return this.config.AUDIT_SIGNING_KEY_B64;
  }
  /**
   * AEGIS audit-chain + JWKS signing keypair.
   *
   * Canonical envs are `AEGIS_SIGNING_PRIVATE_KEY` / `AEGIS_SIGNING_PUBLIC_KEY`.
   * Older deploys may still supply `AUDIT_ED25519_*_B64` aliases; we accept
   * them with a deprecation warning. Remove the legacy fall-through one
   * minor release after operators have renamed.
   */
  get auditEd25519PrivateB64(): string | undefined {
    if (this.config.AEGIS_SIGNING_PRIVATE_KEY) return this.config.AEGIS_SIGNING_PRIVATE_KEY;
    if (this.config.AUDIT_ED25519_PRIVATE_KEY_B64) {
      this.logger.warn(
        'AUDIT_ED25519_PRIVATE_KEY_B64 is deprecated; rename to AEGIS_SIGNING_PRIVATE_KEY before v0.2.',
      );
      return this.config.AUDIT_ED25519_PRIVATE_KEY_B64;
    }
    return undefined;
  }
  get auditEd25519PublicB64(): string | undefined {
    if (this.config.AEGIS_SIGNING_PUBLIC_KEY) return this.config.AEGIS_SIGNING_PUBLIC_KEY;
    if (this.config.AUDIT_ED25519_PUBLIC_KEY_B64) {
      this.logger.warn(
        'AUDIT_ED25519_PUBLIC_KEY_B64 is deprecated; rename to AEGIS_SIGNING_PUBLIC_KEY before v0.2.',
      );
      return this.config.AUDIT_ED25519_PUBLIC_KEY_B64;
    }
    return undefined;
  }
  get jwtEd25519PrivateB64(): string | undefined {
    return this.config.JWT_ED25519_PRIVATE_KEY_B64;
  }
  get jwtEd25519PublicB64(): string | undefined {
    return this.config.JWT_ED25519_PUBLIC_KEY_B64;
  }
  get aegisSigningPublicKey(): string | undefined {
    return this.config.AEGIS_SIGNING_PUBLIC_KEY;
  }
  get aegisSigningKeyRotatedAt(): string | undefined {
    return this.config.AEGIS_SIGNING_KEY_ROTATED_AT;
  }
  /** Auth0 bridge — consumed by `apps/api/src/modules/auth0/`. */
  get auth0Issuer(): string | undefined {
    return this.config.AUTH0_ISSUER;
  }
  get auth0Audience(): string | undefined {
    return this.config.AUTH0_AUDIENCE;
  }
  get auth0ActionSecret(): string | undefined {
    return this.config.AUTH0_ACTION_SECRET;
  }
  get corsOrigins(): string | string[] {
    const raw = this.config.CORS_ORIGINS;
    if (raw === '*') return '*';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}
