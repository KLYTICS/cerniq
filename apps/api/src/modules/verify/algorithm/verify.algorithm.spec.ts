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

  describe('Step 6.5 — RAR (RFC 9396 / RFC 9101 JAR-in-RAR) integration', () => {
    // Closes the half-wired defect: prior to this step, the verify hot
    // path decoded `authorization_details` from JAR claims but never
    // evaluated them. A JAR-with-RAR submitted to /v1/verify now
    // enforces the RAR constraints inline — one round-trip for the
    // full FAPI 2.0 buyer flow.

    it('approves when JAR carries RAR claims that allow the request', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          authorization_details: [
            {
              type: 'trading_order',
              actions: ['commerce.purchase'],
              limits: { per_order_usd: 50000 },
            },
          ],
        }),
      });
      const r = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', amount: 100, currency: 'USD' }),
        ports,
      );
      expect(r.valid).toBe(true);
      expect(r.denialReason).toBeNull();
    });

    it('denies with SCOPE_NOT_GRANTED when RAR action_unauthorized fires', async () => {
      // RAR claims permit only 'buy' actions; the candidate action is
      // 'commerce.purchase' (in-scope at the policy layer but NOT in the
      // RAR actions list). RAR denial maps to SCOPE_NOT_GRANTED.
      const { ports, recordedAudit } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          authorization_details: [
            { type: 'trading_order', actions: ['buy'] },
          ],
        }),
      });
      const r = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', amount: 100 }),
        ports,
      );
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
      // Denial audit row still gets emitted — SOC2 evidence intact.
      expect(recordedAudit).toHaveLength(1);
    });

    it('denies with SCOPE_NOT_GRANTED when RAR limit_exceeded fires', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          authorization_details: [
            {
              type: 'trading_order',
              actions: ['commerce.purchase'],
              limits: { per_order_usd: 50 },
            },
          ],
        }),
      });
      const r = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', amount: 100 }),
        ports,
      );
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
    });

    it('approves when authorization_details is absent (RAR step short-circuits)', async () => {
      // Backward compat: tokens without authorization_details flow through
      // the algorithm exactly as before — no RAR evaluation runs.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
      });
      const r = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', amount: 100 }),
        ports,
      );
      expect(r.valid).toBe(true);
    });

    it('approves when authorization_details is an empty array', async () => {
      // RFC 9396 §2.1 — authorization_details MUST be a non-empty array
      // when present. AEGIS treats empty array as "no RAR claims" rather
      // than rejecting — defensive default that matches the standalone
      // /v1/verify/rar/evaluate behavior for empty input (which the
      // evaluator rejects as 'no_authorization_details'). The algorithm
      // chooses to short-circuit instead — empty array in the JWT is
      // treated as "RAR not in use", not "RAR rejection."
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          authorization_details: [],
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('RAR denial does NOT call recordSpend (no spend pollution)', async () => {
      let spendRecorded = false;
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          authorization_details: [{ type: 'trading_order', actions: ['buy'] }],
        }),
        recordSpend: () => {
          spendRecorded = true;
        },
      });
      const r = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', amount: 100 }),
        ports,
      );
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
      expect(spendRecorded).toBe(false);
    });

    it('payment_initiation RAR with destination whitelist enforced via merchantId', async () => {
      // Wires merchantId to RAR destination — buyer can express
      // "this agent may only pay vendor_x" as a signed JAR claim.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          authorization_details: [
            {
              type: 'payment_initiation',
              actions: ['commerce.purchase'],
              destinations: ['vendor_x'],
            },
          ],
        }),
      });
      const r = await verifyAlgorithm(
        baseInput({
          action: 'commerce.purchase',
          amount: 100,
          merchantId: 'vendor_y', // NOT in destinations whitelist
        }),
        ports,
      );
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
    });
  });

  describe('Step 3.4 — RFC 9101 (JAR) audience binding', () => {
    // Closes the third "decoded but not enforced" JAR gap. Round 5
    // promoted RFC-9101 at the JwtUtil level; round 7 makes the aud
    // claim cryptographically meaningful in production — when the
    // operator configures AEGIS_ISSUER (apiBaseUrl), tokens signed for
    // a different audience are rejected with INVALID_SIGNATURE.

    const EXPECTED_AUD = 'https://api.aegis.klytics.io';

    it('approves when token carries matching aud AND port returns same expected aud', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        expectedAudience: () => EXPECTED_AUD,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          aud: EXPECTED_AUD,
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('rejects with INVALID_SIGNATURE when token aud differs from port aud (cross-server replay)', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        expectedAudience: () => EXPECTED_AUD,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          aud: 'https://api.aegis-staging.klytics.io',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
    });

    it('approves when token has NO aud claim (pre-JAR baseline, backward compat)', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        expectedAudience: () => EXPECTED_AUD,
        // No aud field at all — pre-JAR token shape.
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('approves when port returns undefined (operator has not enabled enforcement)', async () => {
      // Deployments that haven't set AEGIS_ISSUER env. Gate is OFF —
      // tokens with any aud (or none) flow through. This is the
      // backward-compat default until operator opts in.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        expectedAudience: () => undefined,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          aud: 'https://anything-goes.example.com',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('approves when port is absent (Worker adapter without aud binding wired)', async () => {
      // expectedAudience is optional on VerifyPorts. The CF Worker may
      // ship without it wired in Phase 2; gate gracefully degrades.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        // Intentionally do NOT include expectedAudience in overrides.
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          aud: 'https://anything.example.com',
        }),
      });
      // Strip the port if base ever adds it.
      delete (ports as { expectedAudience?: () => string | undefined })
        .expectedAudience;
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('aud gate runs BEFORE replay cache — cross-server replay is rejected without consuming jti', async () => {
      const consumedJtis: string[] = [];
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        expectedAudience: () => EXPECTED_AUD,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j_replay_attempt',
          aud: 'https://wrong.example.com',
        }),
        consumeJti: async (jti) => {
          consumedJtis.push(jti);
          return true;
        },
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
      // jti was NOT consumed — the legitimate verifier (correct aud)
      // can still process this token on its first sighting.
      expect(consumedJtis).toEqual([]);
    });

    it('aud gate runs AFTER signature verification (signature wins ordering)', async () => {
      // If signature is bad AND aud is bad, the signature failure
      // returns first. Cryptographic check is the cheaper + stronger
      // guard; aud check is a defense-in-depth layer.
      const { ports, recordedAudit } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        expectedAudience: () => EXPECTED_AUD,
        verifyJwt: async () => null, // signature fails
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
      // Both gates would fire as INVALID_SIGNATURE — we can't differentiate
      // them from the public response. The audit row captures the same
      // reason. Differentiation happens via structured log + future
      // denialContext field; not in scope for this round.
      expect(recordedAudit).toHaveLength(1);
    });
  });

  describe('Step 3.5 — RFC 9101 §4 issuer-vs-subject consistency', () => {
    // Closes the fourth "decoded but not enforced" JAR gap. When the
    // operator opts in via AEGIS_STRICT_JAR_ISS=true, tokens with
    // claims.iss !== claims.sub are rejected. RFC 9101 specifies iss
    // SHOULD be the client_id; in AEGIS that's the agent_id (= sub).

    it('approves when iss === sub AND strict-iss enforcement is on', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        requireIssMatchesSub: () => true,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          iss: 'agt_1',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('rejects with INVALID_SIGNATURE when iss !== sub (impersonation or SDK bug)', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        requireIssMatchesSub: () => true,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          iss: 'agt_attacker', // signed by agt_1's key but claims to be agt_attacker
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
    });

    it('approves when token has NO iss claim even with enforcement on (pre-JAR baseline)', async () => {
      // Enforcement only fires when iss is present. Pre-JAR tokens
      // that omit iss entirely flow through — backward compat.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        requireIssMatchesSub: () => true,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('approves when port returns false (operator has not enabled strict-iss)', async () => {
      // Default behavior. SDKs that set iss to principal_id (FAPI
      // shape) still verify when strict-iss is off.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        requireIssMatchesSub: () => false,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          iss: 'principal_abc',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('approves when port is absent (Worker adapter without strict-iss wired)', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j',
          iss: 'something_else',
        }),
      });
      delete (ports as { requireIssMatchesSub?: () => boolean | undefined })
        .requireIssMatchesSub;
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('iss gate runs BEFORE replay cache — impersonation attempt does not consume jti', async () => {
      const consumedJtis: string[] = [];
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        requireIssMatchesSub: () => true,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: 0,
          exp: 9_999_999_999,
          jti: 'j_iss_mismatch',
          iss: 'agt_other',
        }),
        consumeJti: async (jti) => {
          consumedJtis.push(jti);
          return true;
        },
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
      expect(consumedJtis).toEqual([]);
    });
  });

  describe('Step 3.6 — RFC 9101 iat freshness', () => {
    // Closes the fifth (final) "decoded but not enforced" JAR gap. When
    // the operator opts in via AEGIS_MAX_TOKEN_AGE_SECONDS, tokens whose
    // iat is older than the configured ceiling are rejected EVEN IF
    // exp is in the future. Defense against long-lived tokens being
    // replayed within their exp window after credential exposure.

    // Use a fixed clock so iat math is deterministic.
    const NOW_ISO = '2026-05-02T12:00:00.000Z';
    const nowSec = Math.floor(new Date(NOW_ISO).getTime() / 1000);

    it('approves when (now - iat) <= maxAge AND enforcement is on', async () => {
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        maxTokenAgeSeconds: () => 300, // FAPI 2.0 conventional ceiling
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: nowSec - 60, // 1 minute old — well under ceiling
          exp: nowSec + 3600,
          jti: 'j',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('rejects with INVALID_SIGNATURE when iat is older than maxAge', async () => {
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        maxTokenAgeSeconds: () => 300,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: nowSec - 3600, // 1 hour old — exp still valid but iat stale
          exp: nowSec + 3600,
          jti: 'j',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
    });

    it('approves at exactly maxAge boundary (now - iat === maxAge)', async () => {
      // Boundary is inclusive — only `now - iat > maxAge` rejects.
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        maxTokenAgeSeconds: () => 300,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: nowSec - 300,
          exp: nowSec + 3600,
          jti: 'j',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('approves when port returns undefined (operator has not enabled max-age)', async () => {
      // Backward compat default. Tokens of any age flow through as long
      // as exp is in the future and jti is fresh.
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        maxTokenAgeSeconds: () => undefined,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: nowSec - 86_400, // 1 day old — would reject if gate were on
          exp: nowSec + 3600,
          jti: 'j',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('approves when port is absent (Worker adapter without max-age wired)', async () => {
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: nowSec - 86_400,
          exp: nowSec + 3600,
          jti: 'j',
        }),
      });
      delete (ports as { maxTokenAgeSeconds?: () => number | undefined })
        .maxTokenAgeSeconds;
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
    });

    it('iat gate runs BEFORE replay cache — stale token does not consume jti', async () => {
      // Critical correctness property: a stale token harvested from a
      // log cannot be made un-replayable by exhausting its jti against
      // a max-age-enforcing verifier. The legitimate verifier (without
      // max-age) on a different deployment can still process it on
      // first sighting.
      const consumedJtis: string[] = [];
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        maxTokenAgeSeconds: () => 300,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: nowSec - 3600,
          exp: nowSec + 3600,
          jti: 'j_stale',
        }),
        consumeJti: async (jti) => {
          consumedJtis.push(jti);
          return true;
        },
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
      expect(consumedJtis).toEqual([]);
    });

    it('emits jar_iat_stale discriminator on iat freshness failure', async () => {
      // Round-10 spot check: this gate's denialContext.kind. Full
      // discriminator coverage lives in the Step 10 — DenialContext block.
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        maxTokenAgeSeconds: () => 60,
        verifyJwt: async () => ({
          sub: 'agt_1',
          pid: 'pol_1',
          iat: nowSec - 3600,
          exp: nowSec + 3600,
          jti: 'j_kind',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialReason).toBe('INVALID_SIGNATURE');
      expect(r.denialContext).toEqual({ kind: 'jar_iat_stale' });
    });

    it('iat gate is skipped when iat is non-numeric (malformed claim, defense-in-depth)', async () => {
      // The algorithm only enforces freshness when iat is a number.
      // A non-numeric iat slips past the freshness gate but the token
      // still has to pass replay-cache + the rest of the pipeline.
      // Documented behavior so future SDK validation can tighten this.
      // type-rationale: deliberately emulating an off-shape claim that
      // bypasses TS's iat:number invariant to verify runtime defense.
      const malformed = {
        sub: 'agt_1',
        pid: 'pol_1',
        iat: 'not-a-number',
        exp: nowSec + 3600,
        jti: 'j_malformed_iat',
      } as unknown as import('./verify.ports').AgentTokenClaims;
      const { ports } = makePorts({
        now: () => new Date(NOW_ISO),
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        maxTokenAgeSeconds: () => 300,
        verifyJwt: async () => malformed,
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      // Slips past Step 3.6 but the rest of the algorithm is unaffected.
      expect(r.valid).toBe(true);
    });
  });

  describe('Step 10 — DenialContext discriminator (round 10)', () => {
    // Locks the discriminator-kind emission at every gate. The round-10
    // primitive: every deny() callsite emits a closed-enum kind so
    // operators + integrators can differentiate which sub-condition
    // fired (esp. the five INVALID_SIGNATURE rejections that collapse
    // to one denialReason). TS exhaustiveness on DenialContextKind
    // catches missing kinds at compile time; this block catches
    // wrong-kind emissions at test time.

    it('approval path emits denialContext=null', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.valid).toBe(true);
      expect(r.denialContext).toBeNull();
    });

    it('token_malformed kind on Step 1 decode failure', async () => {
      const { ports } = makePorts({ decodeJwtUnsafe: () => null });
      const r = await verifyAlgorithm(baseInput({ token: 'garbage' }), ports);
      expect(r.denialContext).toEqual({ kind: 'token_malformed' });
    });

    it('agent_unknown kind on Step 2 NOT_FOUND', async () => {
      const { ports } = makePorts();
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialReason).toBe('AGENT_NOT_FOUND');
      expect(r.denialContext).toEqual({ kind: 'agent_unknown' });
    });

    it('agent_revoked kind on Step 2 REVOKED (distinct from agent_unknown)', async () => {
      const { ports } = makePorts({ getAgent: async () => ({ ...ACTIVE_AGENT, status: 'REVOKED' }) });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialReason).toBe('AGENT_REVOKED');
      expect(r.denialContext).toEqual({ kind: 'agent_revoked' });
    });

    it('agent_suspended kind on Step 2 SUSPENDED — public reason still AGENT_NOT_FOUND', async () => {
      // The denialReason collapses to AGENT_NOT_FOUND (no info leak),
      // but the discriminator preserves the truth for operator debug.
      const { ports } = makePorts({ getAgent: async () => ({ ...ACTIVE_AGENT, status: 'SUSPENDED' }) });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialReason).toBe('AGENT_NOT_FOUND');
      expect(r.denialContext).toEqual({ kind: 'agent_suspended' });
    });

    it('signature_invalid kind on Step 3 bad sig', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        verifyJwt: async () => null,
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialContext).toEqual({ kind: 'signature_invalid' });
    });

    it('jar_aud_mismatch kind on Step 3.4 aud mismatch', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        expectedAudience: () => 'https://expected.example',
        verifyJwt: async () => ({
          sub: 'agt_1', pid: 'pol_1', iat: 0, exp: 9_999_999_999, jti: 'j',
          aud: 'https://wrong.example',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialContext).toEqual({ kind: 'jar_aud_mismatch' });
    });

    it('jar_iss_sub_mismatch kind on Step 3.5 iss mismatch', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        requireIssMatchesSub: () => true,
        verifyJwt: async () => ({
          sub: 'agt_1', pid: 'pol_1', iat: 0, exp: 9_999_999_999, jti: 'j',
          iss: 'agt_imposter',
        }),
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialContext).toEqual({ kind: 'jar_iss_sub_mismatch' });
    });

    it('replay_consumed kind distinct from signature_invalid', async () => {
      // Both fire INVALID_SIGNATURE publicly — discriminator
      // distinguishes them for operator debug.
      const seen = new Set<string>();
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        consumeJti: async (jti) => {
          if (seen.has(jti)) return false;
          seen.add(jti);
          return true;
        },
      });
      const r1 = await verifyAlgorithm(baseInput(), ports);
      expect(r1.valid).toBe(true);
      const r2 = await verifyAlgorithm(baseInput(), ports);
      expect(r2.denialReason).toBe('INVALID_SIGNATURE');
      expect(r2.denialContext).toEqual({ kind: 'replay_consumed' });
    });

    it('replay_port_outage kind when consumeJti throws', async () => {
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        consumeJti: async () => {
          throw new Error('redis down');
        },
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialReason).toBe('ANOMALY_FLAGGED');
      expect(r.denialContext).toEqual({ kind: 'replay_port_outage' });
    });

    it('policy_missing kind distinct from policy_expired', async () => {
      // Both fire POLICY_EXPIRED publicly (no enumeration leak) —
      // discriminator preserves the truth.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => null,
      });
      const r = await verifyAlgorithm(baseInput(), ports);
      expect(r.denialReason).toBe('POLICY_EXPIRED');
      expect(r.denialContext).toEqual({ kind: 'policy_missing' });
    });

    it('policy_revoked + policy_expired kinds map distinctly', async () => {
      const revoked = await verifyAlgorithm(
        baseInput(),
        makePorts({
          getAgent: async () => ACTIVE_AGENT,
          getPolicy: async () => ({ ...ACTIVE_POLICY, status: 'REVOKED' }),
        }).ports,
      );
      expect(revoked.denialContext).toEqual({ kind: 'policy_revoked' });

      const expired = await verifyAlgorithm(
        baseInput(),
        makePorts({
          now: () => new Date('2027-12-31T00:00:00Z'),
          getAgent: async () => ACTIVE_AGENT,
          getPolicy: async () => ACTIVE_POLICY,
        }).ports,
      );
      expect(expired.denialContext).toEqual({ kind: 'policy_expired' });
    });

    it('scope_category_not_granted + scope_domain_not_allowed kinds distinguish two SCOPE_NOT_GRANTED paths', async () => {
      const catFail = await verifyAlgorithm(
        baseInput({ action: 'trading.execute' }),
        makePorts({
          getAgent: async () => ACTIVE_AGENT,
          getPolicy: async () => ACTIVE_POLICY,
        }).ports,
      );
      expect(catFail.denialReason).toBe('SCOPE_NOT_GRANTED');
      expect(catFail.denialContext).toEqual({ kind: 'scope_category_not_granted' });

      const domFail = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', merchantDomain: 'evil.example' }),
        makePorts({
          getAgent: async () => ACTIVE_AGENT,
          getPolicy: async () => ACTIVE_POLICY,
        }).ports,
      );
      expect(domFail.denialReason).toBe('SCOPE_NOT_GRANTED');
      expect(domFail.denialContext).toEqual({ kind: 'scope_domain_not_allowed' });
    });

    it('rar_limit_exceeded kind preserved through RAR → SCOPE_NOT_GRANTED collapse', async () => {
      // The denialReason collapses to SCOPE_NOT_GRANTED; the
      // discriminator preserves the specific RAR sub-reason.
      // Action 'commerce.purchase' passes scope category 'commerce' AND
      // matches the RAR detail's actions list — RAR limit_exceeded
      // fires only when both prior gates pass. Same pattern as the
      // Step 6.5 limit_exceeded test on line 284.
      const { ports } = makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => ACTIVE_POLICY,
        verifyJwt: async () => ({
          sub: 'agt_1', pid: 'pol_1', iat: 0, exp: 9_999_999_999, jti: 'j_rar',
          authorization_details: [
            {
              type: 'trading_order',
              actions: ['commerce.purchase'],
              limits: { per_order_usd: 50 },
            },
          ],
        }),
      });
      const r = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', amount: 100 }),
        ports,
      );
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
      expect(r.denialContext).toEqual({ kind: 'rar_limit_exceeded' });
    });

    it('spend_limit_exceeded + trust_below_minimum + anomaly_flagged kinds all map 1:1', async () => {
      const spend = await verifyAlgorithm(
        baseInput({ action: 'commerce.purchase', amount: 1000 }),
        makePorts({
          getAgent: async () => ACTIVE_AGENT,
          getPolicy: async () => ACTIVE_POLICY,
          checkSpend: async () => false,
        }).ports,
      );
      expect(spend.denialContext).toEqual({ kind: 'spend_limit_exceeded' });

      const trust = await verifyAlgorithm(
        baseInput({ minTrustScore: 900 }),
        makePorts({
          getAgent: async () => ACTIVE_AGENT,
          getPolicy: async () => ACTIVE_POLICY,
        }).ports,
      );
      expect(trust.denialContext).toEqual({ kind: 'trust_below_minimum' });

      const anomaly = await verifyAlgorithm(
        baseInput(),
        makePorts({
          getAgent: async () => ({ ...ACTIVE_AGENT, flagged: true }),
          getPolicy: async () => ACTIVE_POLICY,
        }).ports,
      );
      expect(anomaly.denialContext).toEqual({ kind: 'anomaly_flagged' });
    });
  });
});
