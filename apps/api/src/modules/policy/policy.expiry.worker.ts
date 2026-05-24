// Policy expiry sweep — backstop revocation for policies whose `expiresAt`
// has passed but where no revoke API call updated `revokedAt`.
//
// Why a sweep at all? The verify hot path checks `expiresAt` on every
// call (POLICY_EXPIRED denial), so an unswept expired policy is already
// safe — the sweep keeps the data model truthful for dashboards, CSV
// exports, and SOC2 evidence. It also fires the
// `cerniq.agent.policy_expired` webhook so customers can plumb expiry
// into their own ticketing.
//
// Design:
//   - BullMQ repeatable job (every 5 minutes) — uses the same queue
//     pattern as `bate.worker.ts`. Avoids `@nestjs/schedule` so we
//     don't take on a new dependency.
//   - Single SQL UPDATE — atomic, idempotent.
//   - Webhook fan-out is best-effort; failures don't roll back the
//     status flip. The verify hot path already enforces the invariant.
//
// Multi-tenant isolation: the sweep is intentionally tenant-blind (it
// runs on every expired policy in the system). `WebhooksService.enqueue`
// scopes per-principal automatically by looking up the policy's owner.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AgentPolicy } from '@prisma/client';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { WEBHOOK_EVENT } from '@cerniq/types';

import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { WebhooksService } from '../webhooks/webhooks.service';

export const POLICY_EXPIRY_QUEUE = 'cerniq.policy.expiry';
export const POLICY_EXPIRY_REPEAT_KEY = 'policy:expiry:tick';
export const POLICY_EXPIRY_INTERVAL_MS = 5 * 60_000; // 5 min — see ADR-0007 §"Cadence"

interface ExpirySweepResult {
  swept: number;
  errors: number;
}

@Injectable()
export class PolicyExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PolicyExpiryWorker.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly webhooks: WebhooksService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(POLICY_EXPIRY_QUEUE, { connection: this.connection });
    this.worker = new Worker(
      POLICY_EXPIRY_QUEUE,
      async (_job: Job) => {
        return await this.sweep();
      },
      {
        connection: this.connection.duplicate(),
        concurrency: 1, // sweep is global; no parallelism wanted
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`policy.expiry sweep failed jobId=${job?.id}: ${err?.message}`);
    });

    // Repeatable schedule — BullMQ dedupes the repeatable key so multiple
    // pods won't queue parallel sweeps. The first pod to register wins.
    await this.queue.add(
      'sweep',
      { tick: POLICY_EXPIRY_REPEAT_KEY },
      {
        repeat: { every: POLICY_EXPIRY_INTERVAL_MS, immediately: false },
        removeOnComplete: { count: 100, age: 86_400 },
        removeOnFail: { count: 100, age: 7 * 86_400 },
      },
    );
    this.logger.log(
      `PolicyExpiryWorker started — sweep every ${POLICY_EXPIRY_INTERVAL_MS / 1000}s`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
    await this.connection?.quit();
  }

  /**
   * Single sweep pass. Public for tests + admin endpoints that may want to
   * trigger an out-of-band sweep (e.g. after a clock skew alert).
   *
   * Returns counts: how many rows were swept and how many webhook fan-outs
   * failed. The status update itself is treated as the durable boundary.
   */
  async sweep(): Promise<ExpirySweepResult> {
    const now = new Date();

    // Find expired-but-still-active policies. We grab the rows BEFORE the
    // update so we can fire targeted webhooks per row; SELECT-then-UPDATE
    // is fine here because (a) verify hot path already gates expiry, and
    // (b) the sweep concurrency=1 prevents two workers from racing on the
    // same row.
    const expired: (Pick<AgentPolicy, 'id' | 'agentId' | 'expiresAt'> & {
      principalId?: string;
    })[] = await this.prisma.agentPolicy
      .findMany({
        where: { revokedAt: null, status: 'ACTIVE', expiresAt: { lt: now } },
        select: {
          id: true,
          agentId: true,
          expiresAt: true,
          agent: { select: { principalId: true } },
        },
        take: 1_000, // bound a single sweep so a backlog doesn't OOM
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          agentId: r.agentId,
          expiresAt: r.expiresAt,
          principalId: r.agent.principalId,
        })),
      );

    if (expired.length === 0) {
      return { swept: 0, errors: 0 };
    }

    const { count } = await this.prisma.agentPolicy.updateMany({
      where: { id: { in: expired.map((p) => p.id) }, revokedAt: null },
      data: { revokedAt: now, status: 'REVOKED' },
    });

    let errors = 0;
    for (const row of expired) {
      if (!row.principalId) continue;
      try {
        await this.webhooks.enqueue(
          {
            type: WEBHOOK_EVENT.AGENT_POLICY_EXPIRED,
            data: {
              policyId: row.id,
              agentId: row.agentId,
              expiredAt: row.expiresAt.toISOString(),
              sweptAt: now.toISOString(),
            },
          },
          row.principalId,
        );
      } catch (err) {
        errors += 1;
        this.logger.warn(
          `policy.expiry webhook fanout failed policy=${row.id}: ${(err as Error).message}`,
        );
      }
    }

    if (count > 0) {
      this.metrics.policyExpiredSweptTotal?.inc({ outcome: 'swept' }, count);
    }
    this.logger.log(`policy.expiry sweep: ${count} policies revoked, ${errors} webhook errors`);
    return { swept: count, errors };
  }
}
