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
//   - G-3: After scoring, BateAnomalyDetector runs over the same window.
//     Any emitted anomaly signals are persisted directly (bypasses BateService
//     to avoid circular DI) and a follow-up recompute is enqueued so the
//     new signals factor into the score on the next pass.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BateScorer } from './bate.scorer';
import { BateAnomalyDetector, type DetectorWindow } from './bate.anomaly';

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
    private readonly anomalyDetector: BateAnomalyDetector,
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

    // ── G-3: Run anomaly detector over the same window ──────────────────────
    // Pure function — no side effects. Emitted signals are persisted below
    // directly via Prisma (bypasses BateService to avoid circular DI).
    // We fetch the supplementary data the detector needs in parallel with
    // the RP-weight lookup above, so the critical path stays fast.
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3_600_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [recentDenialsRaw, recentSpendsRaw, delegationDepthRaw] = await Promise.all([
      // AuditEvent uses `decision` (AuditDecision enum) and `timestamp` — not `outcome`/`createdAt`.
      this.prisma.auditEvent.findMany({
        where: { agentId: data.agentId, decision: 'DENIED', timestamp: { gte: oneHourAgo } },
        select: { denialReason: true, timestamp: true },
        take: 500,
      }),
      this.prisma.spendRecord.findMany({
        where: { agentId: data.agentId, date: { gte: thirtyDaysAgo } },
        select: { amount: true, currency: true, date: true },
        take: 1_000,
      }),
      this.prisma.agentDelegation.count({
        where: { delegatorId: data.agentId, status: 'ACTIVE', expiresAt: { gt: now } },
      }),
    ]);

    // Derive geographic signals from BateSignal payloads where countryCode is present.
    // BateSignal uses `occurredAt` — not `createdAt`.
    const recentLocations = recentSignals
      .filter((s) => {
        const p = s.payload as Record<string, unknown> | null;
        return typeof p?.countryCode === 'string';
      })
      .map((s) => ({
        countryCode: (s.payload as Record<string, string>).countryCode,
        timestamp: s.occurredAt,
      }));

    const detectorWindow: DetectorWindow = {
      now,
      signals: recentSignals,
      recentDenials: recentDenialsRaw.map((d) => ({
        denialReason: d.denialReason ?? 'UNKNOWN',
        timestamp: d.timestamp,
      })),
      recentSpends: recentSpendsRaw.map((s) => ({
        amount: Number(s.amount),
        currency: s.currency,
        timestamp: s.date,
      })),
      recentLocations,
      delegationChainDepth: delegationDepthRaw,
    };

    const emittedSignals = this.anomalyDetector.detect(detectorWindow);

    if (emittedSignals.length > 0) {
      // Persist anomaly signals directly (avoids BateService circular dep).
      // Use createMany with skipDuplicates so a repeated anomaly in the same
      // recompute window doesn't double-count (idempotency key = type+agentId+minute).
      const minute = Math.floor(now.getTime() / 60_000);
      await this.prisma.bateSignal.createMany({
        data: emittedSignals.map((s) => ({
          agentId: data.agentId,
          signalType: s.signalType,
          severity: s.severity,
          source: s.source,
          payload: { reason: s.reason } as object,
          idempotencyKey: `anomaly:${s.signalType}:${data.agentId}:${minute}`,
        })),
        skipDuplicates: true,
      });

      // Re-enqueue a follow-up recompute so the new signals feed the score.
      // The 5 s delay lets this job finish first; BullMQ jobId deduplication
      // prevents stacking if another signal arrives in the same window.
      await this.enqueue(data.agentId);

      this.logger.warn(
        `BATE anomaly: agent=${data.agentId} rules=[${emittedSignals.map((s) => s.source).join(',')}]`,
      );
      // Increment per-rule counter — low-cardinality label (rule name), not agent_id.
      for (const s of emittedSignals) {
        this.metrics.bateAnomalyTriggerTotal.inc({ rule: s.source });
      }
    }
    // ── End G-3 ─────────────────────────────────────────────────────────────

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
