import { OnboardingService } from './onboarding.service';

function build(opts: { existingRow?: Record<string, unknown> } = {}) {
  const upsertCalls: Array<{ where: unknown; create: unknown; update: unknown }> = [];
  const prisma = {
    principalOnboarding: {
      upsert: jest.fn(async (args: { where: unknown; create: unknown; update: unknown }) => {
        upsertCalls.push(args);
        return opts.existingRow ?? {
          principalId: 'p_1',
          hasFirstAgent: false,
          hasFirstPolicy: false,
          hasFirstVerify: false,
          hasKmsConfigured: false,
          hasMcpServerRegistered: false,
          hasWebhookSubscribed: false,
          hasPaymentMethodAdded: false,
          firstAgentAt: null, firstPolicyAt: null, firstVerifyAt: null,
          kmsConfiguredAt: null, firstMcpServerAt: null, firstWebhookAt: null, paymentMethodAt: null,
        };
      }),
      findUnique: jest.fn(async () => opts.existingRow ?? null),
    },
  };
  return { svc: new OnboardingService(prisma as never), prisma, upsertCalls };
}

describe('OnboardingService.getStatus', () => {
  it('lazy-creates a row on first read', async () => {
    const { svc, prisma } = build();
    const r = await svc.getStatus('p_1');
    expect(prisma.principalOnboarding.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { principalId: 'p_1' },
      create: { principalId: 'p_1' },
      update: {},
    }));
    expect(r.principalId).toBe('p_1');
    expect(r.completed).toBe(0);
    expect(r.total).toBe(7);
  });

  it('reports completed count and per-step timestamps', async () => {
    const ts = new Date('2026-04-01T00:00:00Z');
    const { svc } = build({
      existingRow: {
        principalId: 'p_1',
        hasFirstAgent: true, hasFirstPolicy: true, hasFirstVerify: false,
        hasKmsConfigured: false, hasMcpServerRegistered: false,
        hasWebhookSubscribed: false, hasPaymentMethodAdded: false,
        firstAgentAt: ts, firstPolicyAt: ts, firstVerifyAt: null,
        kmsConfiguredAt: null, firstMcpServerAt: null, firstWebhookAt: null, paymentMethodAt: null,
      },
    });
    const r = await svc.getStatus('p_1');
    expect(r.completed).toBe(2);
    expect(r.steps.hasFirstAgent).toBe(true);
    expect(r.timestamps.firstAgentAt).toBe(ts.toISOString());
    expect(r.timestamps.firstVerifyAt).toBeNull();
  });
});

describe('OnboardingService.markStep', () => {
  it('upserts the step boolean to true', async () => {
    const { svc, prisma } = build();
    await svc.markStep('p_1', 'hasFirstAgent');
    const calls = prisma.principalOnboarding.upsert.mock.calls;
    // Last upsert should set hasFirstAgent: true.
    const last = calls[calls.length - 1]?.[0] as { create: Record<string, unknown> };
    expect(last.create.hasFirstAgent).toBe(true);
    expect(last.create.firstAgentAt).toBeInstanceOf(Date);
  });

  it('rejects unknown step name', async () => {
    const { svc } = build();
    await expect(svc.markStep('p_1', 'bogusStep' as never)).rejects.toThrow(/unknown step/);
  });

  it('preserves an already-set timestamp on second markStep (one-way ratchet)', async () => {
    const past = new Date('2026-04-01T00:00:00Z');
    const { svc, prisma } = build({
      existingRow: {
        principalId: 'p_1',
        hasFirstAgent: true,
        firstAgentAt: past,
      },
    });
    await svc.markStep('p_1', 'hasFirstAgent');
    // Second markStep should still upsert (idempotent), but the update
    // body should NOT include `firstAgentAt` (preserved).
    const last = prisma.principalOnboarding.upsert.mock.calls[
      prisma.principalOnboarding.upsert.mock.calls.length - 1
    ]?.[0] as { update: Record<string, unknown> };
    expect(last.update.hasFirstAgent).toBe(true);
    expect(last.update.firstAgentAt).toBeUndefined();
  });
});
