// AuditRetentionService spec — covers retention horizons, idempotency,
// pagination, failure handling, status, and shutdown drain semantics.
//
// All Prisma + RedactService interactions are mocked. Tests run in
// fake-timer mode where intervals matter, with explicit drain to keep
// the Jest worker clean.

import type { PlanTier } from '@prisma/client';

import { AuditRetentionService } from './audit-retention.service';

interface FakeAuditRow {
  id: string;
  principalId: string;
  timestamp: Date;
  redactedAt: Date | null;
}

interface FakePrincipalRow {
  id: string;
  planTier: PlanTier;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function buildFakePrisma(
  principals: FakePrincipalRow[],
  events: FakeAuditRow[],
): {
  prisma: {
    principal: { findMany: jest.Mock };
    auditEvent: { findMany: jest.Mock };
  };
  events: FakeAuditRow[];
} {
  const evRef = events;
  const prisma = {
    principal: {
      findMany: jest.fn(async (args: { where?: { id?: string }; take?: number; cursor?: { id: string }; skip?: number }) => {
        if (args.where?.id) {
          const hit = principals.find((p) => p.id === args.where!.id);
          return hit ? [hit] : [];
        }
        const ordered = [...principals].sort((a, b) => a.id.localeCompare(b.id));
        let start = 0;
        if (args.cursor) {
          const idx = ordered.findIndex((p) => p.id === args.cursor!.id);
          start = idx >= 0 ? idx + (args.skip ?? 0) : ordered.length;
        }
        return ordered.slice(start, start + (args.take ?? ordered.length));
      }),
    },
    auditEvent: {
      findMany: jest.fn(async (args: {
        where: { principalId: string; timestamp: { lt: Date }; redactedAt: null };
        take: number;
      }) => {
        const matches = evRef
          .filter(
            (e) =>
              e.principalId === args.where.principalId &&
              e.timestamp < args.where.timestamp.lt &&
              e.redactedAt === null,
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, args.take);
        return matches.map((m) => ({ id: m.id }));
      }),
    },
  };
  return { prisma, events: evRef };
}

function buildRedact(events: FakeAuditRow[], opts: { failOn?: Set<string> } = {}) {
  return {
    redactEvent: jest.fn(async (principalId: string, dto: { eventId: string; reason: string }) => {
      if (opts.failOn?.has(dto.eventId)) {
        throw new Error('simulated redact failure');
      }
      const target = events.find((e) => e.id === dto.eventId && e.principalId === principalId);
      if (target) target.redactedAt = new Date();
      return {
        eventId: dto.eventId,
        redactedFields: ['action'],
        redactedAt: new Date().toISOString(),
        metaEventId: `meta_${dto.eventId}`,
      };
    }),
  };
}

function buildMetrics() {
  const counter = { inc: jest.fn() };
  return {
    metrics: { auditRetentionEventsRedactedTotal: counter } as unknown as import('../../common/observability/metrics.service').MetricsService,
    counter,
  };
}

function buildShutdown() {
  const drains: (() => Promise<void>)[] = [];
  return {
    shutdown: {
      register: jest.fn((_name: string, fn: () => Promise<void>) => {
        drains.push(fn);
      }),
    } as unknown as import('../../common/observability/shutdown.service').ShutdownService,
    drains,
  };
}

function ev(id: string, principalId: string, ageDays: number): FakeAuditRow {
  return {
    id,
    principalId,
    timestamp: new Date(Date.now() - ageDays * DAY_MS),
    redactedAt: null,
  };
}

function makeService(args: {
  principals: FakePrincipalRow[];
  events: FakeAuditRow[];
  failOn?: Set<string>;
}): {
  svc: AuditRetentionService;
  prisma: ReturnType<typeof buildFakePrisma>['prisma'];
  redact: ReturnType<typeof buildRedact>;
  counter: { inc: jest.Mock };
  drains: (() => Promise<void>)[];
} {
  const { prisma } = buildFakePrisma(args.principals, args.events);
  const redact = buildRedact(args.events, { failOn: args.failOn });
  const { metrics, counter } = buildMetrics();
  const { shutdown, drains } = buildShutdown();
  // type-rationale: the service constructor expects concrete Nest providers,
  // but the spec injects narrow fakes that implement only the surface used
  // in this file. Casting through `unknown` keeps the test fakes minimal
  // without weakening the production types.
  const svc = new AuditRetentionService(
    prisma as unknown as import('../../common/prisma/prisma.service').PrismaService,
    redact as unknown as import('./redact.service').RedactService,
    metrics,
    shutdown,
  );
  return { svc, prisma, redact, counter, drains };
}

describe('AuditRetentionService.runOnce', () => {
  it('redacts events older than a FREE-tier principal retention horizon (30d)', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_free', planTier: 'FREE' }];
    const events: FakeAuditRow[] = [
      ev('a', 'p_free', 5),
      ev('b', 'p_free', 31),
      ev('c', 'p_free', 90),
    ];
    const { svc, redact, counter } = makeService({ principals, events });
    const result = await svc.runOnce();
    expect(result.redacted).toBe(2);
    expect(redact.redactEvent).toHaveBeenCalledTimes(2);
    expect(counter.inc).toHaveBeenCalledTimes(2);
    const reason = (redact.redactEvent.mock.calls[0]?.[1] as { reason: string }).reason;
    expect(reason).toBe('retention_policy:plan=FREE:days=30');
  });

  it('DEVELOPER (90d) redacts >90d but leaves 0-89d events untouched', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_dev', planTier: 'DEVELOPER' }];
    const events: FakeAuditRow[] = [
      ev('young', 'p_dev', 10),
      ev('young2', 'p_dev', 89),
      ev('old', 'p_dev', 95),
      ev('older', 'p_dev', 180),
    ];
    const { svc, redact } = makeService({ principals, events });
    const result = await svc.runOnce();
    expect(result.redacted).toBe(2);
    const redactedIds = redact.redactEvent.mock.calls.map((c) => (c[1] as { eventId: string }).eventId);
    expect(redactedIds.sort()).toEqual(['old', 'older']);
  });

  it('exact 95-day-old DEVELOPER event is redacted with the per-plan reason string', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_dev', planTier: 'DEVELOPER' }];
    const events: FakeAuditRow[] = [ev('e95', 'p_dev', 95)];
    const { svc, redact } = makeService({ principals, events });
    const result = await svc.runOnce();
    expect(result.redacted).toBe(1);
    expect(redact.redactEvent).toHaveBeenCalledWith(
      'p_dev',
      expect.objectContaining({
        eventId: 'e95',
        reason: 'retention_policy:plan=DEVELOPER:days=90',
      }),
    );
  });

  it('is idempotent — second runOnce skips already-redacted events', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_free', planTier: 'FREE' }];
    const events: FakeAuditRow[] = [ev('old', 'p_free', 60)];
    const { svc, redact } = makeService({ principals, events });
    const first = await svc.runOnce();
    expect(first.redacted).toBe(1);
    const second = await svc.runOnce();
    expect(second.redacted).toBe(0);
    expect(redact.redactEvent).toHaveBeenCalledTimes(1);
  });

  it('records per-principal counts in the result', async () => {
    const principals: FakePrincipalRow[] = [
      { id: 'p_a', planTier: 'FREE' },
      { id: 'p_b', planTier: 'DEVELOPER' },
    ];
    const events: FakeAuditRow[] = [
      ev('a1', 'p_a', 31),
      ev('a2', 'p_a', 60),
      ev('b1', 'p_b', 95),
    ];
    const { svc } = makeService({ principals, events });
    const result = await svc.runOnce();
    expect(result.perPrincipal.p_a?.redacted).toBe(2);
    expect(result.perPrincipal.p_b?.redacted).toBe(1);
  });

  it('paginates across >100 principals', async () => {
    const principals: FakePrincipalRow[] = Array.from({ length: 250 }, (_, i) => ({
      id: `p_${String(i).padStart(4, '0')}`,
      planTier: 'FREE',
    }));
    const events: FakeAuditRow[] = principals.map((p) => ev(`evt_${p.id}`, p.id, 60));
    const { svc, prisma } = makeService({ principals, events });
    const result = await svc.runOnce();
    expect(result.redacted).toBe(250);
    // Three principal pages: 100 + 100 + 50.
    expect(prisma.principal.findMany).toHaveBeenCalledTimes(3);
  });

  it('continues past a single redact failure and reports it', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_free', planTier: 'FREE' }];
    const events: FakeAuditRow[] = [
      ev('a', 'p_free', 60),
      ev('b', 'p_free', 60),
      ev('c', 'p_free', 60),
    ];
    const { svc, counter } = makeService({
      principals,
      events,
      failOn: new Set(['b']),
    });
    const result = await svc.runOnce();
    expect(result.redacted).toBe(2);
    expect(result.failed).toBe(1);
    expect(counter.inc).toHaveBeenCalledTimes(2);
  });

  it('honors --principal-id (single-principal mode) without scanning others', async () => {
    const principals: FakePrincipalRow[] = [
      { id: 'p_a', planTier: 'FREE' },
      { id: 'p_b', planTier: 'FREE' },
    ];
    const events: FakeAuditRow[] = [
      ev('a1', 'p_a', 60),
      ev('b1', 'p_b', 60),
    ];
    const { svc, redact } = makeService({ principals, events });
    const result = await svc.runOnce({ principalId: 'p_a' });
    expect(result.redacted).toBe(1);
    expect(redact.redactEvent).toHaveBeenCalledTimes(1);
    expect(redact.redactEvent).toHaveBeenCalledWith(
      'p_a',
      expect.objectContaining({ eventId: 'a1' }),
    );
  });

  it('respects maxEvents cap', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_free', planTier: 'FREE' }];
    const events: FakeAuditRow[] = Array.from({ length: 10 }, (_, i) =>
      ev(`e_${String(i).padStart(2, '0')}`, 'p_free', 60),
    );
    const { svc } = makeService({ principals, events });
    const result = await svc.runOnce({ maxEvents: 3 });
    expect(result.redacted).toBe(3);
  });

  it('dryRun does not invoke redactEvent but still counts what would happen', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_free', planTier: 'FREE' }];
    const events: FakeAuditRow[] = [ev('e', 'p_free', 60)];
    const { svc, redact, counter } = makeService({ principals, events });
    const result = await svc.runOnce({ dryRun: true });
    expect(result.redacted).toBe(1);
    expect(redact.redactEvent).not.toHaveBeenCalled();
    expect(counter.inc).not.toHaveBeenCalled();
  });
});

describe('AuditRetentionService.getStatus', () => {
  it('returns null fields before first run, populated after', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_free', planTier: 'FREE' }];
    const events: FakeAuditRow[] = [ev('e', 'p_free', 60)];
    const { svc } = makeService({ principals, events });
    const before = svc.getStatus();
    expect(before.lastRunAt).toBeNull();
    expect(before.lastRunDurationMs).toBeNull();
    expect(before.lastRunRedactedCount).toBeNull();
    expect(before.nextRunAt).toBeInstanceOf(Date);
    await svc.runOnce();
    const after = svc.getStatus();
    expect(after.lastRunAt).toBeInstanceOf(Date);
    expect(after.lastRunRedactedCount).toBe(1);
    expect(typeof after.lastRunDurationMs).toBe('number');
  });
});

describe('AuditRetentionService.drain', () => {
  it('clears the interval registered on init and is idempotent', async () => {
    const principals: FakePrincipalRow[] = [];
    const events: FakeAuditRow[] = [];
    const { svc, drains } = makeService({ principals, events });
    svc.onModuleInit();
    expect(drains.length).toBe(1); // shutdown registration happened
    await svc.drain();
    await svc.drain(); // double-call must not throw
  });

  it('awaits an in-flight runOnce on drain', async () => {
    const principals: FakePrincipalRow[] = [{ id: 'p_free', planTier: 'FREE' }];
    const events: FakeAuditRow[] = [ev('e', 'p_free', 60)];
    const { svc } = makeService({ principals, events });
    svc.onModuleInit();
    const running = svc.runOnce();
    await svc.drain();
    const result = await running;
    expect(result.redacted).toBe(1);
  });
});
