// OutboxWorker — drains the OutboxEvent table (ADR-0007).
//
// Round 4 shipped the {@link OutboxService} with `claim` / `complete` /
// `failAttempt`. Round 6 adds the loop that actually walks rows. Without
// a worker, every BATE signal and webhook side-effect that callers
// enqueueInTx piles up undelivered — the audit-or-bust SOC2 invariant
// holds at WRITE time but not at DELIVERY time. This file closes that.
//
// Lifecycle:
//   tick():
//     rows = outbox.claim(workerId, BATCH_SIZE, LOCK_TTL_MS)
//     for each row:
//        try: handler(row.payload)
//             outbox.complete(row.id)
//             metrics: outbox_drained_total{kind, outcome=ok}
//        catch: outbox.failAttempt(row.id, err)
//             metrics: outbox_drained_total{kind, outcome=fail}
//             if attempts >= MAX_ATTEMPTS: log + leave (will not be re-claimed)
//
// Concurrency: every replica runs its own worker. `claim` uses
// `FOR UPDATE SKIP LOCKED`, so multiple replicas drain in parallel
// without double-processing.
//
// Crash recovery: if the worker dies after `claim` but before `complete`
// or `failAttempt`, the row's `lockedAt` ages out (LOCK_TTL_MS) and
// becomes re-claimable. This is why the lock TTL is finite, not
// infinite — we trade a small re-execution risk for crash-resilience.
// Handlers MUST be idempotent (BATE has `idempotencyKey`; webhook
// uses HMAC-signed `delivery.id` for receiver-side dedup).

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../observability/metrics.service';

import { OutboxService, type OutboxKind, type OutboxPayload } from './outbox.service';

export const DEFAULT_BATCH_SIZE = 32;
/** Lock TTL — rows older than this are re-claimable. Tune for handler p99. */
export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
/** Loop interval — empty-DB poll cadence. Active draining bypasses this. */
export const DEFAULT_TICK_INTERVAL_MS = 1_000;
/** Max attempts before a row is left in the outbox as dead-letter. */
export const DEFAULT_MAX_ATTEMPTS = 8;

export type OutboxHandler<K extends OutboxKind> = (payload: OutboxPayload[K], context: OutboxHandlerContext) => Promise<void>;

export interface OutboxHandlerContext {
  /** Outbox row id — used by handlers for trace correlation only. */
  rowId: string;
  /** How many times this row has previously failed. 0 on first attempt. */
  prevAttempts: number;
}

export interface OutboxWorkerConfig {
  batchSize: number;
  lockTtlMs: number;
  tickIntervalMs: number;
  maxAttempts: number;
  /** Stable id for telemetry — `pod-<n>` in K8s, hostname elsewhere. */
  workerId: string;
}

const DEFAULT_CONFIG: OutboxWorkerConfig = {
  batchSize: DEFAULT_BATCH_SIZE,
  lockTtlMs: DEFAULT_LOCK_TTL_MS,
  tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  workerId: process.env.HOSTNAME ?? 'okoro-api',
};

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly handlers = new Map<OutboxKind, OutboxHandler<OutboxKind>>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private readonly config: OutboxWorkerConfig;

  constructor(
    private readonly outbox: OutboxService,
    private readonly metrics: MetricsService,
    appConfig: AppConfigService,
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      // type-rationale: AppConfigService doesn't expose the worker id today;
      // fall back to env. Future config getter `outboxWorkerId` can override.
      workerId:
        (appConfig as unknown as { outboxWorkerId?: string }).outboxWorkerId ??
        DEFAULT_CONFIG.workerId,
    };
  }

  async onModuleInit(): Promise<void> {
    // Defer first tick by one interval so handlers registered after the
    // OutboxWorker has constructed (e.g. from BateModule, WebhooksModule)
    // are present before we start draining.
    this.timer = setTimeout(() => void this.loop(), this.config.tickIntervalMs);
    this.logger.log(`OutboxWorker scheduled — workerId=${this.config.workerId}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // Wait for in-flight tick to finish so we don't tear down the metrics
    // registry mid-increment. Bounded — loop exits on `stopped` flag.
    while (this.running) {
      await new Promise((r) => setTimeout(r, 25));
    }
    this.logger.log('OutboxWorker stopped.');
  }

  /**
   * Register a handler for an outbox kind. Idempotent — re-registering
   * replaces the prior handler. Modules call this in their `onModuleInit`.
   */
  register<K extends OutboxKind>(kind: K, handler: OutboxHandler<K>): void {
    this.handlers.set(kind, handler as OutboxHandler<OutboxKind>);
    this.logger.log(`Outbox handler registered for kind=${kind}`);
  }

  /** Test-visible loop body. Returns when one drain cycle completes. */
  async tickOnce(): Promise<{ drained: number; failed: number; deadLettered: number }> {
    let drained = 0;
    let failed = 0;
    let deadLettered = 0;

    const rows = await this.outbox.claim(
      this.config.workerId,
      this.config.batchSize,
      this.config.lockTtlMs,
    );

    for (const row of rows) {
      const kind = row.kind as OutboxKind;
      const handler = this.handlers.get(kind);

      if (!handler) {
        // No handler registered — record + fail, do NOT silently drop.
        // CLAUDE.md invariant #4: no silent failures.
        await this.outbox.failAttempt(row.id, new Error(`no handler registered for kind=${kind}`));
        failed += 1;
        this.metrics.outboxDrainedTotal?.inc({ kind, outcome: 'no_handler' });
        if (row.attempts + 1 >= this.config.maxAttempts) {
          deadLettered += 1;
          this.logger.error(
            `outbox row ${row.id} kind=${kind} dead-lettered after ${row.attempts + 1} attempts (no handler)`,
          );
        }
        continue;
      }

      try {
        await handler(row.payload as OutboxPayload[OutboxKind], {
          rowId: row.id,
          prevAttempts: row.attempts,
        });
        await this.outbox.complete(row.id);
        drained += 1;
        this.metrics.outboxDrainedTotal?.inc({ kind, outcome: 'ok' });
      } catch (err) {
        await this.outbox.failAttempt(row.id, err as Error);
        failed += 1;
        this.metrics.outboxDrainedTotal?.inc({ kind, outcome: 'fail' });
        if (row.attempts + 1 >= this.config.maxAttempts) {
          deadLettered += 1;
          this.logger.error(
            `outbox row ${row.id} kind=${kind} dead-lettered after ${row.attempts + 1} attempts: ${(err as Error).message}`,
          );
          this.metrics.outboxDeadLetteredTotal?.inc({ kind });
        } else {
          this.logger.warn(
            `outbox row ${row.id} kind=${kind} attempt ${row.attempts + 1} failed: ${(err as Error).message}`,
          );
        }
      }
    }

    return { drained, failed, deadLettered };
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    this.running = true;
    try {
      const result = await this.tickOnce();

      // Active drain: if we just processed a full batch, immediately try
      // again. Empty batch → schedule next poll on the slow tick.
      const wasFull = result.drained + result.failed >= this.config.batchSize;
      const nextDelay = wasFull ? 0 : this.config.tickIntervalMs;
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.loop(), nextDelay);
      }
    } catch (err) {
      this.logger.error(`outbox loop tick failed: ${(err as Error).message}`);
      // Don't crash the loop on a transient error — back off and retry.
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.loop(), this.config.tickIntervalMs);
      }
    } finally {
      this.running = false;
    }
  }
}
