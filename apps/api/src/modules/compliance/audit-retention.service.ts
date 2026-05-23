// AuditRetentionService — enforces per-plan audit log retention horizons.
//
// CLAUDE.md invariant 3 says the audit log is APPEND-ONLY: no UPDATE,
// no DELETE on AuditEvent. Retention is therefore implemented as
// REDACTION (zero-out raw columns) + a meta-event APPENDED to the chain
// documenting the action. The chain stays cryptographically intact
// because the *Hash columns and cerniqSignature are untouched — verifiers
// rebuild the hash from the now-null raw values and still match.
//
// We delegate the actual redaction to `RedactService.redactEvent` so the
// hot-path semantics (FK preservation, idempotency, meta-event append
// via `AuditService.append`) are reused exactly. This service is a
// scheduler + per-tenant query layer, nothing more.
//
// Why setInterval and not @nestjs/schedule:
//   The schedule module is intentionally NOT wired into AppModule yet
//   (operator wants a single trigger surface for cron). We self-register
//   a setInterval in `onModuleInit`, `unref()` it so it never blocks
//   shutdown, and register a `drain()` with `ShutdownService` so SIGTERM
//   stops the timer + waits for any in-flight run.
//
// CLI fallback:
//   `scripts/run-audit-retention.ts` boots a Nest standalone application
//   context, fetches this service, and calls `runOnce()`. That's the
//   operator-runnable on-demand path, useful for incident response and
//   for environments where the API is intentionally short-lived.
//
// Failure semantics (CLAUDE.md invariant 4: no silent failures):
//   - `runOnce()` never throws. Any per-event redact error is logged
//     with the eventId and counted in `failed`, but the loop continues
//     so a single poisoned row doesn't stall the sweep.
//   - The metrics counter only increments on confirmed successful redacts.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PlanTier } from '@prisma/client';

import { MetricsService } from '../../common/observability/metrics.service';
import { ShutdownService } from '../../common/observability/shutdown.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getPlan } from '../billing/plans';

import { RedactService } from './redact.service';

/** Default sweep cadence — once per 24h. Override via env at boot. */
export const DEFAULT_RETENTION_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Max events we redact per principal per `runOnce` invocation. Safety cap. */
const DEFAULT_PER_PRINCIPAL_BATCH = 1_000;

/** Page size when scanning Principal rows. */
const PRINCIPAL_PAGE_SIZE = 100;

export interface PrincipalRetentionStats {
  scanned: number;
  redacted: number;
  failed: number;
}

export interface RetentionRunResult {
  scanned: number;
  redacted: number;
  failed: number;
  perPrincipal: Record<string, PrincipalRetentionStats>;
  durationMs: number;
}

export interface RetentionRunOptions {
  /** Restrict to a single principal (incident response). */
  principalId?: string;
  /** Hard cap on total events touched in this run. */
  maxEvents?: number;
  /** Don't write — just log what would have happened. */
  dryRun?: boolean;
}

export interface RetentionStatus {
  lastRunAt: Date | null;
  lastRunDurationMs: number | null;
  lastRunRedactedCount: number | null;
  nextRunAt: Date;
}

@Injectable()
export class AuditRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditRetentionService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<RetentionRunResult> | null = null;
  private drained = false;

  private lastRunAt: Date | null = null;
  private lastRunDurationMs: number | null = null;
  private lastRunRedactedCount: number | null = null;

  private readonly intervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redact: RedactService,
    private readonly metrics: MetricsService,
    private readonly shutdown: ShutdownService,
  ) {
    const fromEnv = process.env.CERNIQ_AUDIT_RETENTION_INTERVAL_MS;
    const parsed = fromEnv ? Number.parseInt(fromEnv, 10) : NaN;
    this.intervalMs =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_RUN_INTERVAL_MS;
  }

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      void this.runOnce().catch((err) => {
        // runOnce is structured never to throw; this is belt-and-braces.
        this.logger.error(
          `audit-retention tick threw — should be impossible: ${(err as Error).message}`,
        );
      });
    }, this.intervalMs);
    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }
    this.shutdown.register('audit-retention-worker', () => this.drain());
    this.logger.log(`audit-retention armed — intervalMs=${this.intervalMs}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  /**
   * Idempotent shutdown — clears the interval and waits for any in-flight
   * sweep to finish. Safe to call multiple times.
   */
  async drain(): Promise<void> {
    if (this.drained) return;
    this.drained = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.inFlight) {
      try {
        await this.inFlight;
      } catch {
        // runOnce swallows; still defend against a future refactor.
      }
    }
  }

  getStatus(): RetentionStatus {
    const base = this.lastRunAt ? this.lastRunAt.getTime() : Date.now();
    return {
      lastRunAt: this.lastRunAt,
      lastRunDurationMs: this.lastRunDurationMs,
      lastRunRedactedCount: this.lastRunRedactedCount,
      nextRunAt: new Date(base + this.intervalMs),
    };
  }

  /**
   * Walk every principal (or just one when `options.principalId` is set),
   * compute the per-plan retention horizon, and redact every audit event
   * older than the cutoff via `RedactService`. Idempotent: events with
   * `redactedAt != null` are filtered out at the query layer.
   *
   * Returns aggregate counts. Never throws — per-event failures are logged
   * and surfaced in the `failed` count.
   */
  async runOnce(options: RetentionRunOptions = {}): Promise<RetentionRunResult> {
    if (this.inFlight) {
      // Coalesce: a tick fired while a previous tick is still running.
      // Surfacing a duplicate run would race on counts and waste DB time.
      return await this.inFlight;
    }
    const startedAt = new Date();
    const run = this.executeRun(options, startedAt).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return await run;
  }

  private async executeRun(
    options: RetentionRunOptions,
    startedAt: Date,
  ): Promise<RetentionRunResult> {
    const result: RetentionRunResult = {
      scanned: 0,
      redacted: 0,
      failed: 0,
      perPrincipal: {},
      durationMs: 0,
    };

    const maxEvents = options.maxEvents ?? Number.POSITIVE_INFINITY;

    try {
      let cursor: string | undefined;
      let processedPrincipals = 0;
      // Pagination — `id ASC` cursor is stable + cheap (PK index).

      while (true) {
        if (result.redacted >= maxEvents) break;

        const principals = options.principalId
          ? await this.prisma.principal.findMany({
              where: { id: options.principalId },
              select: { id: true, planTier: true },
            })
          : await this.prisma.principal.findMany({
              take: PRINCIPAL_PAGE_SIZE,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
              orderBy: { id: 'asc' },
              select: { id: true, planTier: true },
            });

        if (principals.length === 0) break;

        for (const p of principals) {
          if (result.redacted >= maxEvents) break;
          const remaining = maxEvents - result.redacted;
          const stats = await this.sweepPrincipal(
            p.id,
            p.planTier,
            remaining,
            options.dryRun ?? false,
          );
          result.perPrincipal[p.id] = stats;
          result.scanned += stats.scanned;
          result.redacted += stats.redacted;
          result.failed += stats.failed;
          processedPrincipals++;
          if (processedPrincipals % 10 === 0) {
            this.logger.log(
              `audit-retention progress principals=${processedPrincipals} ` +
                `redacted=${result.redacted} failed=${result.failed}`,
            );
          }
        }

        if (options.principalId) break; // single-principal mode — no pagination
        cursor = principals[principals.length - 1]?.id;
        if (!cursor) break;
        if (principals.length < PRINCIPAL_PAGE_SIZE) break;
      }
    } catch (err) {
      // Defensive — pagination/query errors are logged but the partial
      // result we accumulated is still returned.
      this.logger.error(`audit-retention sweep aborted: ${(err as Error).message}`);
    }

    result.durationMs = Date.now() - startedAt.getTime();
    this.lastRunAt = startedAt;
    this.lastRunDurationMs = result.durationMs;
    this.lastRunRedactedCount = result.redacted;

    this.logger.log(
      `audit-retention complete scanned=${result.scanned} ` +
        `redacted=${result.redacted} failed=${result.failed} ` +
        `durationMs=${result.durationMs} dryRun=${options.dryRun ?? false}`,
    );
    return result;
  }

  private async sweepPrincipal(
    principalId: string,
    planTier: PlanTier,
    remainingBudget: number,
    dryRun: boolean,
  ): Promise<PrincipalRetentionStats> {
    const stats: PrincipalRetentionStats = { scanned: 0, redacted: 0, failed: 0 };
    if (remainingBudget <= 0) return stats;

    const plan = getPlan(planTier);
    const cutoff = new Date(Date.now() - plan.auditRetentionDays * 24 * 60 * 60 * 1000);
    const reason = `retention_policy:plan=${planTier}:days=${plan.auditRetentionDays}`;

    const batchSize = Math.min(DEFAULT_PER_PRINCIPAL_BATCH, remainingBudget);

    // Query in batches by id ASC. Each iteration filters `redactedAt = null`
    // so already-redacted rows are skipped → idempotent across runs.
    while (stats.redacted < remainingBudget) {
      const batch = await this.prisma.auditEvent.findMany({
        where: {
          principalId,
          timestamp: { lt: cutoff },
          redactedAt: null,
        },
        orderBy: { id: 'asc' },
        take: Math.min(batchSize, remainingBudget - stats.redacted),
        select: { id: true },
      });
      if (batch.length === 0) break;
      stats.scanned += batch.length;

      for (const evt of batch) {
        if (dryRun) {
          stats.redacted++; // counted as "would-have-redacted"
          continue;
        }
        try {
          await this.redact.redactEvent(principalId, {
            eventId: evt.id,
            reason,
          });
          stats.redacted++;
          this.metrics.auditRetentionEventsRedactedTotal.inc();
        } catch (err) {
          stats.failed++;
          // Log every failure (CLAUDE.md invariant 4) — eventId is the
          // operator's recovery handle.
          this.logger.error(
            `audit-retention redact_failed principalId=${principalId} ` +
              `eventId=${evt.id} reason=${(err as Error).message}`,
          );
        }
      }

      // If the batch was smaller than `take`, we exhausted the eligible set.
      if (batch.length < batchSize) break;
    }
    return stats;
  }
}
