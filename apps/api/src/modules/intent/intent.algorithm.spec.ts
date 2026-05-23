// Pure algorithm tests — exercise the issuance + reconciliation logic
// against an in-memory IntentPorts fixture. No NestJS, no Prisma, no
// Redis. Mirrors the test style of
// `apps/api/src/modules/verify/algorithm/verify.algorithm.spec.ts`.

import {
  signManifest as kernelSign,
  type IntentClaim,
  type ReconciliationResult,
  type SignedIntentManifest,
} from '@aegis/intent-manifest';

import {
  issueManifest,
  reconcileActuals,
} from './intent.algorithm';
import {
  IntentAlgorithmException,
  type IntentPorts,
  type IntentAuditAppendInput,
  type IntentBateSignalInput,
  type ManifestSnapshot,
} from './intent.ports';

const FIXED_PRIV = new Uint8Array(32).fill(7);
const FIXED_KID = 'intent-test-kid';

function buildPorts(initialClock = 1_700_000_000_000): {
  ports: IntentPorts;
  spy: {
    audits: IntentAuditAppendInput[];
    signals: IntentBateSignalInput[];
    saveCount: number;
    reconcileSaveCount: number;
    advanceClock: (ms: number) => void;
  };
} {
  const manifests = new Map<string, ManifestSnapshot>();
  const reconciliations = new Map<string, { idempotencyKey: string; result: ReconciliationResult; actuals: unknown }>();
  const audits: IntentAuditAppendInput[] = [];
  const signals: IntentBateSignalInput[] = [];
  let clock = initialClock;
  let nextAuditId = 1;

  const ports: IntentPorts = {
    async signManifest(body) {
      return kernelSign(body, FIXED_PRIV, FIXED_KID);
    },
    async saveManifest(snapshot) {
      if (manifests.has(snapshot.manifestId)) {
        throw new IntentAlgorithmException({
          kind: 'manifest_collision',
          manifestId: snapshot.manifestId,
        });
      }
      manifests.set(snapshot.manifestId, {
        ...snapshot,
        status: 'OPEN',
        reconciledAt: null,
        priorResult: null,
      });
    },
    async loadManifest(id) {
      return manifests.get(id) ?? null;
    },
    async saveReconciliation(manifestId, idempotencyKey, actuals, result) {
      const prior = reconciliations.get(manifestId);
      if (prior) {
        // Body-equality on replay — per IntentPorts contract: same key
        // + different body = conflict; same key + same body = replay.
        const sameKey = prior.idempotencyKey === idempotencyKey;
        const sameBody = JSON.stringify(prior.actuals) === JSON.stringify(actuals);
        if (!sameKey || !sameBody) {
          throw new IntentAlgorithmException({
            kind: 'idempotency_conflict',
            manifestId,
            idempotencyKey,
          });
        }
        return { replay: true };
      }
      reconciliations.set(manifestId, { idempotencyKey, result, actuals });
      const snap = manifests.get(manifestId);
      if (snap) {
        manifests.set(manifestId, {
          ...snap,
          status: 'RECONCILED',
          reconciledAt: new Date(clock),
          priorResult: result,
        });
      }
      return { replay: false };
    },
    async recordAudit(event) {
      audits.push(event);
      return `audit-${nextAuditId++}`;
    },
    ingestSignal(signal) {
      signals.push(signal);
    },
    now() {
      return new Date(clock);
    },
    ttlBounds() {
      return { minSeconds: 30, maxSeconds: 60 };
    },
  };

  return {
    ports,
    spy: {
      audits,
      signals,
      get saveCount() {
        return manifests.size;
      },
      get reconcileSaveCount() {
        return reconciliations.size;
      },
      advanceClock: (ms: number) => {
        clock += ms;
      },
    },
  };
}

function commerceClaim(overrides: Partial<Extract<IntentClaim, { kind: 'commerce-action' }>> = {}): IntentClaim {
  return {
    kind: 'commerce-action',
    action: 'stripe.charge',
    maxCalls: 1,
    merchantId: 'merch_42',
    amountCap: { amount: '10.00', currency: 'USD' },
    ...overrides,
  };
}

describe('issueManifest', () => {
  it('signs + persists + audits a manifest on the happy path', async () => {
    const { ports, spy } = buildPorts();
    const out = await issueManifest(
      {
        principalId: 'prn_1',
        agentId: 'agt_1',
        verifyTokenJti: 'jti_1',
        verifyTokenSha256B64Url: 'aGVsbG8',
        intent: commerceClaim(),
      },
      ports,
      'm-1',
    );
    expect(out.manifestId).toBe('m-1');
    expect(out.signedManifest.signingKeyId).toBe(FIXED_KID);
    expect(out.expiresAt).toBeGreaterThan(0);
    expect(spy.saveCount).toBe(1);
    expect(spy.audits).toEqual([
      expect.objectContaining({ kind: 'intent.declared', manifestId: 'm-1' }),
    ]);
  });

  it('defaults strictness to "strict" when reconciliation omitted', async () => {
    const { ports } = buildPorts();
    const out = await issueManifest(
      {
        principalId: 'prn_1',
        agentId: 'agt_1',
        verifyTokenJti: 'jti_1',
        verifyTokenSha256B64Url: 'aGVsbG8',
        intent: commerceClaim(),
      },
      ports,
      'm-1',
    );
    expect(out.signedManifest.body.reconciliation.strictness).toBe('strict');
  });

  it('rejects ttl below ports.ttlBounds().minSeconds', async () => {
    const { ports } = buildPorts();
    await expect(
      issueManifest(
        {
          principalId: 'prn_1',
          agentId: 'agt_1',
          verifyTokenJti: 'jti_1',
          verifyTokenSha256B64Url: 'aGVsbG8',
          intent: commerceClaim(),
          ttlSeconds: 5,
        },
        ports,
        'm-1',
      ),
    ).rejects.toThrow(IntentAlgorithmException);
  });

  it('rejects ttl above ports.ttlBounds().maxSeconds', async () => {
    const { ports } = buildPorts();
    await expect(
      issueManifest(
        {
          principalId: 'prn_1',
          agentId: 'agt_1',
          verifyTokenJti: 'jti_1',
          verifyTokenSha256B64Url: 'aGVsbG8',
          intent: commerceClaim(),
          ttlSeconds: 600,
        },
        ports,
        'm-1',
      ),
    ).rejects.toThrow(/ttl_out_of_bounds/);
  });

  it('surfaces signing failure as signing_failed', async () => {
    const { ports } = buildPorts();
    const failingPorts: IntentPorts = {
      ...ports,
      signManifest: async () => {
        throw new Error('KMS outage');
      },
    };
    await expect(
      issueManifest(
        {
          principalId: 'prn_1',
          agentId: 'agt_1',
          verifyTokenJti: 'jti_1',
          verifyTokenSha256B64Url: 'aGVsbG8',
          intent: commerceClaim(),
        },
        failingPorts,
        'm-1',
      ),
    ).rejects.toThrow(/signing_failed/);
  });

  it('surfaces manifest collision', async () => {
    const { ports } = buildPorts();
    await issueManifest(
      {
        principalId: 'prn_1',
        agentId: 'agt_1',
        verifyTokenJti: 'jti_1',
        verifyTokenSha256B64Url: 'aGVsbG8',
        intent: commerceClaim(),
      },
      ports,
      'm-collide',
    );
    await expect(
      issueManifest(
        {
          principalId: 'prn_1',
          agentId: 'agt_1',
          verifyTokenJti: 'jti_2',
          verifyTokenSha256B64Url: 'd29ybGQ',
          intent: commerceClaim(),
        },
        ports,
        'm-collide',
      ),
    ).rejects.toThrow(/manifest_collision/);
  });
});

describe('reconcileActuals', () => {
  async function issueAndGet(ports: IntentPorts, manifestId = 'm-1'): Promise<SignedIntentManifest> {
    const out = await issueManifest(
      {
        principalId: 'prn_1',
        agentId: 'agt_1',
        verifyTokenJti: 'jti_1',
        verifyTokenSha256B64Url: 'aGVsbG8',
        intent: commerceClaim(),
      },
      ports,
      manifestId,
    );
    return out.signedManifest;
  }

  it('returns clean result on happy-path matching actuals', async () => {
    const { ports, spy } = buildPorts();
    await issueAndGet(ports);
    const out = await reconcileActuals(
      {
        principalId: 'prn_1',
        manifestId: 'm-1',
        idempotencyKey: 'k-1',
        actuals: [
          {
            observedAt: Math.floor(Date.now() / 1000),
            kind: 'commerce-action',
            payload: { action: 'stripe.charge', merchantId: 'merch_42', amount: '5.00' },
          },
        ],
      },
      ports,
    );
    expect(out.result.mismatches).toEqual([]);
    expect(out.result.recommendedDenialReason).toBe(null);
    expect(spy.audits.some((a) => a.kind === 'intent.reconciled')).toBe(true);
    expect(spy.audits.filter((a) => a.kind === 'intent.mismatch')).toHaveLength(0);
    expect(spy.signals).toHaveLength(0);
  });

  it('emits one intent.mismatch audit per mismatch + BATE signal on strict denial', async () => {
    const { ports, spy } = buildPorts();
    await issueAndGet(ports);
    const out = await reconcileActuals(
      {
        principalId: 'prn_1',
        manifestId: 'm-1',
        idempotencyKey: 'k-1',
        actuals: [
          {
            observedAt: Math.floor(Date.now() / 1000),
            kind: 'commerce-action',
            payload: { action: 'stripe.charge', merchantId: 'attacker_merch', amount: '999.00' },
          },
        ],
      },
      ports,
    );
    expect(out.result.recommendedDenialReason).toBe('INTENT_MISMATCH');
    expect(spy.audits.filter((a) => a.kind === 'intent.mismatch').length).toBeGreaterThanOrEqual(2);
    expect(spy.signals).toHaveLength(1);
    expect(spy.signals[0]!.signalType).toBe('INTENT_MISMATCH_OBSERVED');
  });

  it('honors idempotency: replay returns prior result + flags idempotencyReplay', async () => {
    const { ports, spy } = buildPorts();
    await issueAndGet(ports);
    const actuals = [
      {
        observedAt: Math.floor(Date.now() / 1000),
        kind: 'commerce-action' as const,
        payload: { action: 'stripe.charge', merchantId: 'merch_42', amount: '5.00' },
      },
    ];
    const first = await reconcileActuals(
      { principalId: 'prn_1', manifestId: 'm-1', idempotencyKey: 'k-1', actuals },
      ports,
    );
    const second = await reconcileActuals(
      { principalId: 'prn_1', manifestId: 'm-1', idempotencyKey: 'k-1', actuals },
      ports,
    );
    expect(first.idempotencyReplay).toBe(false);
    expect(second.idempotencyReplay).toBe(true);
    // Second call should NOT have appended new mismatch audits (replay path).
    expect(spy.audits.filter((a) => a.kind === 'intent.mismatch')).toHaveLength(0);
    expect(spy.signals).toHaveLength(0);
  });

  it('idempotency conflict on different actuals + same key', async () => {
    const { ports } = buildPorts();
    await issueAndGet(ports);
    await reconcileActuals(
      {
        principalId: 'prn_1',
        manifestId: 'm-1',
        idempotencyKey: 'k-1',
        actuals: [
          {
            observedAt: Math.floor(Date.now() / 1000),
            kind: 'commerce-action',
            payload: { action: 'stripe.charge', merchantId: 'merch_42', amount: '5.00' },
          },
        ],
      },
      ports,
    );
    await expect(
      reconcileActuals(
        {
          principalId: 'prn_1',
          manifestId: 'm-1',
          idempotencyKey: 'k-1',
          actuals: [
            {
              observedAt: Math.floor(Date.now() / 1000),
              kind: 'commerce-action',
              payload: { action: 'stripe.charge', merchantId: 'attacker', amount: '5.00' },
            },
          ],
        },
        ports,
      ),
    ).rejects.toThrow(/idempotency_conflict/);
  });

  it('rejects unknown manifest with manifest_not_found', async () => {
    const { ports } = buildPorts();
    await expect(
      reconcileActuals(
        {
          principalId: 'prn_1',
          manifestId: 'm-unknown',
          idempotencyKey: 'k-1',
          actuals: [],
        },
        ports,
      ),
    ).rejects.toThrow(/manifest_not_found/);
  });

  it('rejects cross-tenant access with tenant_mismatch', async () => {
    const { ports } = buildPorts();
    await issueAndGet(ports);
    await expect(
      reconcileActuals(
        {
          principalId: 'prn_OTHER',
          manifestId: 'm-1',
          idempotencyKey: 'k-1',
          actuals: [],
        },
        ports,
      ),
    ).rejects.toThrow(/tenant_mismatch/);
  });
});
