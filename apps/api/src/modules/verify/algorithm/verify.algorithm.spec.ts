import { verifyAlgorithm } from './verify.algorithm';
import type {
  AgentSnapshot,
  PolicySnapshot,
  VerifyAlgorithmInput,
  VerifyPorts,
} from './verify.ports';

const RP_PRINCIPAL = 'rp_principal_1';

function makePorts(overrides: Partial<VerifyPorts> = {}): {
  ports: VerifyPorts;
  recordedAudit: unknown[];
  recordedSignals: unknown[];
  consumedJtis: string[];
} {
  const recordedAudit: unknown[] = [];
  const recordedSignals: unknown[] = [];
  const consumedJtis: string[] = [];
  let auditCounter = 0;
  const base: VerifyPorts = {
    now: () => new Date('2026-05-02T12:00:00.000Z'),
    getAgent: async () => null,
    getPolicy: async () => null,
    verifyJwt: async () => ({ sub: 'agt_1', pid: 'pol_1', iat: 0, exp: 9_999_999_999, jti: 'j' }),
    decodeJwtUnsafe: () => ({ sub: 'agt_1', pid: 'pol_1', iat: 0, exp: 9_999_999_999, jti: 'j' }),
    consumeJti: async (jti) => {
      if (consumedJtis.includes(jti)) return false;
      consumedJtis.push(jti);
      return true;
    },
    checkSpend: async () => true,
    recordSpend: () => {},
    recordAudit: async (e) => {
      recordedAudit.push(e);
      auditCounter += 1;
      return `evt_${auditCounter}`;
    },
    ingestSignal: (s) => {
      recordedSignals.push(s);
    },
    touchAgent: () => {},
  };
  return { ports: { ...base, ...overrides }, recordedAudit, recordedSignals, consumedJtis };
}

const baseInput = (extras: Partial<VerifyAlgorithmInput> = {}): VerifyAlgorithmInput => ({
  token: 't',
  relyingPartyPrincipalId: RP_PRINCIPAL,
  ...extras,
});

const ACTIVE_AGENT: AgentSnapshot = {
  id: 'agt_1',
  publicKey: 'pk_1',
  status: 'ACTIVE',
  trustScore: 720,
  trustBand: 'VERIFIED',
  principalId: 'p_1',
};

const ACTIVE_POLICY: PolicySnapshot = {
  id: 'pol_1',
  status: 'ACTIVE',
  expiresAt: new Date('2026-05-03T12:00:00.000Z').toISOString(),
  scopes: [
    {
      category: 'commerce',
      allowedDomains: ['delta.com'],
      spendLimit: { currency: 'USD', maxPerTransaction: 500, maxPerDay: 1000 },
    },
  ],
};

describe('verifyAlgorithm', () => {
  it('returns INVALID_SIGNATURE on malformed token', async () => {
    const { ports } = makePorts({ decodeJwtUnsafe: () => null });
    const r = await verifyAlgorithm(baseInput({ token: 'garbage' }), ports);
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('audits AGENT_NOT_FOUND under the relying-party principal (no fabrication)', async () => {
    const { ports, recordedAudit } = makePorts();
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.denialReason).toBe('AGENT_NOT_FOUND');
    expect(r.principalId).toBeNull();
    expect(recordedAudit).toHaveLength(1);
    const row = recordedAudit[0] as { principalId: string; agentId: string | null };
    expect(row.principalId).toBe(RP_PRINCIPAL);
    expect(row.agentId).toBeNull();
  });

  it('returns AGENT_REVOKED before signature check', async () => {
    const { ports } = makePorts({ getAgent: async () => ({ ...ACTIVE_AGENT, status: 'REVOKED' }) });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.denialReason).toBe('AGENT_REVOKED');
  });

  it('returns INVALID_SIGNATURE when signature verify fails', async () => {
    const { ports } = makePorts({ getAgent: async () => ACTIVE_AGENT, verifyJwt: async () => null });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('rejects token replay via consumeJti', async () => {
    const { ports } = makePorts({
      getAgent: async () => ACTIVE_AGENT,
      getPolicy: async () => ACTIVE_POLICY,
      // First call true, second false (replay).
      consumeJti: jest
        .fn<Promise<boolean>, [string, number]>()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    const r1 = await verifyAlgorithm(
      baseInput({ action: 'commerce.purchase', amount: 100, merchantDomain: 'delta.com' }),
      ports,
    );
    expect(r1.valid).toBe(true);

    const r2 = await verifyAlgorithm(
      baseInput({ action: 'commerce.purchase', amount: 100, merchantDomain: 'delta.com' }),
      ports,
    );
    expect(r2.valid).toBe(false);
    expect(r2.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('fails closed (ANOMALY_FLAGGED) when consumeJti throws', async () => {
    const { ports } = makePorts({
      getAgent: async () => ACTIVE_AGENT,
      getPolicy: async () => ACTIVE_POLICY,
      consumeJti: async () => {
        throw new Error('redis down');
      },
    });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.denialReason).toBe('ANOMALY_FLAGGED');
  });

  it('returns POLICY_REVOKED before POLICY_EXPIRED', async () => {
    const { ports } = makePorts({
      getAgent: async () => ACTIVE_AGENT,
      getPolicy: async () => ({ ...ACTIVE_POLICY, status: 'REVOKED' }),
    });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.denialReason).toBe('POLICY_REVOKED');
  });

  it('returns SCOPE_NOT_GRANTED when domain blocked', async () => {
    const { ports } = makePorts({
      getAgent: async () => ACTIVE_AGENT,
      getPolicy: async () => ACTIVE_POLICY,
    });
    const r = await verifyAlgorithm(
      baseInput({ action: 'commerce.purchase', amount: 100, merchantDomain: 'evil.example' }),
      ports,
    );
    expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('returns SPEND_LIMIT_EXCEEDED when checkSpend rejects', async () => {
    const { ports } = makePorts({
      getAgent: async () => ACTIVE_AGENT,
      getPolicy: async () => ACTIVE_POLICY,
      checkSpend: async () => false,
    });
    const r = await verifyAlgorithm(
      baseInput({ action: 'commerce.purchase', amount: 100, merchantDomain: 'delta.com' }),
      ports,
    );
    expect(r.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
  });

  it('returns TRUST_SCORE_TOO_LOW when minTrustScore exceeds agent score', async () => {
    const { ports } = makePorts({
      getAgent: async () => ({ ...ACTIVE_AGENT, trustScore: 600 }),
      getPolicy: async () => ACTIVE_POLICY,
    });
    const r = await verifyAlgorithm(baseInput({ minTrustScore: 700 }), ports);
    expect(r.denialReason).toBe('TRUST_SCORE_TOO_LOW');
  });

  it('returns ANOMALY_FLAGGED when agent.flagged is true', async () => {
    const { ports } = makePorts({
      getAgent: async () => ({ ...ACTIVE_AGENT, flagged: true }),
      getPolicy: async () => ACTIVE_POLICY,
    });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.denialReason).toBe('ANOMALY_FLAGGED');
  });

  it('approves a valid request and emits side effects + auditEventId', async () => {
    const { ports, recordedAudit, recordedSignals } = makePorts({
      getAgent: async () => ACTIVE_AGENT,
      getPolicy: async () => ACTIVE_POLICY,
    });
    const r = await verifyAlgorithm(
      baseInput({
        action: 'commerce.purchase',
        amount: 100,
        merchantDomain: 'delta.com',
        currency: 'USD',
      }),
      ports,
    );
    expect(r.valid).toBe(true);
    expect(r.trustScore).toBe(720);
    expect(r.scopesGranted).toEqual(['commerce']);
    expect(r.auditEventId).toBe('evt_1');
    expect(recordedAudit).toHaveLength(1);
    expect(recordedSignals).toHaveLength(1);
  });

  it('latencyMs is non-negative and uses ports.now()', async () => {
    const { ports } = makePorts({ decodeJwtUnsafe: () => null });
    const r = await verifyAlgorithm(baseInput({ token: 'garbage' }), ports);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
