// BATE recompute worker — moves trust-score recomputation off the verify
// hot path. One BullMQ queue per process; idempotent dedupe per agent so
// a burst of signals coalesces into a single recompute.
//
// Design:
//   - On signal ingest, BateService persists the row + enqueues a
//     `recompute(agentId)` job.
//   - The job id is `bate:recompute:<agentId>`, so BullMQ dedupes
//     concurrent enqueues — only one job per agent is in flight.
//   - The worker reads the agent + recent signals, computes the score,
//     persists `TrustScoreHistory`, invalidates Redis, and (if the band
//     changed) emits an `aegis.agent.trust_score_changed` webhook.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BateScorer } from './bate.scorer';

export const BATE_QUEUE = 'aegis.bate';

interface RecomputeJobData {
  agentId: string;
  triggerSignalId?: string;
}

@Injectable()
export class BateRecomputeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BateRecomputeWorker.name);
  private connection?: IORedis;
  private queue?: Queue<RecomputeJobData>;
  private worker?: Worker<RecomputeJobData>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly scorer: BateScorer,
    private readonly webhooks: WebhooksService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.enableBate) {
      this.logger.log('BATE disabled — skipping queue setup.');
      return;
    }
    this.connection = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<RecomputeJobData>(BATE_QUEUE, { connection: this.connection });
    this.worker = new Worker<RecomputeJobData>(BATE_QUEUE, (job) => this.process(job.data), {
      connection: this.connection.duplicate(),
      concurrency: 4, // recompute is DB-heavy; don't pile on
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`BATE recompute job failed agent=${job?.data.agentId}: ${err?.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
    await this.connection?.quit();
  }

  /**
   * Enqueue a recompute. Coalesces multiple in-flight enqueues for the
   * same agent into a single job (BullMQ dedupes on `jobId`). A small
   * delay (debounce window) lets a burst of signals settle into one job.
   */
  async enqueue(agentId: string, triggerSignalId?: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(
      'recompute',
      { agentId, ...(triggerSignalId ? { triggerSignalId } : {}) },
      {
        jobId: `bate:recompute:${agentId}`,
        delay: 1_000, // 1 s debounce — signals batched within this window become one recompute
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1_000, age: 86_400 },
        removeOnFail: { count: 1_000, age: 7 * 86_400 },
      },
    );
  }

  private async process(data: RecomputeJobData): Promise<void> {
    const agent = await this.prisma.agentIdentity.findUnique({
      where: { id: data.agentId },
      select: { id: true, trustScore: true, trustBand: true, createdAt: true, principalId: true },
    });
    if (!agent) return;

    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const recentSignals = await this.prisma.bateSignal.findMany({
      where: { agentId: data.agentId, occurredAt: { gte: cutoff } },
      orderBy: { occurredAt: 'desc' },
      take: 5_000,
    });

    // Look up relying-party weights for any sources that appear as fraud
    // reports — so a verified RP's report counts heavier than an unknown one.
    const sources = new Set(
      recentSignals.filter((s) => s.signalType === 'RELYING_PARTY_FRAUD_REPORT').map((s) => s.source),
    );
    const relyingPartyWeights: Record<string, number> = {};
    if (sources.size > 0) {
      const rps = await this.prisma.relyingParty.findMany({
        where: { domain: { in: Array.from(sources).map((s) => s.replace(/^relying_party:/, '')) } },
      });
      for (const rp of rps) {
        relyingPartyWeights[`relying_party:${rp.domain}`] = rp.reportWeight;
      }
    }

    const explanation = this.scorer.explain({
      currentScore: agent.trustScore,
      createdAt: agent.createdAt,
      recentSignals,
      relyingPartyWeights,
    });
    const newScore = explanation.finalScore;
    const newBand = this.scorer.bandFromScore(newScore);
    const oldBand = agent.trustBand;
    const oldScore = agent.trustScore;

    if (newScore === oldScore && newBand === oldBand) return;

    await this.prisma.$transaction([
      this.prisma.agentIdentity.update({
        where: { id: data.agentId },
        data: { trustScore: newScore, trustBand: newBand, lastScoredAt: new Date() },
      }),
      this.prisma.trustScoreHistory.create({
        data: {
          agentId: data.agentId,
          score: newScore,
          band: newBand,
          reason: explanation.contributors.map((c) => `${c.kind}:${c.delta}`).join(',').slice(0, 200) || 'recompute',
          ...(data.triggerSignalId ? { signalId: data.triggerSignalId } : {}),
        },
      }),
    ]);

    await this.redis.del(`agent:status:${data.agentId}`, `agent:public-status:${data.agentId}`);
    this.metrics.bateScoreDelta.observe({ signal_type: 'recompute' }, newScore - oldScore);

    if (newBand !== oldBand) {
      await this.webhooks.enqueue(
        {
          type: 'aegis.agent.trust_score_changed',
          data: {
            agentId: data.agentId,
            score: newScore,
            previousScore: oldScore,
            band: newBand,
            previousBand: oldBand,
            weightsVersion: explanation.weightsVersion,
            contributors: explanation.contributors,
          },
        },
        agent.principalId,
      );
    }

    this.logger.log(
      `BATE recomputed agent=${data.agentId} ${oldScore}→${newScore} (${oldBand}→${newBand})`,
    );
  }
}
