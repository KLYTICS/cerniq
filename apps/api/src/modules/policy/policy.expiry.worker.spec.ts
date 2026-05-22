// Unit-level test for PolicyExpiryWorker.sweep().
// We bypass BullMQ entirely and test the SELECT → UPDATE → fan-out
// orchestration with mocks. The full BullMQ schedule path is covered by
// the e2e harness.

import { PolicyExpiryWorker } from './policy.expiry.worker';

describe('PolicyExpiryWorker.sweep', () => {
  let prisma: {
    agentPolicy: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let webhooks: { enqueue: jest.Mock };
  let metrics: { policyExpiredSweptTotal: { inc: jest.Mock } };
  let config: { redisUrl: string };
  let worker: PolicyExpiryWorker;

  beforeEach(() => {
    prisma = {
      agentPolicy: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    webhooks = { enqueue: jest.fn().mockResolvedValue(undefined) };
    metrics = { policyExpiredSweptTotal: { inc: jest.fn() } };
    config = { redisUrl: 'redis://localhost:6379' };
    worker = new PolicyExpiryWorker(
      prisma as never,
      config as never,
      metrics as never,
      webhooks as never,
    );
  });

  it('returns swept=0 with no DB writes when nothing has expired', async () => {
    prisma.agentPolicy.findMany.mockResolvedValue([]);
    const result = await worker.sweep();
    expect(result).toEqual({ swept: 0, errors: 0 });
    expect(prisma.agentPolicy.updateMany).not.toHaveBeenCalled();
    expect(webhooks.enqueue).not.toHaveBeenCalled();
  });

  it('revokes expired policies and fires aegis.agent.policy_expired per row', async () => {
    const expiredAt = new Date('2026-04-01T00:00:00Z');
    prisma.agentPolicy.findMany.mockResolvedValue([
      {
        id: 'pol_1',
        agentId: 'agt_1',
        expiresAt: expiredAt,
        agent: { principalId: 'prn_1' },
      },
      {
        id: 'pol_2',
        agentId: 'agt_2',
        expiresAt: expiredAt,
        agent: { principalId: 'prn_2' },
      },
    ]);
    prisma.agentPolicy.updateMany.mockResolvedValue({ count: 2 });

    const result = await worker.sweep();

    expect(result.swept).toBe(2);
    expect(result.errors).toBe(0);

    // Update guarded by `revokedAt: null` to avoid clobbering manual revokes.
    expect(prisma.agentPolicy.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pol_1', 'pol_2'] }, revokedAt: null },
      data: { revokedAt: expect.any(Date), status: 'REVOKED' },
    });

    expect(webhooks.enqueue).toHaveBeenCalledTimes(2);
    expect(webhooks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'aegis.agent.policy_expired',
        data: expect.objectContaining({ policyId: 'pol_1', agentId: 'agt_1' }),
      }),
      'prn_1',
    );
    expect(metrics.policyExpiredSweptTotal.inc).toHaveBeenCalledWith({ outcome: 'swept' }, 2);
  });

  it('counts webhook fan-out errors without rolling back the revocation', async () => {
    prisma.agentPolicy.findMany.mockResolvedValue([
      {
        id: 'pol_3',
        agentId: 'agt_3',
        expiresAt: new Date('2026-04-01T00:00:00Z'),
        agent: { principalId: 'prn_3' },
      },
    ]);
    prisma.agentPolicy.updateMany.mockResolvedValue({ count: 1 });
    webhooks.enqueue.mockRejectedValue(new Error('webhook downstream timeout'));

    const result = await worker.sweep();

    expect(result.swept).toBe(1);
    expect(result.errors).toBe(1);
    // Revocation was not rolled back — verify hot path still gates expiry.
    expect(prisma.agentPolicy.updateMany).toHaveBeenCalled();
    // Both outcome buckets emit: swept (durable revocation) + webhook_error
    // (best-effort fan-out). Without the second emit, operators have to
    // scrape log lines to alert on webhook delivery failures.
    expect(metrics.policyExpiredSweptTotal.inc).toHaveBeenCalledWith({ outcome: 'swept' }, 1);
    expect(metrics.policyExpiredSweptTotal.inc).toHaveBeenCalledWith(
      { outcome: 'webhook_error' },
      1,
    );
  });
});
