import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

const intish = z.union([z.number(), z.string()]).transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)));

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: intish.default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Reserved for legacy RSA flow — superseded by AEGIS_SIGNING_*. Will be removed in v0.2.
  AUDIT_SIGNING_KEY_B64: z.string().optional(),

  // ----- Canonical signing-key envs (audit + .well-known) -----
  // Both audit.service.ts (signs the chain) and wellknown.service.ts
  // (publishes the verification key at /.well-known/jwks.json) read these.
  // Stored as base64url-encoded raw 32-byte Ed25519 keys.
  AEGIS_SIGNING_PRIVATE_KEY: z.string().min(40).optional(),
  AEGIS_SIGNING_PUBLIC_KEY: z.string().min(40).optional(),
  AEGIS_SIGNING_KEY_ROTATED_AT: z.string().datetime().optional(),

  // ----- Auth0 bridge (ADR-0009) -----
  // The peer auth0 module reads these. Issuer matches Auth0's `iss` claim
  // shape (`https://<tenant>.auth0.com/`). Action secret authenticates
  // the Auth0 Action webhook.
  AUTH0_ISSUER: z.string().url().optional(),
  AUTH0_AUDIENCE: z.string().optional(),
  AUTH0_ACTION_SECRET: z.string().optional(),

  // ----- Legacy aliases (deprecated 2026-Q2; remove after one minor release) -----
  // The audit module previously read these; the wellknown module always
  // read the canonical pair above. Keeping them as accepted-but-warned
  // inputs lets in-flight Railway descriptors keep booting until operators
  // rename. ConfigService.aegisSigningPrivateKey() falls back to these and
  // logs a deprecation warning at boot.
  AUDIT_ED25519_PRIVATE_KEY_B64: z.string().optional(),
  AUDIT_ED25519_PUBLIC_KEY_B64: z.string().optional(),

  // Agent-side JWT signing key — distinct from the audit/.well-known pair.
  JWT_ED25519_PRIVATE_KEY_B64: z.string().optional(),
  JWT_ED25519_PUBLIC_KEY_B64: z.string().optional(),

  API_KEY_BCRYPT_COST: intish.default(12),

  THROTTLE_VERIFY_PER_MIN: intish.default(1000),
  THROTTLE_DEFAULT_PER_MIN: intish.default(120),

  ENABLE_BATE: boolish.default(true),
  ENABLE_WEBHOOKS: boolish.default(true),
  ENABLE_SWAGGER: boolish.default(true),

  CORS_ORIGINS: z.string().default('*'),

  SENTRY_DSN: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Stripe price ids per plan tier (env-driven so they vary per env).
  // Suffix matches `PlanDefinition.stripeEnvSuffix` from billing/plans.ts.
  STRIPE_PRICE_DEVELOPER: z.string().optional(),
  STRIPE_PRICE_GROWTH: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),
  // Metered price for paid-tier overage verifies (ADR-0014, $0.0008/verify
  // uniform). Stripe rolls these `usage_records.create` calls up at
  // billing-period close. When unset, paid principals exceeding their
  // monthly cap are silently NOT metered — recordOverage logs a warn.
  STRIPE_PRICE_OVERAGE_VERIFY: z.string().optional(),
  // Where Stripe-hosted Checkout / Customer Portal redirect after the
  // user finishes (or cancels) the flow. Required when STRIPE_SECRET_KEY
  // is set; refused at boot if Stripe is enabled without them.
  STRIPE_PORTAL_RETURN_URL: z.string().url().optional(),
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CHECKOUT_CANCEL_URL: z.string().url().optional(),

  // ----- Webhook secret envelope encryption (DEK) -----
  // Per-deployment 32-byte AES-256-GCM data encryption key, base64-encoded.
  // Wraps `WebhookSubscription.secret` at rest so a DB-only compromise
  // cannot forge HMAC signatures on outgoing webhook payloads.
  // Production: REQUIRED — `WebhookSecretCipher` fails-loud at boot.
  // Dev/test: OPTIONAL — cipher generates an ephemeral DEK and logs a WARN
  // with the b64 so the developer can pin it across restarts.
  AEGIS_WEBHOOK_SECRET_DEK_B64: z
    .string()
    .optional()
    .refine(
      (v) => {
        if (v === undefined) return true;
        try {
          return Buffer.from(v, 'base64').length === 32;
        } catch {
          return false;
        }
      },
      { message: 'AEGIS_WEBHOOK_SECRET_DEK_B64 must decode to 32 bytes (AES-256 key).' },
    ),

  // ----- WorkOS adapter (idp-workos.module) -----
  // Module is registered unconditionally in app.module.ts; the provider
  // factory throws if WORKOS_API_KEY is missing. Optional in schema so
  // dev/test can stub with any value.
  WORKOS_API_KEY: z.string().optional(),
  WORKOS_COOKIE_PASSWORD: z.string().optional(),

  // ----- RFC 9101 (JAR) enforcement knobs -----
  // Optional and OFF by default. Setting either of these tightens the
  // verify hot path beyond the pre-JAR baseline and MUST be coordinated
  // with the agent fleet (every SDK must already be signing the matching
  // claim) — otherwise upgraded-server + old-SDK combinations fail with
  // INVALID_SIGNATURE that looks like a key problem.
  //
  // Rollout: ship SDK support → wait for fleet to roll over → enable knob
  // behind a flag → canary on a single relying party → flip for the
  // deployment. See `apps/api/src/common/crypto/jwt.util.ts`
  // `JarValidationOptions` JSDoc for the deployment-coordination
  // footgun details.
  //
  // AEGIS_MAX_TOKEN_AGE_SECONDS — when set, tokens whose `iat` is older
  // than this many seconds are rejected at Step 3.6 EVEN IF `exp` is in
  // the future. Defense against long-lived tokens being replayed within
  // their exp window after credential exposure (logs, screenshots).
  // Conventional FAPI 2.0 ceiling is 300 (5 min). Production guidance:
  // ≥60s unless you've measured your relying-party-to-AEGIS p99 RTT.
  AEGIS_MAX_TOKEN_AGE_SECONDS: intish.optional(),

  // AEGIS_STRICT_JAR_ISS — when true, tokens with `iss !== sub` are
  // rejected at Step 3.5. RFC 9101 specifies `iss` SHOULD be the
  // client_id; in AEGIS that's the agent_id (= sub). Mismatch is either
  // a client-SDK bug or an impersonation attempt. Default: false
  // (backward compat with SDKs that set iss to something else, e.g.
  // principal_id).
  AEGIS_STRICT_JAR_ISS: boolish.default(false),
});

export type AppConfig = z.infer<typeof configSchema>;
