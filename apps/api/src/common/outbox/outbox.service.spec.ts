import type { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';

import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  function build() {
    const rows = new Map<string, { id: string; kind: string; payload: unknown; attempts: number; processedAt: Date | null; lockedAt: Date | null; lockedBy: string | null; lastError: string | null }>();
    let nextId = 1;

    const txClient = {
      outboxEvent: {
        create: jest.fn(async ({ data }: { data: { kind: string; payload: unknown } }) => {
          const id = `oe_${nextId++}`;
          rows.set(id, {
            id,
            kind: data.kind,
            payload: data.payload,
            attempts: 0,
            processedAt: null,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
          });
          return { id };
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const r = rows.get(where.id);
          if (!r) throw new Error('not found');
          // Mimic Prisma's `{ increment: N }` semantics so tests cover the
          // real call shape, not a flattened approximation.
          const writable = r as unknown as Record<string, unknown>;
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in v) {
              const current = (writable[k] as number | undefined) ?? 0;
              writable[k] = current + (v as { increment: number }).increment;
            } else {
              writable[k] = v;
            }
          }
          return r;
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const prisma = {
      $transaction: jest.fn(async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => await fn(txClient)),
      outboxEvent: txClient.outboxEvent,
    } as unknown as PrismaService;

    return { prisma, rows, txClient };
  }

  it('enqueueInTx writes a row inside the provided transaction', async () => {
    const { prisma, rows, txClient } = build();
    const svc = new OutboxService(prisma);
    const id = await svc.enqueueInTx(txClient, 'BATE_SIGNAL', {
      agentId: 'agt_1',
      signalType: 'CLEAN_TRANSACTION',
      severity: 'LOW',
      source: 'internal',
      payload: { x: 1 },
    });
    expect(id).toMatch(/^oe_\d+$/);
    expect(rows.size).toBe(1);
    expect(rows.get(id)?.kind).toBe('BATE_SIGNAL');
  });

  it('enqueue (no tx) round-trips through prisma.$transaction', async () => {
    const { prisma, rows } = build();
    const svc = new OutboxService(prisma);
    await svc.enqueue('WEBHOOK_DELIVERY', {
      subscriptionId: 'sub_1',
      event: 'agent.created',
      payload: {},
    });
    expect(rows.size).toBe(1);
  });

  it('complete stamps processedAt and clears the lock', async () => {
    const { prisma, rows, txClient } = build();
    const svc = new OutboxService(prisma);
    const id = await svc.enqueueInTx(txClient, 'BATE_SIGNAL', {
      agentId: 'agt_1',
      signalType: 'CLEAN_TRANSACTION',
      severity: 'LOW',
      source: 'internal',
      payload: {},
    });
    await svc.complete(id);
    const row = rows.get(id);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.lockedAt).toBeNull();
  });

  it('failAttempt increments attempts and records error', async () => {
    const { prisma, rows, txClient } = build();
    const svc = new OutboxService(prisma);
    const id = await svc.enqueueInTx(txClient, 'BATE_SIGNAL', {
      agentId: 'agt_1',
      signalType: 'CLEAN_TRANSACTION',
      severity: 'LOW',
      source: 'internal',
      payload: {},
    });
    await svc.failAttempt(id, new Error('downstream busy'));
    const row = rows.get(id);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe('downstream busy');
    expect(row?.lockedAt).toBeNull();
  });
});
