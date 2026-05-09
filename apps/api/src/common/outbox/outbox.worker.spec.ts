import {
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_MAX_ATTEMPTS,
  OutboxWorker,
  type OutboxHandler,
} from './outbox.worker';
import type { OutboxService, OutboxKind } from './outbox.service';

interface FakeRow {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  processedAt: Date | null;
  lockedAt: Date | null;
  lastError: string | null;
}

function buildFakeOutbox(rows: FakeRow[]): {
  outbox: OutboxService;
  state: { rows: FakeRow[]; claimed: FakeRow[] };
} {
  const claimed: FakeRow[] = [];
  const outbox = {
    claim: jest.fn(async (_workerId: string, batchSize: number) => {
      const eligible = rows
        .filter((r) => r.processedAt === null && r.lockedAt === null)
        .slice(0, batchSize);
      const now = new Date();
      for (const r of eligible) {
        r.lockedAt = now;
        claimed.push(r);
      }
      return eligible.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: r.payload,
        attempts: r.attempts,
      }));
    }),
    complete: jest.fn(async (id: string) => {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.processedAt = new Date();
        r.lockedAt = null;
      }
    }),
    failAttempt: jest.fn(async (id: string, err: Error) => {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.attempts += 1;
        r.lastError = err.message;
        r.lockedAt = null;
      }
    }),
  } as unknown as OutboxService;
  return { outbox, state: { rows, claimed } };
}

function buildMetrics() {
  return {
    outboxDrainedTotal: { inc: jest.fn() },
    outboxDeadLetteredTotal: { inc: jest.fn() },
  };
}

function buildWorker(opts: {
  outbox: OutboxService;
  metrics?: ReturnType<typeof buildMetrics>;
}): OutboxWorker {
  const metrics = opts.metrics ?? buildMetrics();
  // Bypass DI: the constructor only reads from these, and we don't want
  // to spin up a Nest container for a unit test.
  const w = new OutboxWorker(opts.outbox, metrics as never, { /* AppConfigService stub */ } as never);
  return w;
}

describe('OutboxWorker.tickOnce', () => {
  it('returns 0/0/0 on an empty outbox', async () => {
    const { outbox } = buildFakeOutbox([]);
    const w = buildWorker({ outbox });
    const r = await w.tickOnce();
    expect(r).toEqual({ drained: 0, failed: 0, deadLettered: 0 });
  });

  it('dispatches matching handler and completes the row on success', async () => {
    const { outbox, state } = buildFakeOutbox([
      {
        id: 'oe_1',
        kind: 'BATE_SIGNAL',
        payload: { agentId: 'agt_1', signalType: 'CLEAN_TRANSACTION', severity: 'LOW', source: 'test', payload: {} },
        attempts: 0,
        processedAt: null,
        lockedAt: null,
        lastError: null,
      },
    ]);
    const handler: OutboxHandler<'BATE_SIGNAL'> = jest.fn(async () => undefined);
    const w = buildWorker({ outbox });
    w.register('BATE_SIGNAL', handler);

    const r = await w.tickOnce();
    expect(r.drained).toBe(1);
    expect(r.failed).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.rows[0]?.processedAt).not.toBeNull();
  });

  it('records failAttempt + does not complete on handler throw', async () => {
    const { outbox, state } = buildFakeOutbox([
      {
        id: 'oe_2',
        kind: 'WEBHOOK_DELIVERY',
        payload: { subscriptionId: 'sub_1', event: 'agent.created', payload: {} },
        attempts: 0,
        processedAt: null,
        lockedAt: null,
        lastError: null,
      },
    ]);
    const handler: OutboxHandler<'WEBHOOK_DELIVERY'> = jest.fn(async () => {
      throw new Error('downstream busy');
    });
    const w = buildWorker({ outbox });
    w.register('WEBHOOK_DELIVERY', handler);

    const r = await w.tickOnce();
    expect(r.failed).toBe(1);
    expect(r.drained).toBe(0);
    expect(state.rows[0]?.attempts).toBe(1);
    expect(state.rows[0]?.processedAt).toBeNull();
  });

  it('marks rows for which no handler is registered as failed (no silent drop)', async () => {
    const { outbox, state } = buildFakeOutbox([
      {
        id: 'oe_orphan',
        kind: 'UNKNOWN_KIND' as OutboxKind,
        payload: {},
        attempts: 0,
        processedAt: null,
        lockedAt: null,
        lastError: null,
      },
    ]);
    const w = buildWorker({ outbox });
    const r = await w.tickOnce();
    expect(r.failed).toBe(1);
    expect(state.rows[0]?.lastError).toMatch(/no handler registered/);
  });

  it('counts deadLettered when prevAttempts hits maxAttempts on failure', async () => {
    const { outbox } = buildFakeOutbox([
      {
        id: 'oe_dlq',
        kind: 'BATE_SIGNAL',
        // prevAttempts already at maxAttempts - 1 → next attempt is the
        // dead-letter threshold.
        attempts: DEFAULT_MAX_ATTEMPTS - 1,
        payload: { agentId: 'agt_x', signalType: 'CLEAN_TRANSACTION', severity: 'LOW', source: 't', payload: {} },
        processedAt: null,
        lockedAt: null,
        lastError: null,
      },
    ]);
    const handler: OutboxHandler<'BATE_SIGNAL'> = jest.fn(async () => {
      throw new Error('boom');
    });
    const metrics = buildMetrics();
    const w = buildWorker({ outbox, metrics });
    w.register('BATE_SIGNAL', handler);
    const r = await w.tickOnce();
    expect(r.deadLettered).toBe(1);
    expect(metrics.outboxDeadLetteredTotal.inc).toHaveBeenCalledWith({ kind: 'BATE_SIGNAL' });
  });

  it('drains a mixed batch in one tick', async () => {
    const { outbox, state } = buildFakeOutbox([
      {
        id: 'oe_a',
        kind: 'BATE_SIGNAL',
        payload: { agentId: 'a', signalType: 'CLEAN_TRANSACTION', severity: 'LOW', source: 't', payload: {} },
        attempts: 0,
        processedAt: null,
        lockedAt: null,
        lastError: null,
      },
      {
        id: 'oe_b',
        kind: 'WEBHOOK_DELIVERY',
        payload: { subscriptionId: 'sub_1', event: 'x', payload: {} },
        attempts: 0,
        processedAt: null,
        lockedAt: null,
        lastError: null,
      },
    ]);
    const w = buildWorker({ outbox });
    w.register('BATE_SIGNAL', jest.fn(async () => undefined));
    w.register('WEBHOOK_DELIVERY', jest.fn(async () => undefined));
    const r = await w.tickOnce();
    expect(r.drained).toBe(2);
    expect(state.rows.every((r) => r.processedAt !== null)).toBe(true);
  });
});

describe('OutboxWorker constants', () => {
  it('exports a sane lock TTL (>= 1 minute, <= 30 minutes)', () => {
    expect(DEFAULT_LOCK_TTL_MS).toBeGreaterThanOrEqual(60_000);
    expect(DEFAULT_LOCK_TTL_MS).toBeLessThanOrEqual(30 * 60_000);
  });
});
