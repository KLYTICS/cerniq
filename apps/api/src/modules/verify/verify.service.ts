import { Injectable, Logger } from '@nestjs/common';
import type { TrustBand } from '@prisma/client';

import { JwtUtil } from '../../common/crypto/jwt.util';
import { MetricsService } from '../../common/observability/metrics.service';
import { withSpan } from '../../common/observability/spans';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { BateService } from '../bate/bate.service';
import { TrialService } from '../billing/trial.service';
import { UsageGuardService } from '../billing/usage-guard.service';
import type { PolicyScopeDto } from '../policy/policy.dto';

import { verifyAlgorithm } from './algorithm/verify.algorithm';
import { oauthErrorFor } from './oauth-error-mapping';
import type {
  AgentSnapshot,
  AuditAppendInput,
  BateSignalInput,
  PolicySnapshot,
  VerifyPorts,
} from './algorithm/verify.ports';
import { ReplayCacheService } from './replay-cache.service';
import { SpendGuardService } from './spend-guard.service';
import { type VerifyRequestDto, type VerifyResponseDto } from './verify.dto';



interface CachedAgent {
  id: string;
  publicKey: string;
  status: string;
  trustScore: number;
  trustBand: TrustBand;
  principalId: string;
  flagged?: boolean;
}

interface CachedPolicy {
  id: string;
  status: string;
  expiresAt: string; // ISO
  scopes: PolicyScopeDto[];
}

/**
 * Nest adapter for the pure `/v1/verify` algorithm.
 *
 * The actual decision logic lives in `algorithm/verify.algorithm.ts` and
 * is framework-free so the Cloudflare Worker (Phase 3) can import it
 * unchanged. This class implements the `VerifyPorts` contract using
 * Prisma + Redis + the AEGIS audit/BATE/spend services.
 *
 * Gate order (outer to inner):
 *   G-2: UsageGuardService — plan-tier monthly quota (billing gate, fails-open)
 *   Algorithm: verifyAlgorithm — 9-step denial precedence (security gate, fails-closed)
 *
 * Failure modes:
 *   - Cache miss → single Postgres query (≈ 1–10 ms RTT).
 *   - Redis outage → spend port THROWS `ServiceUnavailableError`; replay
 *     port THROWS too. The algorithm catches replay outage as
 *     `ANOMALY_FLAGGED` (fail-closed); spend outage propagates.
 *   - Postgres outage → /health/ready degraded.
 */
@Injectable()
export class VerifyService {
  private readonly logger = new Logger(VerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtUtil,
    private readonly bate: BateService,
    private readonly spendGuard: SpendGuardService,
    private readonly replayCache: ReplayCacheService,
    private readonly usageGuard: UsageGuardService,
    private readonly trial: TrialService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Run the verify algorithm with the calling relying party's principal in
   * scope so denial-audit rows can be attributed correctly (no `'unknown'`
   * fabrication). Caller (controller) extracts `principalId` from the
   * verify-only API key auth context and passes it here.
   *
   * G-2: Monthly plan quota is checked BEFORE the algorithm. A
   * `PLAN_LIMIT_EXCEEDED` denial short-circuits without touching the algorithm
   * or the audit chain — it is a billing gate, not a security gate.
   */
  async verify(dto: VerifyRequestDto, relyingPartyPrincipalId: string): Promise<VerifyResponseDto> {
    // ── G-2: Plan-tier quota gate ────────────────────────────────────────────
    // UsageGuardService fails-open on Redis/DB errors (billing gate, not
    // security). If quota is exhausted on a paid hard-stop plan, return
    // PLAN_LIMIT_EXCEEDED immediately — no algorithm, no audit event.
    // Round-20 cleanup: FREE tier no longer triggers this gate; FREE is
    // delegated to TrialService per Round-19 F-08 (FREE.monthlyVerifyQuota
    // is Number.POSITIVE_INFINITY so checkQuota always returns allowed=true
    // for FREE). The gate remains load-bearing for DEVELOPER/GROWTH/ENTERPRISE
    // overage and hard-stop semantics.
    const quota = await this.usageGuard.checkQuota(relyingPartyPrincipalId);
    if (!quota.allowed) {
      this.logger.warn(
        `verify DENIED=PLAN_LIMIT_EXCEEDED principal=${relyingPartyPrincipalId} ` +
        `plan=${quota.planTier} quota=${quota.monthlyQuota}`,
      );
      this.metrics.verifyTotal.inc({ decision: 'DENIED', denial_reason: 'PLAN_LIMIT_EXCEEDED' });
      const oauth = oauthErrorFor('PLAN_LIMIT_EXCEEDED');
      return {
        valid: false,
        agentId: null,
        principalId: relyingPartyPrincipalId,
        trustScore: 0,
        trustBand: null,
        scopesGranted: [],
        denialReason: 'PLAN_LIMIT_EXCEEDED',
        verifiedAt: new Date().toISOString(),
        ttl: 0,
        auditEventId: null,
        error: oauth.error,
        error_description: oauth.error_description,
        denialContext: { kind: 'plan_limit_exceeded' },
      };
    }
    // ── End G-2 quota gate ────────────────────────────────────────────────────

    // ── G-2b: Free-trial lifetime cap (ADR-0014) ─────────────────────────────
    // Fires AFTER the monthly PLAN_LIMIT_EXCEEDED check (so a paid principal
    // who downgraded still hits PLAN_LIMIT_EXCEEDED first if applicable) and
    // BEFORE the algorithm. TrialService fails-CLOSED — see service comment.
    // The verify endpoint always returns 200 with `valid:false` + denialReason,
    // so we shape the response inline rather than throwing TrialExhaustedError.
    const trial = await this.trial.checkAndIncrement(relyingPartyPrincipalId);
    if (trial.exhausted) {
      this.logger.warn(
        `verify DENIED=TRIAL_EXHAUSTED principal=${relyingPartyPrincipalId} reason=${trial.reason}`,
      );
      this.metrics.verifyTotal.inc({ decision: 'DENIED', denial_reason: 'TRIAL_EXHAUSTED' });
      const oauth = oauthErrorFor('TRIAL_EXHAUSTED');
      return {
        valid: false,
        agentId: null,
        principalId: relyingPartyPrincipalId,
        trustScore: 0,
        trustBand: null,
        scopesGranted: [],
        denialReason: 'TRIAL_EXHAUSTED',
        verifiedAt: new Date().toISOString(),
        ttl: 0,
        auditEventId: null,
        error: oauth.error,
        error_description: oauth.error_description,
        denialContext: { kind: 'trial_exhausted' },
      };
    }
    // ── End G-2b trial gate ──────────────────────────────────────────────────

    const ports: VerifyPorts = {
      now: () => new Date(),
      getAgent: (agentId) => this.loadAgent(agentId),
      getPolicy: (policyId) => this.loadPolicy(policyId),
      verifyJwt: (token, pub) => this.jwt.verifyAndDecode(token, pub),
      decodeJwtUnsafe: (token) => this.jwt.decodeUnsafe(token),
      consumeJti: (jti, ttl) => this.replayCache.consume(jti, ttl),
      checkSpend: async (agentId, policyId, amount, currency, limit) => {
        const result = await this.spendGuard.check(agentId, policyId, amount, currency, limit);
        return result.allowed;
      },
      recordSpend: (agentId, policyId, amount, currency, ctx) => {
        void this.spendGuard
          .recordSpend(agentId, policyId, amount, currency, ctx.merchantId, ctx.merchantDomain)
          .catch((err) => {
            this.logger.error(`recordSpend failed: ${(err as Error).message}`);
          });
      },
      recordAudit: async (event: AuditAppendInput) => {
        // Awaited (not fire-and-forget): the algorithm needs the
        // auditEventId to thread back into the response. AuditService
        // throws on durable failure — caught by algorithm to set
        // auditEventId=null while still surfacing the decision.
        return await this.audit.append(event);
      },
      ingestSignal: (signal: BateSignalInput) => {
        void this.bate
          .ingestSignal(signal)
          .catch((err) => { this.logger.error(`bate.ingestSignal failed: ${(err as Error).message}`); });
      },
      touchAgent: (agentId) => {
        void this.touchAgent(agentId).catch((err) => {
          // Best-effort write — but we must NOT swallow silently
          // (CLAUDE.md invariant #4 + audit T-5). Persistent failures
          // surface as `lastSeenAt` going stale on the dashboard plus
          // an elevated `aegis_cache_set_failed_total{op="touch_agent"}`.
          this.logger.warn(`touchAgent failed agent=${agentId}: ${(err as Error).message}`);
          this.metrics.cacheSetFailedTotal.inc({ op: 'touch_agent' });
        });
      },
      featureFlags: { bateEnabled: this.config.enableBate },

      // RFC 9101 (JAR) audience binding — port returns the configured
      // issuer URL. Algorithm Step 3.4 fires INVALID_SIGNATURE when a
      // token's `aud` claim mismatches. Returning undefined (env unset)
      // disables the gate for backward compat — operator opts in by
      // configuring AEGIS_API_BASE_URL / AEGIS_ISSUER in production.
      expectedAudience: () => {
        const url = this.config.apiBaseUrl;
        if (!url) return undefined;
        // Trim trailing slash so 'https://x/' and 'https://x' match a
        // canonical `aud` claim. Cheap normalization at the boundary.
        return url.endsWith('/') ? url.slice(0, -1) : url;
      },

      // RFC 9101 (JAR) max-iat-age binding — Step 3.6 rejects tokens
      // whose `iat` is older than this many seconds. Operator opts in
      // via AEGIS_MAX_TOKEN_AGE_SECONDS; undefined disables the gate.
      maxTokenAgeSeconds: () => this.config.maxTokenAgeSeconds,

      // RFC 9101 §4 iss-vs-sub consistency — Step 3.5 rejects tokens
      // with `iss !== sub` when present. Operator opts in via
      // AEGIS_STRICT_JAR_ISS=true; false disables the gate.
      requireIssMatchesSub: () => this.config.strictJarIss,
    };

    // Manual span — auto-instrumentation already covers the HTTP and DB
    // layer; this span isolates the pure algorithm so latency can be
    // attributed independently of port I/O. The algorithm itself remains
    // framework-free (CLAUDE.md invariant #2): the span lives in the
    // SERVICE adapter, not in the algorithm import path.
    //
    // Span attrs are filled from the algorithm result via setActiveSpanAttributes
    // below — DTO doesn't carry agent.id/policy.id (they're inside the token).
    const result = await withSpan(
      'aegis.verify.algorithm',
      // type-rationale: VerifyRequestDto is a NestJS DTO class; spreading it
      // intentionally converts to a plain object that the algorithm consumes.
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      () => verifyAlgorithm({ ...dto, relyingPartyPrincipalId }, ports),
      {
        'principal.id': relyingPartyPrincipalId,
        'aegis.feature.bate': this.config.enableBate,
        'aegis.verify.action': dto.action,
      },
    );

    // G-2: Increment the monthly counter after an approved result only.
    // Fire-and-forget — a missed increment means a slight under-count which
    // self-corrects on the next Redis miss via the AuditEvent DB backfill.
    // Denied calls do NOT consume quota (relying parties get a free retry
    // after fixing signature / policy issues).
    if (result.valid) {
      this.usageGuard.incrementUsage(relyingPartyPrincipalId);
    }

    this.logger.debug(
      `verify ${result.valid ? 'approved' : `denied=${result.denialReason ?? 'unknown'}`} agent=${result.agentId ?? 'n/a'} latency=${result.latencyMs}ms`,
    );

    const decision = result.valid ? 'APPROVED' : 'DENIED';
    this.metrics.verifyLatency.observe({ decision }, result.latencyMs / 1000);
    this.metrics.verifyTotal.inc({ decision, denial_reason: result.denialReason ?? 'none' });

    // Round-10 — emit structured log enriched with specifics. The
    // algorithm intentionally carries only the discriminator kind to
    // keep operator config out of buyer-visible responses; the service
    // adapter reconstructs the specifics from input + config for
    // operator-side debugging. This is the one place where the
    // "specifics-stay-internal" policy is realized.
    //
    // Specifics are reconstructed only for kinds where they exist; the
    // log line stays useful for kinds without specifics (agent_revoked,
    // anomaly_flagged, etc.) because the discriminator itself names
    // the gate.
    if (result.denialContext) {
      const kind = result.denialContext.kind;
      const specifics = this.reconstructDenialSpecifics(kind, dto, result.agentId);
      this.logger.warn(
        `verify DENIED reason=${result.denialReason} kind=${kind} ` +
        `agent=${result.agentId ?? 'n/a'} rp=${relyingPartyPrincipalId}` +
        (specifics ? ` ${specifics}` : ''),
      );
    }

    // RFC 6749 §5.2 — populate canonical error envelope iff denied.
    // The algorithm result is the source of truth; this is a pure
    // additive translation through the closed mapping table.
    const oauth = result.denialReason
      ? oauthErrorFor(result.denialReason)
      : null;

    return {
      valid: result.valid,
      agentId: result.agentId,
      principalId: result.principalId,
      trustScore: result.trustScore,
      trustBand: result.trustBand,
      scopesGranted: result.scopesGranted,
      denialReason: result.denialReason,
      verifiedAt: result.verifiedAt,
      ttl: result.ttl,
      auditEventId: result.auditEventId,
      error: oauth?.error ?? null,
      error_description: oauth?.error_description ?? null,
      denialContext: result.denialContext,
    };
  }

  /**
   * Reconstruct human-readable specifics for a denial-context kind to
   * enrich the structured log line. Kept in the service adapter — NOT
   * in the algorithm — so the algorithm stays framework-free and the
   * specifics never leak into the buyer-visible response. Returns null
   * when the kind has no useful specifics beyond what the discriminator
   * already names.
   *
   * Inputs that might be tenant-sensitive (the JWT itself) are decoded
   * here without verification because the discriminator already tells
   * us the verify step that failed — re-decoding can't make the failure
   * worse. Decode failures are non-fatal.
   */
  private reconstructDenialSpecifics(
    kind: string,
    dto: VerifyRequestDto,
    agentId: string | null,
  ): string | null {
    switch (kind) {
      case 'jar_aud_mismatch': {
        const expected = this.config.apiBaseUrl;
        const claims = this.jwt.decodeUnsafe(dto.token);
        const got = claims?.aud ?? '<missing>';
        return `expected_aud=${expected ?? '<unset>'} got_aud=${got}`;
      }
      case 'jar_iss_sub_mismatch': {
        const claims = this.jwt.decodeUnsafe(dto.token);
        return `sub=${claims?.sub ?? '<unknown>'} iss=${claims?.iss ?? '<missing>'}`;
      }
      case 'jar_iat_stale': {
        const claims = this.jwt.decodeUnsafe(dto.token);
        const maxAge = this.config.maxTokenAgeSeconds;
        if (claims && typeof claims.iat === 'number') {
          const ageSec = Math.floor(Date.now() / 1000) - claims.iat;
          return `iat_age_seconds=${ageSec} max_age_seconds=${maxAge ?? '<unset>'}`;
        }
        return `max_age_seconds=${maxAge ?? '<unset>'}`;
      }
      case 'replay_consumed': {
        const claims = this.jwt.decodeUnsafe(dto.token);
        return `jti=${claims?.jti ?? '<unknown>'}`;
      }
      case 'scope_category_not_granted':
      case 'scope_domain_not_allowed':
        return `action=${dto.action ?? '<none>'} domain=${dto.merchantDomain ?? '<none>'}`;
      case 'spend_limit_exceeded':
        return `amount=${dto.amount ?? '<none>'} currency=${dto.currency ?? '<none>'}`;
      case 'rar_action_unauthorized':
      case 'rar_limit_exceeded':
      case 'rar_outside_trading_hours':
      case 'rar_instrument_not_whitelisted':
      case 'rar_destination_not_whitelisted':
      case 'rar_resource_not_whitelisted':
      case 'rar_type_unauthorized':
      case 'rar_currency_unauthorized':
      case 'rar_pii_disallowed':
        return `action=${dto.action ?? '<none>'} amount=${dto.amount ?? '<none>'} merchant=${dto.merchantId ?? '<none>'}`;
      case 'agent_unknown':
      case 'agent_revoked':
      case 'agent_suspended':
        return `claimed_agent=${agentId ?? '<unparseable>'}`;
      default:
        // Kinds where the discriminator alone is sufficient (signature_invalid,
        // anomaly_flagged, token_malformed, plan_limit_exceeded, etc.).
        return null;
    }
  }

  private async loadAgent(agentId: string): Promise<AgentSnapshot | null> {
    const cacheKey = `agent:status:${agentId}`;
    const cached = await this.redis.get<CachedAgent>(cacheKey);
    if (cached) return this.toSnapshot(cached);

    const agent = await this.prisma.agentIdentity.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        publicKey: true,
        status: true,
        trustScore: true,
        trustBand: true,
        principalId: true,
      },
    });
    if (!agent) return null;

    const value: CachedAgent = {
      id: agent.id,
      publicKey: agent.publicKey,
      status: agent.status,
      trustScore: agent.trustScore,
      trustBand: agent.trustBand,
      principalId: agent.principalId,
    };
    // Cache miss → durable read succeeded → cache set is best-effort but
    // must be observable (H-3 fix). Failures bump
    // `aegis_cache_set_failed_total{op="agent"}` so a Redis flap is alarm-able
    // before it cascades into Postgres saturation.
    await this.redis.set(cacheKey, value, 60).catch((err) => {
      this.logger.warn(`agent cache set failed agent=${agentId}: ${(err as Error).message}`);
      this.metrics.cacheSetFailedTotal.inc({ op: 'agent' });
    });
    return this.toSnapshot(value);
  }

  private toSnapshot(c: CachedAgent): AgentSnapshot {
    return {
      id: c.id,
      publicKey: c.publicKey,
      status: c.status as AgentSnapshot['status'],
      trustScore: c.trustScore,
      trustBand: c.trustBand,
      principalId: c.principalId,
      flagged: c.flagged ?? false,
    };
  }

  private async loadPolicy(policyId: string): Promise<PolicySnapshot | null> {
    const cacheKey = `policy:${policyId}`;
    const cached = await this.redis.get<CachedPolicy>(cacheKey);
    if (cached) return cached as PolicySnapshot;

    const policy = await this.prisma.agentPolicy.findUnique({
      where: { id: policyId },
      select: { id: true, status: true, expiresAt: true, scopes: true },
    });
    if (!policy) return null;

    const value: PolicySnapshot = {
      id: policy.id,
      status: policy.status,
      expiresAt: policy.expiresAt.toISOString(),
      scopes: policy.scopes as unknown as PolicySnapshot['scopes'],
    };
    const ttl = Math.min(30, Math.max(0, Math.floor((policy.expiresAt.getTime() - Date.now()) / 1000)));
    if (ttl > 0) {
      await this.redis.set(cacheKey, value, ttl).catch((err) => {
        this.logger.warn(`policy cache set failed policy=${policyId}: ${(err as Error).message}`);
        this.metrics.cacheSetFailedTotal.inc({ op: 'policy' });
      });
    }
    return value;
  }

  private async touchAgent(agentId: string): Promise<void> {
    const seenKey = `agent:lastseen:${agentId}`;
    const recentlyTouched = await this.redis.get<number>(seenKey);
    if (recentlyTouched && Date.now() - recentlyTouched < 30_000) return;
    await this.redis.set(seenKey, Date.now(), 60);
    await this.prisma.agentIdentity.update({
      where: { id: agentId },
      data: { lastSeenAt: new Date(), verifyCount: { increment: 1 }, verifyCountDay: { increment: 1 } },
    });
  }
}
