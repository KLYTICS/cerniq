import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PlanTier } from '@prisma/client';
import { AppConfigService } from '../../config/config.service';
import { decodeBase64Url, encodeBase64Url } from '../../common/crypto/ed25519.util';
import { PLANS, TRIAL_LIFETIME_CAP, getPlan } from '../billing/plans';
import type { AuditSigningKeyDto, JwkEd25519Dto, JwksDto } from './dto/jwks.dto';
import type { AegisConfigurationDto } from './dto/discovery.dto';
import type { OAuthAuthorizationServerMetadataDto } from './dto/oauth-as-metadata.dto';
import type {
  RetentionPolicyDto,
  RetentionPolicyTierDto,
} from './dto/retention-policy.dto';
import type { PricingDto, PricingTierDto } from './dto/pricing.dto';

// type-rationale: package.json is a static JSON resource and tsconfig has
// resolveJsonModule=true. Importing once at module load avoids fs reads
// per request.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
import * as pkgJson from '../../../package.json';

/** Spec-doc schema version. Bump major on breaking change, minor on
 *  additive field set.
 *  1.1.0 — added FAPI-2.0-aligned metadata block (fapi_profile,
 *          standards_implemented/aligned, signing alg values,
 *          agent_authentication_methods_supported, op_policy_uri, op_tos_uri).
 *  1.2.0 — promoted RFC-9396 (RAR) from aligned → implemented; added
 *          `authorization_details_types_supported` field listing the four
 *          registered detail types (trading_order, payment_initiation,
 *          data_access, agent_action).
 *  1.3.0 — promoted RFC-8414 (OAuth AS Metadata) via new endpoint
 *          /.well-known/oauth-authorization-server; promoted RFC-6749
 *          (OAuth error envelope §5.2) via canonical `error` field on
 *          verify response. Two RFCs moved from aligned → implemented.
 *  1.4.0 — promoted RFC-9101 (JAR — JWT Authorization Request) via
 *          opt-in claim validation on JwtUtil.verifyAndDecode
 *          (requiredAudience, requiredIssuer, maxAgeSeconds) and
 *          authorization_details claim support. Existing `token` field
 *          on /v1/verify is RFC-9101 shape-compatible.
 *  See docs/spec/05_FAPI_2_0_PROFILE.md for the binding contract. */
const DISCOVERY_SPEC_VERSION = '1.4.0';

/** Identifier of the AEGIS FAPI profile binding. Bump on any breaking
 *  change to the standards-binding contract; minor on additive RFC
 *  coverage. Authority: docs/spec/05_FAPI_2_0_PROFILE.md. */
const FAPI_PROFILE_ID = 'aegis-fapi-2.0-aligned-1.0';

/** Standards AEGIS bindingly implements today — every entry must be
 *  citable to running code + tests in this repo. Adding to this list
 *  without a corresponding implementation gate is a CLAUDE.md invariant
 *  #4 violation (no fabricated data). */
const STANDARDS_IMPLEMENTED: readonly string[] = Object.freeze([
  'RFC-8032', // EdDSA (Ed25519) — apps/api/src/common/crypto/ed25519.util.ts
  'RFC-7517', // JWKS — wellknown.service.ts getJwks()
  'RFC-9116', // security.txt — wellknown.service.ts getSecurityTxt()
  'RFC-9396', // RAR — apps/api/src/modules/verify/rar/{evaluator,controller}.ts
              // promoted from `aligned` on 2026-05-15 — promotion test:
              // rar.evaluator.spec.ts + rar.controller.spec.ts. Exposes
              // POST /v1/verify/rar/evaluate as a stateless decision
              // endpoint with 4 registered detail types.
  'RFC-8414', // OAuth 2.0 Authorization Server Metadata — served at
              // /.well-known/oauth-authorization-server. Honest subset:
              // empty arrays for fields AEGIS doesn't implement (e.g.
              // response_types_supported) + AEGIS-specific aegis_*
              // extensions per RFC 8414 §2.4. Promoted 2026-05-15.
  'RFC-6749', // OAuth 2.0 — error envelope §5.2. Every denial returned
              // from /v1/verify carries an `error` field (OAuth-canonical)
              // alongside the AEGIS-specific `denialReason`. Mapping table:
              // apps/api/src/modules/verify/oauth-error-mapping.ts.
              // Promoted 2026-05-15.
  'RFC-9101', // JAR (JWT Authorization Request) — apps/api/src/common/crypto/
              // jwt.util.ts verifyAndDecode accepts opt-in JAR validation
              // (requiredAudience, requiredIssuer, maxAgeSeconds). The
              // existing `token` field on /v1/verify is shape-compatible
              // with RFC 9101 request objects: agent signs an Ed25519 JWT
              // with iat/exp/jti + optional iss/aud/authorization_details.
              // Binding test: jwt.util.jar.spec.ts. Promoted 2026-05-16.
]);

/** Standards AEGIS is positionally aligned with — the discovery shape
 *  mirrors them, but a wire-level contract test would fail today. Each
 *  entry has a Q3-Q4 2026 implementation gate in the FAPI profile spec.
 *  Honesty-by-construction: never promote to STANDARDS_IMPLEMENTED until
 *  a binding integration test passes. */
const STANDARDS_ALIGNED: readonly string[] = Object.freeze([
  'RFC-9449', // DPoP — proof-of-possession headers, planned
  'RFC-9421', // HTTP Message Signatures — webhook signing alternative, planned
]);

const AGENT_AUTH_METHODS: readonly string[] = Object.freeze([
  'ed25519_canonical_json',
]);

/** Registered RAR `authorization_details` types (RFC 9396 §2.1). The
 *  discovery doc surfaces these so a FAPI client can statically know
 *  which RAR shapes AEGIS will accept on /v1/verify/rar/evaluate.
 *  Mirrors `REGISTERED_AUTH_DETAIL_TYPES` in rar.types.ts; the parity
 *  is asserted by the wellknown service spec. */
const AUTHORIZATION_DETAILS_TYPES_SUPPORTED: readonly string[] = Object.freeze([
  'trading_order',
  'payment_initiation',
  'data_access',
  'agent_action',
]);

const FAPI_PROFILE_DOC_URL = 'https://docs.aegislabs.io/spec/05_FAPI_2_0_PROFILE';
/** Spec-doc schema version for retention-policy.json. Independent from DISCOVERY_SPEC_VERSION. */
const RETENTION_POLICY_SPEC_VERSION = '1.0.0';
/** Spec-doc schema version for pricing.json. Independent from DISCOVERY_SPEC_VERSION. */
const PRICING_SPEC_VERSION = '1.0.0';
/** Hardcoded for now; future spec_version may switch on operator-set locale env. */
const PRICING_CURRENCY = 'USD';
const PRICING_OVERAGE_UNIT = 'USD × 10⁻⁴ (i.e. ten-thousandths of a dollar)';
const PRICING_ADR = 'ADR-0014';
const ISSUER = 'https://aegislabs.io';
const VERIFICATION_GUIDE = 'https://docs.aegislabs.io/audit/verify';
const ED25519_PUBKEY_LEN = 32;
/**
 * Mirror of `DEFAULT_RETENTION_RUN_INTERVAL_MS` in
 * `compliance/audit-retention.service.ts` (24h, in seconds for the
 * public discovery body). Kept in sync by `retention-policy.parity`
 * spec — drift fails the build.
 */
const RETENTION_RUN_INTERVAL_SECONDS = 86_400;
const RETENTION_INTERVAL_ENV_VAR = 'AEGIS_AUDIT_RETENTION_INTERVAL_MS';
/**
 * Lifted verbatim from `audit-retention.service.ts` redaction reason
 * format (`retention_policy:plan=<TIER>:days=<N>`). Documented here as
 * a contract so SOC2 auditors can grep the discovery doc and recognise
 * the reason strings they will see in exported audit chains.
 */
const RETENTION_REDACTION_METHOD = 'redact-not-delete' as const;
const RETENTION_GUARANTEES: readonly string[] = Object.freeze([
  'Redactions preserve audit chain hashes — chain remains verifiable post-redaction.',
  'Each redaction emits a meta-event in the chain (audit-of-audit).',
  'Public keys (.well-known/audit-signing-key) are never redacted.',
]);

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

    // CLAUDE.md invariant #4 (no fabricated data): if a tier exists in
    // plans.ts but lacks `auditRetentionDays`, refuse to boot rather than
    // silently emit a default. The endpoint MUST mirror plans.ts exactly.
    for (const tier of Object.keys(PLANS) as PlanTier[]) {
      const plan = PLANS[tier];
      if (
        typeof plan.auditRetentionDays !== 'number' ||
        !Number.isFinite(plan.auditRetentionDays) ||
        plan.auditRetentionDays <= 0
      ) {
        throw new Error(
          `PLANS[${tier}].auditRetentionDays is missing or non-positive (${String(
            plan.auditRetentionDays,
          )}). The retention-policy.json discovery doc cannot fabricate a default.`,
        );
      }
      // CLAUDE.md invariant #4 (no fabricated data): an "impossible" plan
      // — no monthly price AND no monthly quota AND a metered overage rate
      // — would force pricing.json to invent a billing model. Refuse to boot.
      const noPrice = plan.monthlyPriceCents == null;
      const noQuota = !Number.isFinite(plan.monthlyVerifyQuota);
      const hasOverage = plan.overagePerCallE4 != null;
      if (noPrice && noQuota && hasOverage) {
        throw new Error(
          `PLANS[${tier}] has no monthly price, no monthly quota, and a metered overage rate. ` +
            `pricing.json cannot derive a coherent billing model from this combination.`,
        );
      }
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

  /**
   * RFC 9116 — `security.txt`. Plain-text responsible-disclosure file.
   * Defaults sensibly so out-of-the-box deployments are reachable; operators
   * can override via env (`AEGIS_SECURITY_CONTACT`, etc.) once that lands.
   *
   * Expires 1 year from the deploy build time so we can't accidentally
   * publish stale contact info — RFC 9116 § 2.5.5 mandates `Expires`.
   */
  getSecurityTxt(): string {
    const issuer = this.config.apiBaseUrl ?? ISSUER;
    const expires = oneYearFromNow();
    const lines = [
      '# AEGIS — security disclosure (RFC 9116)',
      `Contact: mailto:security@aegislabs.io`,
      `Expires: ${expires}`,
      `Preferred-Languages: en`,
      `Canonical: ${trimSlash(issuer)}/.well-known/security.txt`,
      `Policy: https://aegislabs.io/security/policy`,
      `Acknowledgments: https://aegislabs.io/security/hall-of-fame`,
      `# Hash of CLAUDE.md operating directive at this build:`,
      `# (informational — not part of the RFC)`,
    ];
    return lines.join('\n') + '\n';
  }

  /**
   * llms.txt — emerging convention (parallel to robots.txt) for
   * AI-agent-readable site descriptions. Markdown body lists the public
   * surfaces an agent should hit when it wants to talk to AEGIS.
   *
   * AEGIS is the agent identity layer, so this file is doubly relevant —
   * agents that integrate with AEGIS can self-discover the wire format.
   */
  getLlmsTxt(): string {
    const issuer = trimSlash(this.config.apiBaseUrl ?? ISSUER);
    return [
      '# AEGIS — Agent Gateway & Identity Stack',
      '',
      '> Cryptographic identity, scoped policy, and behavioral attestation rail',
      '> for AI agents. ACP-compatible. Platform-, vendor-, and model-neutral.',
      '',
      '## Discovery',
      `- [Configuration (JSON)](${issuer}/.well-known/aegis-configuration)`,
      `- [JWKS](${issuer}/.well-known/jwks.json)`,
      `- [Audit signing key](${issuer}/.well-known/audit-signing-key)`,
      `- [security.txt](${issuer}/.well-known/security.txt)`,
      '',
      '## API',
      `- [OpenAPI spec](${issuer}/docs-json)`,
      `- [Swagger UI](${issuer}/docs)`,
      '',
      '## Verify endpoint (the wire surface)',
      '```',
      `POST ${issuer}/v1/verify`,
      'Headers: X-AEGIS-Verify-Key: <verify-only key>',
      'Body:    { token, action, amount?, currency?, merchantDomain? }',
      'Returns: { valid, agentId, trustScore, trustBand, denialReason?, auditEventId, ttl, verifiedAt }',
      '```',
      '',
      '## SDKs',
      '- TypeScript: `npm install @aegis/sdk`',
      '- Python:     `pip install aegis`',
      '- Relying-party verifier (offline JWKS): `npm install @aegis/verifier-rp`',
      '- MCP bridge (one-line wrap any MCP server): `npm install @aegis/mcp-bridge`',
      '- MCP server (Claude Desktop / Cursor): `npx @aegis/mcp-server`',
      '- CLI:        `brew install klytics/aegis/aegis` (Go binary)',
      '',
      '## Security',
      `- Disclosure: security@aegislabs.io`,
      `- security.txt: ${issuer}/.well-known/security.txt`,
      '',
      '## Architecture',
      '- Audit chain: append-only, Ed25519-signed, hash-linked. Public key at JWKS URI above.',
      '- Denial precedence: AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED → POLICY_EXPIRED → SCOPE_NOT_GRANTED → SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED.',
      '- Verify hot path is portable to Cloudflare Workers / Edge runtimes (zero NestJS imports in the algorithm).',
      '',
    ].join('\n');
  }

  /**
   * AEGIS configuration discovery document. The single JSON URL a relying
   * party fetches to auto-configure their verifier — modeled on
   * `/.well-known/openid-configuration`.
   */
  getAegisConfiguration(): AegisConfigurationDto {
    const base = trimSlash(this.config.apiBaseUrl ?? ISSUER);
    const v = (path: string): string => `${base}/v1${path}`;
    const wk = (path: string): string => `${base}/.well-known/${path}`;

    const pkg =
      (pkgJson as { default?: { version?: string }; version?: string })
        .default ?? (pkgJson as { version?: string });

    return {
      issuer: base,
      spec_version: DISCOVERY_SPEC_VERSION,
      api_version: pkg.version ?? '0.0.0',
      documentation: 'https://docs.aegislabs.io',
      openapi_spec: `${base}/docs-json`,
      jwks_uri: wk('jwks.json'),
      audit_signing_key_uri: wk('audit-signing-key'),
      endpoints: {
        verify: v('/verify'),
        agent_register: v('/agents/register'),
        agent_status: v('/agents/{agentId}/status'),
        policy_create: v('/agents/{agentId}/policies'),
        audit_export_per_agent: v('/agents/{agentId}/audit/export.ndjson'),
        audit_export_tenant: v('/audit-events/export'),
        webhook_subscribe: v('/webhooks'),
        billing_checkout: v('/billing/checkout'),
        billing_webhook: v('/billing/webhook'),
        health_live: `${base}/health/live`,
        health_ready: `${base}/health/ready`,
        health_version: `${base}/health/version`,
      },
      supported_algorithms: ['EdDSA'],
      supported_curves: ['Ed25519'],
      denial_reasons: [
        'AGENT_NOT_FOUND',
        'AGENT_REVOKED',
        'INVALID_SIGNATURE',
        'POLICY_REVOKED',
        'POLICY_EXPIRED',
        'SCOPE_NOT_GRANTED',
        'SPEND_LIMIT_EXCEEDED',
        'TRUST_SCORE_TOO_LOW',
        'ANOMALY_FLAGGED',
      ],
      trust_bands: ['FLAGGED', 'WATCH', 'VERIFIED', 'PLATINUM'],
      rate_limits: {
        verify_per_min: 1000,
        default_per_min: 120,
      },
      supported_runtimes: [
        'nodejs',
        'cloudflare-workers',
        'vercel-edge',
        'deno',
        'bun',
        'browser',
      ],
      sdks: {
        typescript: '@aegis/sdk',
        python: 'aegis',
        verifier_rp: '@aegis/verifier-rp',
        mcp_bridge: '@aegis/mcp-bridge',
        mcp_server: '@aegis/mcp-server',
        cli: 'aegis (go)',
      },
      build: {
        version: pkg.version ?? '0.0.0',
        git_sha: process.env.GIT_SHA ?? 'dev',
        built_at: process.env.BUILD_AT ?? 'dev',
      },
      security_txt: wk('security.txt'),
      llms_txt: wk('llms.txt'),
      retention_policy_uri: wk('retention-policy.json'),
      pricing_uri: wk('pricing.json'),

      // FAPI-2.0-aligned metadata (additive, 1.1.0). See top-of-file
      // FAPI_PROFILE_* + STANDARDS_* constants for the binding contract.
      fapi_profile: FAPI_PROFILE_ID,
      fapi_profile_spec_uri: FAPI_PROFILE_DOC_URL,
      standards_implemented: [...STANDARDS_IMPLEMENTED],
      standards_aligned: [...STANDARDS_ALIGNED],
      signing_alg_values_supported: ['EdDSA'],
      agent_signing_alg_values_supported: ['EdDSA'],
      agent_authentication_methods_supported: [...AGENT_AUTH_METHODS],
      authorization_details_types_supported: [...AUTHORIZATION_DETAILS_TYPES_SUPPORTED],
      op_policy_uri: process.env.AEGIS_OP_POLICY_URI || undefined,
      op_tos_uri: process.env.AEGIS_OP_TOS_URI || undefined,
    };
  }

  /**
   * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
   *
   * Published at /.well-known/oauth-authorization-server with the HONEST
   * subset of RFC 8414 fields for AEGIS's role (authorization-decision-
   * and-audit-layer, NOT a full OAuth AS issuing authorization codes or
   * access tokens). Fields whose flow AEGIS doesn't implement are empty
   * arrays per RFC 8414 §2 ("an empty array means the AS does not
   * support that feature") — this is the lying-by-omission alternative
   * to publishing fake endpoints.
   *
   * AEGIS-specific extensions are namespaced `aegis_*` per RFC 8414 §2.4
   * (additional metadata parameters) so a strict RFC 8414 parser ignores
   * them without breaking.
   *
   * Cross-reference: docs/spec/05_FAPI_2_0_PROFILE.md §2 RFC-8414 row.
   */
  getOAuthAuthorizationServerMetadata(): OAuthAuthorizationServerMetadataDto {
    const base = trimSlash(this.config.apiBaseUrl ?? ISSUER);
    const v = (path: string): string => `${base}/v1${path}`;
    const wk = (path: string): string => `${base}/.well-known/${path}`;
    return {
      issuer: base,
      // AEGIS does not issue OAuth authorization codes or implicit tokens.
      // Empty array per RFC 8414 §2 is the honest signal.
      response_types_supported: [],
      jwks_uri: wk('jwks.json'),
      introspection_endpoint: v('/verify'),
      introspection_endpoint_auth_methods_supported: ['api_key_bearer'],
      // AEGIS uses API keys for relying-party auth, not signed JWTs.
      introspection_endpoint_auth_signing_alg_values_supported: [],
      // AEGIS does not issue OAuth tokens — token_endpoint is absent
      // and the auth methods array is empty for the same reason.
      token_endpoint_auth_methods_supported: [],
      // Signing algs for AEGIS-emitted JWS (audit events, signed receipts).
      token_endpoint_auth_signing_alg_values_supported: ['EdDSA'],
      service_documentation: 'https://docs.aegislabs.io',
      op_policy_uri: process.env.AEGIS_OP_POLICY_URI || undefined,
      op_tos_uri: process.env.AEGIS_OP_TOS_URI || undefined,
      // FAPI 2.0 §6.1 — mirrors aegis-configuration. Single source of
      // truth is AUTHORIZATION_DETAILS_TYPES_SUPPORTED.
      authorization_details_types_supported: [...AUTHORIZATION_DETAILS_TYPES_SUPPORTED],
      request_object_signing_alg_values_supported: ['EdDSA'],
      // AEGIS-specific (RFC 8414 §2.4 namespaced).
      aegis_service_type: 'authorization-decision-and-audit-layer',
      aegis_rar_evaluate_endpoint: v('/verify/rar/evaluate'),
      aegis_configuration_uri: wk('aegis-configuration'),
      aegis_fapi_profile: FAPI_PROFILE_ID,
    };
  }

  /**
   * Public per-tier pricing table. Auto-derived from
   * `apps/api/src/modules/billing/plans.ts` — never duplicated, never
   * fabricated. `Number.POSITIVE_INFINITY` sentinels in plans.ts are
   * encoded as JSON `null` (no native Infinity in JSON). FREE's
   * lifetime cap mirrors `TRIAL_LIFETIME_CAP`.
   *
   * Pure, in-process, zero DB hits. Safe to cache for an hour at the
   * edge; a tier-table change in plans.ts requires a deploy anyway.
   */
  getPricing(now: Date = new Date()): PricingDto {
    const tiers: Record<string, PricingTierDto> = {};
    for (const tier of Object.keys(PLANS) as PlanTier[]) {
      const plan = getPlan(tier);
      tiers[tier] = {
        tier: plan.tier,
        display_name: plan.displayName,
        monthly_price_cents: plan.monthlyPriceCents,
        monthly_verify_quota: Number.isFinite(plan.monthlyVerifyQuota)
          ? plan.monthlyVerifyQuota
          : null,
        // ADR-0014: lifetime cap applies only to FREE.
        lifetime_verify_quota: tier === 'FREE' ? TRIAL_LIFETIME_CAP : null,
        overage_per_call_e4: plan.overagePerCallE4,
        agent_cap: Number.isFinite(plan.agentCap) ? plan.agentCap : null,
        audit_retention_days: plan.auditRetentionDays,
        bate_access: plan.bateAccess,
        webhooks: plan.webhooks,
        verify_p99_target_ms: plan.verifyP99TargetMs,
      };
    }

    return {
      spec_version: PRICING_SPEC_VERSION,
      generated_at: now.toISOString(),
      currency: PRICING_CURRENCY,
      tiers,
      currency_overage_unit: PRICING_OVERAGE_UNIT,
      adr: PRICING_ADR,
      billing_endpoints: {
        checkout: '/v1/billing/checkout',
        portal: '/v1/billing/portal',
        plan: '/v1/billing/plan',
      },
    };
  }

  /**
   * Public per-tier audit retention policy. Auto-derived from
   * `apps/api/src/modules/billing/plans.ts` — never duplicated, never
   * fabricated. Boot-time validation in `onModuleInit` guarantees every
   * tier has a positive `auditRetentionDays`, so this method cannot
   * emit a synthetic default.
   *
   * Pure, in-process, zero DB hits. Safe to cache for an hour at the
   * edge; a tier change in plans.ts requires a deploy anyway.
   */
  getRetentionPolicy(now: Date = new Date()): RetentionPolicyDto {
    const tiers: Record<string, RetentionPolicyTierDto> = {};
    for (const tier of Object.keys(PLANS) as PlanTier[]) {
      const plan = getPlan(tier);
      tiers[tier] = {
        audit_retention_days: plan.auditRetentionDays,
        redaction_method: RETENTION_REDACTION_METHOD,
        redaction_reason_format: `retention_policy:plan=${tier}:days=${plan.auditRetentionDays}`,
      };
    }

    return {
      spec_version: RETENTION_POLICY_SPEC_VERSION,
      generated_at: now.toISOString(),
      tiers,
      // Spread to defeat the readonly array — DTO contract is mutable string[].
      guarantees: [...RETENTION_GUARANTEES],
      operational: {
        retention_run_interval_seconds: RETENTION_RUN_INTERVAL_SECONDS,
        configurable_via_env: RETENTION_INTERVAL_ENV_VAR,
      },
    };
  }
}

/** Trim a trailing slash if present. Helps build canonical URLs deterministically. */
export function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** ISO 8601 timestamp exactly 365 days from now (RFC 9116 § 2.5.5 `Expires`). */
export function oneYearFromNow(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
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
