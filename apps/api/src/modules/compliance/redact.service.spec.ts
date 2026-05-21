import { NotFoundException } from '@nestjs/common';

import { RedactService } from './redact.service';

function build(opts: {
  findFirst?: unknown;
  updateManyCount?: number;
} = {}) {
  const prisma = {
    auditEvent: {
      findFirst: jest.fn(async () => opts.findFirst ?? null),
      update: jest.fn(async () => ({ id: 'evt_1' })),
      updateMany: jest.fn(async () => ({ count: opts.updateManyCount ?? 0 })),
    },
  };
  const audit = { append: jest.fn(async () => 'evt_meta_1') };
  return { svc: new RedactService(prisma as never, audit as never), prisma, audit };
}

describe('RedactService.redactEvent', () => {
  it('throws 404 when event not found', async () => {
    const { svc } = build({ findFirst: null });
    await expect(svc.redactEvent('p_1', { eventId: 'e', reason: 'gdpr' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 404 when event belongs to another principal', async () => {
    // findFirst returns null because the WHERE includes principalId — no leak.
    const { svc, prisma } = build({ findFirst: null });
    await expect(svc.redactEvent('p_1', { eventId: 'e', reason: 'gdpr' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.auditEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e', principalId: 'p_1' } }),
    );
  });

  it('redacts a fresh event and writes a meta-event', async () => {
    const { svc, prisma, audit } = build({
      findFirst: { id: 'evt_x', redactedAt: null, agentId: 'agt_1' },
    });
    const r = await svc.redactEvent('p_1', { eventId: 'evt_x', reason: 'art17 user request' });
    expect(r.eventId).toBe('evt_x');
    expect(r.redactedFields.length).toBeGreaterThan(0);
    expect(r.metaEventId).toBe('evt_meta_1');
    expect(prisma.auditEvent.update).toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'audit.redact' }));
  });

  it('is idempotent on already-redacted event (no second update)', async () => {
    const past = new Date('2026-04-01T00:00:00Z');
    const { svc, prisma, audit } = build({
      findFirst: { id: 'evt_x', redactedAt: past, agentId: 'agt_1' },
    });
    const r = await svc.redactEvent('p_1', { eventId: 'evt_x', reason: 'gdpr' });
    expect(prisma.auditEvent.update).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalled(); // meta-event still recorded
    expect(r.redactedAt).toBe(past.toISOString());
  });

  it('respects custom field selection', async () => {
    const { svc, prisma } = build({
      findFirst: { id: 'evt_x', redactedAt: null, agentId: null },
    });
    await svc.redactEvent('p_1', { eventId: 'evt_x', reason: 'gdpr', fields: ['action'] });
    const updateCall = (prisma.auditEvent.update as unknown as jest.Mock).mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(updateCall.data.action).toBeNull();
    expect(updateCall.data.relyingParty).toBeUndefined();
  });
});

describe('RedactService.redactByAgent', () => {
  it('redacts every event for an agent and writes one bulk meta-event', async () => {
    const { svc, prisma, audit } = build({ updateManyCount: 7 });
    const r = await svc.redactByAgent('p_1', { agentId: 'agt_x', reason: 'account_delete' });
    expect(r.eventsRedacted).toBe(7);
    expect(prisma.auditEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agentId: 'agt_x', principalId: 'p_1', redactedAt: null } }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'audit.redact_bulk' }),
    );
  });
});
