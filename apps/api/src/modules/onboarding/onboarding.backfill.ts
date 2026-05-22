// OnboardingBackfill — periodic idempotent reconciler that flips
// onboarding steps based on the existence of related entities.
//
// Why a backfill rather than per-action hooks:
//   1. Zero edits to existing service files (Identity, Policy, Verify,
//      KMS, MCP, Webhooks). The hot path stays untouched.
//   2. Idempotent by construction. Re-runs always converge to the same
//      state. No risk of double-counting or partial writes.
//   3. Self-healing: if an event is dropped (outbox crash, webhook
//      delivery failure, etc.), the next backfill cycle catches it.
//
// Trade-off: onboarding state lags the canonical event by up to one
// `intervalSeconds`. Acceptable for an activation-funnel signal.
//
// Per-step rules (kept in lockstep with onboarding.service.ts):
//   hasFirstAgent          ← agentIdentity row exists for principal
//   hasFirstPolicy         ← agentPolicy row exists for any of the principal's agents
//   hasFirstVerify         ← auditEvent row with action LIKE '%verify%' exists
//   hasMcpServerRegistered ← relyingParty row with kind='MCP_SERVER' exists
//   hasWebhookSubscribed   ← webhookSubscription row exists
//   (hasKmsConfigured + hasPaymentMethodAdded — driven by the M-037 KMS
//    audit-routing + Stripe billing modules respectively; backfill-able
//    from the same pattern when those land)
//
// This module is wired in OnboardingModule's providers list and uses
// `@nestjs/schedule` Cron decorators when available; otherwise the
// operator triggers it via `okoro-cli onboarding backfill` (M-027).

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

// `@nestjs/schedule` is an optional dep — when absent (e.g., in unit
// tests with a stripped bundle) the @Cron decorator is a no-op shim.
// Production has it installed via apps/api/package.json.
type CronDecorator = (expression: string) => MethodDecorator;
let Cron: CronDecorator;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ Cron } = require('@nestjs/schedule') as { Cron: CronDecorator });
} catch {
  Cron = () => () => undefined;
}

/**
 * Result of a backfill run. Operators surface this in `okoro doctor`.
 */
export interface BackfillReport {
  ranAt: string;
  durationMs: number;
  perStep: {
    hasFirstAgent: number;
    hasFirstPolicy: number;
    hasFirstVerify: number;
    hasMcpServerRegistered: number;
    hasWebhookSubscribed: number;
  };
  totalUpdated: number;
}

@Injectable()
export class OnboardingBackfill implements OnModuleInit {
  private readonly logger = new Logger(OnboardingBackfill.name);
  private lastReport: BackfillReport | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * On boot, run one pass after a 30-second delay (lets the rest of the
   * app come up). Subsequent passes are driven by the @Cron decorator
   * below.
   */
  async onModuleInit(): Promise<void> {
    setTimeout(() => {
      this.run().catch((err) => { this.logger.error(`backfill on-boot run failed: ${(err as Error).message}`); });
    }, 30_000);
  }

  /**
   * Periodic reconciler. Default cadence: every 5 minutes — fast enough
   * to keep the dashboard wizard feeling live, slow enough to not
   * thrash on principals with no recent activity. Operators tune via
   * `OKORO_ONBOARDING_BACKFILL_CRON` if needed.
   */
  @Cron(process.env.OKORO_ONBOARDING_BACKFILL_CRON ?? '*/5 * * * *')
  async runScheduled(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`backfill scheduled run failed: ${(err as Error).message}`);
    }
  }

  /** Most recent successful pass — surfaced by the admin endpoint. */
  getLastReport(): BackfillReport | null {
    return this.lastReport;
  }

  /**
   * Run one backfill pass. Safe to invoke from a scheduler, an admin
   * endpoint, or the CLI. Bounded I/O: each step is a single SQL UPDATE
   * with a CTE — O(1) round-trips per step regardless of principal count.
   */
  async run(): Promise<BackfillReport> {
    const t0 = Date.now();
    const startedAt = new Date(t0).toISOString();

    // Each query: "for every PrincipalOnboarding row whose step is
    // false, set it true if a qualifying entity exists, and stamp the
    // timestamp with the entity's earliest createdAt."
    const [agents, policies, verifies, mcps, webhooks] = await Promise.all([
      this.flipStep(
        'hasFirstAgent',
        'firstAgentAt',
        `SELECT "principalId", MIN("createdAt") AS ts FROM "AgentIdentity" GROUP BY "principalId"`,
      ),
      this.flipStep(
        'hasFirstPolicy',
        'firstPolicyAt',
        `SELECT a."principalId", MIN(p."createdAt") AS ts
           FROM "AgentPolicy" p
           JOIN "AgentIdentity" a ON a."id" = p."agentId"
           GROUP BY a."principalId"`,
      ),
      this.flipStep(
        'hasFirstVerify',
        'firstVerifyAt',
        `SELECT "principalId", MIN("timestamp") AS ts
           FROM "AuditEvent"
           WHERE "action" LIKE '%verify%' OR "action" = 'commerce.purchase'
           GROUP BY "principalId"`,
      ),
      this.flipStep(
        'hasMcpServerRegistered',
        'firstMcpServerAt',
        `SELECT "principalId", MIN("createdAt") AS ts
           FROM "RelyingParty"
           WHERE "kind" = 'MCP_SERVER'
           GROUP BY "principalId"`,
      ),
      this.flipStep(
        'hasWebhookSubscribed',
        'firstWebhookAt',
        `SELECT "principalId", MIN("createdAt") AS ts FROM "WebhookSubscription" GROUP BY "principalId"`,
      ),
    ]);

    const total = agents + policies + verifies + mcps + webhooks;
    const durationMs = Date.now() - t0;
    this.logger.log(
      `onboarding backfill: agents=${agents} policies=${policies} verifies=${verifies} mcps=${mcps} webhooks=${webhooks} duration=${durationMs}ms`,
    );

    const report: BackfillReport = {
      ranAt: startedAt,
      durationMs,
      perStep: {
        hasFirstAgent: agents,
        hasFirstPolicy: policies,
        hasFirstVerify: verifies,
        hasMcpServerRegistered: mcps,
        hasWebhookSubscribed: webhooks,
      },
      totalUpdated: total,
    };
    this.lastReport = report;
    return report;
  }

  /**
   * Flip one onboarding step. The select query MUST yield rows of
   * `(principalId TEXT, ts TIMESTAMP)`. The UPDATE writes both the
   * boolean and (only if the timestamp column was null) the first-seen
   * timestamp. Returns the number of rows updated.
   */
  private async flipStep(
    boolCol: string,
    tsCol: string,
    sourceCte: string,
  ): Promise<number> {
    // Two-step write so we count rows updated. We could collapse but
    // keeping them separate gives us per-step metrics.
    const result = await this.prisma.$executeRawUnsafe(
      `UPDATE "PrincipalOnboarding" o
         SET "${boolCol}" = true,
             "${tsCol}" = COALESCE(o."${tsCol}", src.ts),
             "updatedAt" = CURRENT_TIMESTAMP
         FROM (${sourceCte}) AS src
         WHERE src."principalId" = o."principalId"
           AND o."${boolCol}" = false`,
    );
    return result ?? 0;
  }
}
