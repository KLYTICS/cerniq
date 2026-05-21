import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type OutboxKind = 'BATE_SIGNAL' | 'WEBHOOK_DELIVERY';

export interface OutboxPayload {
  BATE_SIGNAL: {
    agentId: string;
    signalType: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    source: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  };
  WEBHOOK_DELIVERY: {
    subscriptionId: string;
    event: string;
    payload: Record<string, unknown>;
  };
}

/**
 * Transactional outbox (ADR-0007).
 *
 * Callers in the verify hot path use {@link enqueueInTx} to write a
 * deferred side-effect inside the SAME `prisma.$transaction` as their
 * primary state change. A {@link OutboxWorker} drains the table.
 *
 * Replaces three fire-and-forget vectors flagged in
 * `docs/reviews/silent-failures.md`:
 *   - F-003: denied-verify audit append (now in-tx via algorithm)
 *   - F-006: BATE signal ingest (now via outbox)
 *   - The webhook publish-side enqueue (now via outbox)
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append an outbox row using a Prisma transaction handle so the row
   * commits atomically with the caller's other writes. Returns the
   * generated outbox event id for tracing.
   */
  async enqueueInTx<K extends OutboxKind>(
    tx: Prisma.TransactionClient,
    kind: K,
    payload: OutboxPayload[K],
  ): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: { kind, payload: payload as Prisma.InputJsonValue },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Standalone enqueue (no transaction context). Use only when the
   * caller has no other write to bind atomically — most hot-path
   * callers should use {@link enqueueInTx} instead.
   */
  async enqueue<K extends OutboxKind>(kind: K, payload: OutboxPayload[K]): Promise<string> {
    return await this.enqueueInTx(this.prisma, kind, payload);
  }

  /**
   * Worker-side: lock and return up to `batchSize` undelivered rows.
   * Uses `FOR UPDATE SKIP LOCKED` so multiple workers drain in
   * parallel without double-processing. Locks expire after `lockTtlMs`
   * for crash-resilience.
   */
  async claim(
    workerId: string,
    batchSize: number,
    lockTtlMs: number,
  ): Promise<{ id: string; kind: string; payload: unknown; attempts: number }[]> {
    const lockTtlAgo = new Date(Date.now() - lockTtlMs);
    return await this.prisma.$transaction(async (tx) => {
      // Postgres dialect: SELECT ... FOR UPDATE SKIP LOCKED. Prisma
      // doesn't expose this directly; use $queryRaw for the locking,
      // then $executeRaw to claim, all in one tx.
      const rows = await tx.$queryRaw<
        { id: string; kind: string; payload: unknown; attempts: number }[]
      >`
        SELECT id, kind, payload, attempts
        FROM "OutboxEvent"
        WHERE "processedAt" IS NULL
          AND ("lockedAt" IS NULL OR "lockedAt" < ${lockTtlAgo})
        ORDER BY "createdAt"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const now = new Date();
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { lockedAt: now, lockedBy: workerId },
      });
      return rows;
    });
  }

  /** Mark a row processed. Worker calls this after the side-effect succeeds. */
  async complete(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { processedAt: new Date(), lockedAt: null, lockedBy: null },
    });
  }

  /**
   * Worker calls on failure. Increments attempts + records error,
   * releases the lock so another worker (or this one on next pass)
   * can retry.
   */
  async failAttempt(id: string, err: Error): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: err.message.slice(0, 2_000),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}
