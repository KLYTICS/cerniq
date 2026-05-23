import { createHash } from 'node:crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { PlanTier } from '@prisma/client';

import * as pkgJson from '../../../package.json';
import { decodeBase64Url, encodeBase64Url } from '../../common/crypto/ed25519.util';
import { AppConfigService } from '../../config/config.service';
import { PLANS, TRIAL_LIFETIME_CAP, getPlan } from '../billing/plans';

import type { CerniqConfigurationDto } from './dto/discovery.dto';
import type { AuditSigningKeyDto, JwkEd25519Dto, JwksDto } from './dto/jwks.dto';
import type { PricingDto, PricingTierDto } from './dto/pricing.dto';
import type { RetentionPolicyDto, RetentionPolicyTierDto } from './dto/retention-policy.dto';

// type-rationale: package.json is a static JSON resource and tsconfig has
// resolveJsonModule=true. Importing once at module load avoids fs reads
// per request.

/** Spec-doc schema version. Bump on breaking change to CerniqConfigurationDto shape. */
const DISCOVERY_SPEC_VERSION = '1.0.0';
/** Spec-doc schema version for retention-policy.json. Independent from DISCOVERY_SPEC_VERSION. */
const RETENTION_POLICY_SPEC_VERSION = '1.0.0';
/** Spec-doc schema version for pricing.json. Independent from DISCOVERY_SPEC_VERSION. */
const PRICING_SPEC_VERSION = '1.0.0';
/** Hardcoded for now; future spec_version may switch on operator-set locale env. */
const PRICING_CURRENCY = 'USD';
const PRICING_OVERAGE_UNIT = 'USD × 10⁻⁴ (i.e. ten-thousandths of a dollar)';
const PRICING_ADR = 'ADR-0014';
const ISSUER = 'https://cerniqapp.com';
const VERIFICATION_GUIDE = 'https://docs.cerniqapp.com/audit/verify';
const ED25519_PUBKEY_LEN = 32;
/**
 * Mirror of `DEFAULT_RETENTION_RUN_INTERVAL_MS` in
 * `compliance/audit-retention.service.ts` (24h, in seconds for the
 * public discovery body). Kept in sync by `retention-policy.parity`
 * spec — drift fails the build.
 */
const RETENTION_RUN_INTERVAL_SECONDS = 86_400;
const RETENTION_INTERVAL_ENV_VAR = 'CERNIQ_AUDIT_RETENTION_INTERVAL_MS';
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
 * Publishes CERNIQ's audit-event-signing public key.
 *
 * CLAUDE.md invariants:
 * - #3 (audit chain): the published key is what relying parties use to verify
 *   the chain signature on every AuditEvent.
 * - #4 (no silent failures, no fabricated data): we throw at boot if the
 *   signing key is unset, and we mark the rotation timestamp DEGRADED if
 *   CERNIQ_SIGNING_KEY_ROTATED_AT is missing rather than fabricate it
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
    const raw = this.config.cerniqSigningPublicKey;
    if (!raw || raw.length === 0) {
      throw new Error(
        'CERNIQ_SIGNING_PUBLIC_KEY env var must be set; generate with `pnpm --filter @cerniq/scripts run keys`',
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = decodeBase64Url(raw);
    } catch (err) {
      throw new Error(
        `CERNIQ_SIGNING_PUBLIC_KEY is not valid base64url: ${(err as Error).message}`,
      );
    }

    if (bytes.length !== ED25519_PUBKEY_LEN) {
      throw new Error(
        `CERNIQ_SIGNING_PUBLIC_KEY decoded to ${bytes.length} bytes; expected ${ED25519_PUBKEY_LEN} (raw Ed25519).`,
      );
    }

    // Normalise to a canonical base64url form (in case the source had padding).
    this.publicKeyB64Url = encodeBase64Url(bytes);
    this.kid = computeKid(bytes);

    const rotatedAtEnv = this.config.cerniqSigningKeyRotatedAt;
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
        'CERNIQ_SIGNING_KEY_ROTATED_AT not set — using process-start timestamp. ' +
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
   * can override via env (`CERNIQ_SECURITY_CONTACT`, etc.) once that lands.
   *
   * Expires 1 year from the deploy build time so we can't accidentally
   * publish stale contact info — RFC 9116 § 2.5.5 mandates `Expires`.
   */
  getSecurityTxt(): string {
    const issuer = this.config.apiBaseUrl ?? ISSUER;
    const expires = oneYearFromNow();
    const lines = [
      '# CERNIQ — security disclosure (RFC 9116)',
      `Contact: mailto:security@cerniqapp.com`,
      `Expires: ${expires}`,
      `Preferred-Languages: en`,
      `Canonical: ${trimSlash(issuer)}/.well-known/security.txt`,
      `Policy: https://cerniqapp.com/security/policy`,
      `Acknowledgments: https://cerniqapp.com/security/hall-of-fame`,
      `# Hash of CLAUDE.md operating directive at this build:`,
      `# (informational — not part of the RFC)`,
    ];
    return lines.join('\n') + '\n';
  }

  /**
   * llms.txt — emerging convention (parallel to robots.txt) for
   * AI-agent-readable site descriptions. Markdown body lists the public
   * surfaces an agent should hit when it wants to talk to CERNIQ.
   *
   * CERNIQ is the agent identity layer, so this file is doubly relevant —
   * agents that integrate with CERNIQ can self-discover the wire format.
   */
  getLlmsTxt(): string {
    const issuer = trimSlash(this.config.apiBaseUrl ?? ISSUER);
    return [
      '# CERNIQ — Agent Gateway & Identity Stack',
      '',
      '> Cryptographic identity, scoped policy, and behavioral attestation rail',
      '> for AI agents. ACP-compatible. Platform-, vendor-, and model-neutral.',
      '',
      '## Discovery',
      `- [Configuration (JSON)](${issuer}/.well-known/cerniq-configuration)`,
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
      'Headers: X-CERNIQ-Verify-Key: <verify-only key>',
      'Body:    { token, action, amount?, currency?, merchantDomain? }',
      'Returns: { valid, agentId, trustScore, trustBand, denialReason?, auditEventId, ttl, verifiedAt }',
      '```',
      '',
      '## SDKs',
      '- TypeScript: `npm install @cerniq/sdk`',
      '- Python:     `pip install cerniq`',
      '- Relying-party verifier (offline JWKS): `npm install @cerniq/verifier-rp`',
      '- MCP bridge (one-line wrap any MCP server): `npm install @cerniq/mcp-bridge`',
      '- MCP server (Claude Desktop / Cursor): `npx @cerniq/mcp-server`',
      '- CLI:        `brew install klytics/cerniq/cerniq` (Go binary)',
      '',
      '## Security',
      `- Disclosure: security@cerniqapp.com`,
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
   * CERNIQ configuration discovery document. The single JSON URL a relying
   * party fetches to auto-configure their verifier — modeled on
   * `/.well-known/openid-configuration`.
   */
  getCerniqConfiguration(): CerniqConfigurationDto {
    const base = trimSlash(this.config.apiBaseUrl ?? ISSUER);
    const v = (path: string): string => `${base}/v1${path}`;
    const wk = (path: string): string => `${base}/.well-known/${path}`;

    const pkg =
      (pkgJson as { default?: { version?: string }; version?: string }).default ?? pkgJson;

    return {
      issuer: base,
      spec_version: DISCOVERY_SPEC_VERSION,
      api_version: pkg.version ?? '0.0.0',
      documentation: 'https://docs.cerniqapp.com',
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
      supported_runtimes: ['nodejs', 'cloudflare-workers', 'vercel-edge', 'deno', 'bun', 'browser'],
      sdks: {
        typescript: '@cerniq/sdk',
        python: 'cerniq',
        verifier_rp: '@cerniq/verifier-rp',
        mcp_bridge: '@cerniq/mcp-bridge',
        mcp_server: '@cerniq/mcp-server',
        cli: 'cerniq (go)',
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
