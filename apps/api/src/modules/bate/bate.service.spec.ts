/**
 * BateService — unit tests
 *
 * Coverage:
 *   ingestSignal() — creates BateSignal row, enqueues recompute worker,
 *                    silently drops duplicate idempotency key (Unique constraint),
 *                    logs + continues (still enqueues) when Prisma fails for other reasons
 *   recompute()    — fetches agent + recent signals, calls scorer.compute,
 *                    updates trust score + history row, evicts Redis cache,
 *                    skips DB write when score/band unchanged
 */

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';

import type { BateScorer } from './bate.scorer';
import { BateService, type IngestSignalInput } from './bate.service';
import type { BateRecomputeWorker } from './bate.worker';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  trustScore: number;
  trustBand: string;
  createdAt: Date;
}

interface SignalRow {
  id: string;
  agentId: string;
  signalType: string;
  severity: string;
  source: string;
  payload: unknown;
  idempotencyKey?: string;
  occurredAt: Date;
}

// ── Prisma stub ───────────────────────────────────────────────────────────────

function makePrisma(agents: AgentRow[] = [], signals: SignalRow[] = []) {
  let signalSeq = 0;

  const agentUpdateMock = jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<AgentRow> }) => {
    const agent = agents.find((a) => a.id === where.id);
    if (agent) Object.assign(agent, data);
    return agent;
  });

  const historyCreateMock = jest.fn(async ({ data }: { data: unknown }) => {
    return data;
  });

  const prisma = {
    bateSignal: {
      create: jest.fn(async ({ data }: { data: Partial<SignalRow> }) => {
        const row: SignalRow = {
          id: `sig_${++signalSeq}`,
          agentId: data.agentId!,
          signalType: data.signalType!,
          severity: data.severity!,
          source: data.source!,
          payload: data.payload ?? {},
          idempotencyKey: data.idempotencyKey,
          occurredAt: new Date(),
        };
        signals.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { agentId?: string } }) => {
        return signals.filter((s) => !where.agentId || s.agentId === where.agentId);
      }),
    },
    agentIdentity: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return agents.find((a) => a.id === where.id) ?? null;
      }),
      update: agentUpdateMock,
    },
    trustScoreHistory: {
      create: historyCreateMock,
    },
    // Array-form $transaction: executes each operation (already called eagerly in JS) and resolves
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => {
      return await Promise.all(ops);
    }),
  };

  return { prisma, agents, signals, agentUpdateMock, historyCreateMock };
}

function makeRedis(): jest.Mocked<Pick<RedisService, 'del'>> {
  return { del: jest.fn().mockResolvedValue(1) };
}

function makeScorer(fixedScore = 700, fixedBand = 'PLATINUM'): jest.Mocked<BateScorer> {
  return {
    compute: jest.fn().mockReturnValue(fixedScore),
    bandFromScore: jest.fn().mockReturnValue(fixedBand),
  } as unknown as jest.Mocked<BateScorer>;
}

function makeWorker(): jest.Mocked<BateRecomputeWorker> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    process: jest.fn(),
  } as unknown as jest.Mocked<BateRecomputeWorker>;
}

function makeService(opts: {
  agents?: AgentRow[];
  signals?: SignalRow[];
  fixedScore?: number;
  fixedBand?: string;
} = {}) {
  const { prisma, agents, signals, agentUpdateMock, historyCreateMock } = makePrisma(opts.agents ?? [], opts.signals ?? []);
  const redis = makeRedis();
  const scorer = makeScorer(opts.fixedScore ?? 700, opts.fixedBand ?? 'PLATINUM');
  const worker = makeWorker();
  const svc = new BateService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    scorer,
    worker,
  );
  return { svc, prisma, redis, scorer, worker, agents, signals, agentUpdateMock, historyCreateMock };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_SIGNAL: IngestSignalInput = {
  agentId: 'agt_1',
  signalType: 'CLEAN_TRANSACTION',
  severity: 'LOW',
  source: 'principal:prn_A',
  payload: { transactionId: 'tx_001' },
};

const ACTIVE_AGENT: AgentRow = {
  id: 'agt_1',
  trustScore: 600,
  trustBand: 'VERIFIED',
  createdAt: new Date(Date.now() - 90 * 86_400_000),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BateService', () => {
  describe('ingestSignal()', () => {
    it('creates a BateSignal row in the database', async () => {
      const { svc, signals } = makeService();
      await svc.ingestSignal(BASE_SIGNAL);
      expect(signals).toHaveLength(1);
      expect(signals[0].agentId).toBe('agt_1');
      expect(signals[0].signalType).toBe('CLEAN_TRANSACTION');
    });

    it('enqueues the recompute worker with agentId and signalId', async () => {
      const { svc, worker, signals } = makeService();
      await svc.ingestSignal(BASE_SIGNAL);
      expect(worker.enqueue).toHaveBeenCalledWith('agt_1', signals[0].id);
    });

    it('silently drops a duplicate idempotency key — returns without throwing', async () => {
      const { svc, prisma } = makeService();
      (prisma.bateSignal.create as jest.Mock).mockRejectedValueOnce(
        new Error('Unique constraint failed on the fields: (`idempotencyKey`)'),
      );
      // Should NOT throw — duplicate is silently dropped
      await expect(svc.ingestSignal({ ...BASE_SIGNAL, idempotencyKey: 'idem_001' })).resolves.toBeUndefined();
    });

    it('does NOT enqueue the worker on a duplicate idempotency key (early return)', async () => {
      const { svc, prisma, worker } = makeService();
      (prisma.bateSignal.create as jest.Mock).mockRejectedValueOnce(
        new Error('Unique constraint failed on the fields: (`idempotencyKey`)'),
      );
      await svc.ingestSignal({ ...BASE_SIGNAL, idempotencyKey: 'idem_001' });
      // Unique constraint → return early, worker.enqueue is NOT called
      expect(worker.enqueue).not.toHaveBeenCalled();
    });

    it('THROWS on non-uniqueness Prisma errors — does NOT enqueue worker with undefined signalId', async () => {
      // Updated 2026-05-27 (swarm-2 silent-failure-hunter finding):
      // The previous behavior ("still enqueues with undefined signalId")
      // let the BATE recompute run on partial signal state for any
      // non-uniqueness Prisma error (FK violation, transient connection
      // drop, schema validation). apps/api/CLAUDE.md hard rule: "Do
      // not swallow errors in security paths" — BATE feeds the verify
      // hot path's trust score, so this is security-relevant. The fix
      // logs and re-throws so the caller learns the signal was not
      // persisted.
      const { svc, prisma, worker } = makeService();
      (prisma.bateSignal.create as jest.Mock).mockRejectedValueOnce(new Error('Connection timeout'));
      await expect(svc.ingestSignal(BASE_SIGNAL)).rejects.toThrow('Connection timeout');
      expect(worker.enqueue).not.toHaveBeenCalled();
    });

    it('stores the idempotencyKey on the row when provided', async () => {
      const { svc, signals } = makeService();
      await svc.ingestSignal({ ...BASE_SIGNAL, idempotencyKey: 'my-unique-key' });
      expect(signals[0].idempotencyKey).toBe('my-unique-key');
    });
  });

  describe('recompute()', () => {
    it('does nothing when agent does not exist', async () => {
      const { svc, scorer, worker } = makeService({ agents: [] });
      await svc.recompute('agt_nonexistent');
      expect(scorer.compute).not.toHaveBeenCalled();
      expect(worker.enqueue).not.toHaveBeenCalled();
    });

    it('calls scorer.compute with agent data and recent signals', async () => {
      const { svc, scorer } = makeService({ agents: [{ ...ACTIVE_AGENT }] });
      await svc.recompute('agt_1');
      expect(scorer.compute).toHaveBeenCalledWith(
        expect.objectContaining({
          currentScore: 600,
          createdAt: ACTIVE_AGENT.createdAt,
        }),
      );
    });

    it('updates trustScore and trustBand when they change', async () => {
      // fixedScore=700 (PLATINUM) differs from ACTIVE_AGENT (600, VERIFIED)
      const { svc, agents } = makeService({ agents: [{ ...ACTIVE_AGENT }], fixedScore: 700, fixedBand: 'PLATINUM' });
      await svc.recompute('agt_1');
      expect(agents[0].trustScore).toBe(700);
      expect(agents[0].trustBand).toBe('PLATINUM');
    });

    it('calls $transaction with two operations when score changes', async () => {
      const { svc, prisma } = makeService({ agents: [{ ...ACTIVE_AGENT }], fixedScore: 700, fixedBand: 'PLATINUM' });
      await svc.recompute('agt_1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('evicts the Redis cache keys after a score update', async () => {
      const { svc, redis } = makeService({ agents: [{ ...ACTIVE_AGENT }], fixedScore: 700, fixedBand: 'PLATINUM' });
      await svc.recompute('agt_1');
      expect(redis.del).toHaveBeenCalledWith('agent:status:agt_1', 'agent:public-status:agt_1');
    });

    it('calls agentIdentity.update with new score/band', async () => {
      const { svc, agentUpdateMock } = makeService({ agents: [{ ...ACTIVE_AGENT }], fixedScore: 750, fixedBand: 'PLATINUM' });
      await svc.recompute('agt_1');
      expect(agentUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'agt_1' },
          data: expect.objectContaining({ trustScore: 750, trustBand: 'PLATINUM' }),
        }),
      );
    });

    it('calls trustScoreHistory.create with reason "recompute (sync)"', async () => {
      const { svc, historyCreateMock } = makeService({ agents: [{ ...ACTIVE_AGENT }], fixedScore: 700, fixedBand: 'PLATINUM' });
      await svc.recompute('agt_1');
      expect(historyCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ agentId: 'agt_1', reason: 'recompute (sync)' }),
        }),
      );
    });

    it('skips the DB write when score and band are both unchanged', async () => {
      // Score stays at 600, band stays at VERIFIED — same as ACTIVE_AGENT
      const { svc, agentUpdateMock, prisma } = makeService({
        agents: [{ ...ACTIVE_AGENT }],
        fixedScore: 600,
        fixedBand: 'VERIFIED',
      });
      await svc.recompute('agt_1');
      // Neither $transaction nor the individual update should be called
      expect(agentUpdateMock).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
