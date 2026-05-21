import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';

import { SpendGuardService, type SpendLimit } from './spend-guard.service';

describe('SpendGuardService.check', () => {
  function build(redisValues: Record<string, number>, postgresAggregates: Record<string, number> = {}) {
    const redis = {
      get: jest.fn(async (k: string) => redisValues[k] ?? null),
      set: jest.fn(async () => 'OK'),
      incrBy: jest.fn(async () => 0),
    } as unknown as RedisService;
    const prisma = {
      spendRecord: {
        create: jest.fn(),
        // Fail-closed (audit ae59f056): on Redis miss the service queries
        // Postgres for the durable spend aggregate. Tests provide the
        // expected aggregate via `postgresAggregates` keyed by dateKey/monthKey.
        aggregate: jest.fn(async ({ where }: { where: { dateKey?: string; monthKey?: string } }) => {
          const key = where.dateKey ?? where.monthKey ?? '';
          return { _sum: { amount: postgresAggregates[key] ?? 0 } };
        }),
      },
    } as unknown as PrismaService;
    return new SpendGuardService(redis, prisma);
  }

  const limit = (overrides: Partial<SpendLimit> = {}): SpendLimit => ({
    currency: 'USD',
    maxPerTransaction: 500,
    maxPerDay: 1000,
    maxPerMonth: 5000,
    ...overrides,
  });

  it('rejects an amount over per-transaction cap', async () => {
    const sg = build({});
    const r = await sg.check('a', 'p', 600, 'USD', limit());
    expect(r.allowed).toBe(false);
  });

  it('approves an amount under all caps with empty Redis', async () => {
    const sg = build({});
    const r = await sg.check('a', 'p', 100, 'USD', limit());
    expect(r.allowed).toBe(true);
    expect(r.remainingDay).toBe(900);
    expect(r.remainingMonth).toBe(4900);
  });

  it('rejects when daily cumulative exceeds maxPerDay', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);
    const sg = build({
      [`spend:day:a:p:${today}`]: 950,
      [`spend:month:a:p:${month}`]: 950,
    });
    const r = await sg.check('a', 'p', 100, 'USD', limit());
    expect(r.allowed).toBe(false);
  });

  it('rejects when monthly cumulative exceeds maxPerMonth', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);
    const sg = build({
      [`spend:day:a:p:${today}`]: 0,
      [`spend:month:a:p:${month}`]: 4990,
    });
    const r = await sg.check('a', 'p', 50, 'USD', limit());
    expect(r.allowed).toBe(false);
  });

  it('treats undefined caps as unlimited', async () => {
    const sg = build({});
    const r = await sg.check('a', 'p', 9_999_999, 'USD', { currency: 'USD' });
    expect(r.allowed).toBe(true);
  });
});
