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
  /**
   * Webhook secret envelope DEK (base64). Optional in dev/test —
   * `WebhookSecretCipher` generates an ephemeral one with a WARN log when
   * absent. In production, the cipher must fail-loud if this is missing.
   */
  get webhookSecretDekB64(): string | undefined {
    return this.config.AEGIS_WEBHOOK_SECRET_DEK_B64;
  }
  // ── WorkOS adapter (idp-workos.module reads via property cast) ────────
  get workosApiKey(): string | undefined {
    return this.config.WORKOS_API_KEY;
  }
  get workosCookiePassword(): string | undefined {
    return this.config.WORKOS_COOKIE_PASSWORD;
  }
  // ── Stripe billing (G-3) ────────────────────────────────────────
  // All optional — when STRIPE_SECRET_KEY is absent, StripeService NO-OPs
  // (manual planTier still works). Price ids vary per env (test vs live).
  get stripeSecretKey(): string | undefined {
    return this.config.STRIPE_SECRET_KEY;
  }
  get stripeWebhookSecret(): string | undefined {
    return this.config.STRIPE_WEBHOOK_SECRET;
  }
  get stripePriceDeveloper(): string | undefined {
    return this.config.STRIPE_PRICE_DEVELOPER;
  }
  get stripePriceGrowth(): string | undefined {
    return this.config.STRIPE_PRICE_GROWTH;
  }
  get stripePriceEnterprise(): string | undefined {
    return this.config.STRIPE_PRICE_ENTERPRISE;
  }
  /**
   * Metered Stripe price id for paid-tier verify overage (ADR-0014).
   * Used by `StripeService.onSubscriptionUpdated` to identify the
   * subscription-item line that `recordOverage` increments against.
   */
  get stripePriceOverageVerify(): string | undefined {
    return this.config.STRIPE_PRICE_OVERAGE_VERIFY;
  }
  get stripePortalReturnUrl(): string | undefined {
    return this.config.STRIPE_PORTAL_RETURN_URL;
  }
  get stripeCheckoutSuccessUrl(): string | undefined {
    return this.config.STRIPE_CHECKOUT_SUCCESS_URL;
  }
  get stripeCheckoutCancelUrl(): string | undefined {
    return this.config.STRIPE_CHECKOUT_CANCEL_URL;
  }
  /** Lookup a Stripe price id by AEGIS plan tier. Returns undefined for FREE. */
  stripePriceId(tier: 'DEVELOPER' | 'GROWTH' | 'ENTERPRISE'): string | undefined {
    switch (tier) {
      case 'DEVELOPER':
        return this.stripePriceDeveloper;
      case 'GROWTH':
        return this.stripePriceGrowth;
      case 'ENTERPRISE':
        return this.stripePriceEnterprise;
    }
  }

  get corsOrigins(): string | string[] {
    const raw = this.config.CORS_ORIGINS;
    if (raw === '*') return '*';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}
