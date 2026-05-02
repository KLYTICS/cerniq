import { Injectable, Logger } from '@nestjs/common';
import type { BateSignalType, Prisma, SignalSeverity } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { BateScorer } from './bate.scorer';
import { BateRecomputeWorker } from './bate.worker';

export interface IngestSignalInput {
  agentId: string;
  signalType: BateSignalType;
  severity: SignalSeverity;
  source: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * BATE signal ingestion + recompute façade.
 *
 * Phase 1 ran the recompute inline; Phase 2 (now) hands recompute to the
 * BullMQ worker so verify-hot-path requests don't pay for trust-score
 * math. The synchronous `recompute()` method still exists for batch
 * scripts and backfills — same code the worker calls.
 */
@Injectable()
export class BateService {
  private readonly logger = new Logger(BateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly scorer: BateScorer,
    private readonly worker: BateRecomputeWorker,
  ) {}

  async ingestSignal(input: IngestSignalInput): Promise<void> {
    let signalId: string | undefined;
    try {
      const created = await this.prisma.bateSignal.create({
        data: {
          agentId: input.agentId,
          signalType: input.signalType,
          severity: input.severity,
          source: input.source,
          payload: input.payload as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
        },
      });
      signalId = created.id;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Unique constraint')) {
        // Duplicate idempotency key — drop silently, do not double-count.
        return;
      }
      this.logger.warn(`BATE signal ingest failed: ${msg}`);
    }
    await this.worker.enqueue(input.agentId, signalId);
  }

  /**
   * Synchronous recompute path — batch scripts / backfills / tests.
   * Production verify/ingest paths go through the BullMQ worker.
   */
  async recompute(agentId: string): Promise<void> {
    const agent = await this.prisma.agentIdentity.findUnique({
      where: { id: agentId },
      select: { id: true, trustScore: true, trustBand: true, createdAt: true },
    });
    if (!agent) return;

    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const recentSignals = await this.prisma.bateSignal.findMany({
      where: { agentId, occurredAt: { gte: cutoff } },
      orderBy: { occurredAt: 'desc' },
      take: 5_000,
    });

    const score = this.scorer.compute({
      currentScore: agent.trustScore,
      createdAt: agent.createdAt,
      recentSignals,
    });
    const band = this.scorer.bandFromScore(score);
    if (score === agent.trustScore && band === agent.trustBand) return;

    await this.prisma.$transaction([
      this.prisma.agentIdentity.update({
        where: { id: agentId },
        data: { trustScore: score, trustBand: band, lastScoredAt: new Date() },
      }),
      this.prisma.trustScoreHistory.create({ data: { agentId, score, band, reason: 'recompute (sync)' } }),
    ]);
    await this.redis.del(`agent:status:${agentId}`, `agent:public-status:${agentId}`);
    this.logger.log(`BATE recomputed (sync) agent=${agentId} score=${score} band=${band}`);
  }
}
