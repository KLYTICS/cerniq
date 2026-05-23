// Cross-package parity — DenialContext discriminator (round 10)
//
// Locks the round-10 primitive at the SET level: ALL_DENIAL_CONTEXT_KINDS
// must enumerate exactly the kinds the algorithm + service adapter emit;
// every DenialReason in the locked ADR-0004 enum must have at least one
// corresponding DenialContextKind; the algorithm cannot emit a denial
// without picking a kind (TS exhaustiveness handles this at compile time,
// but this spec catches the SET-level drift TS misses).
//
// The discriminator was designed in `docs/spec/05_FAPI_2_0_PROFILE.md`
// §2.6 to sit BELOW the locked denial-precedence enum so future gate
// additions can compound rather than accumulate INVALID_SIGNATURE-debt.
// If this spec fails, the discriminator is drifting in one of three ways:
//
// 1. New denial reason added without context-kind wiring → 'every
//    DenialReason has a kind' test fails.
// 2. Kind removed/renamed from union but ALL_DENIAL_CONTEXT_KINDS not
//    updated → SET-level test fails.
// 3. Algorithm emits a kind not in ALL_DENIAL_CONTEXT_KINDS → behavioral
//    test fails (covered by verify.algorithm.spec.ts but this spec is
//    the cross-file lock).
//
// SEV-2: a failure here means the round-10 wedge primitive is drifting.
// Not SEV-1 because the underlying denial-precedence enum is independently
// locked by `denial-precedence-enum.spec.ts`; the wedge claim of
// "operator-debuggable denials" depends on this spec.

import { describe, expect, it } from 'vitest';

import { verifyAlgorithm } from '../../apps/api/src/modules/verify/algorithm/verify.algorithm';
import {
  ALL_DENIAL_CONTEXT_KINDS,
  type DenialContextKind,
  type DenialReason,
  type AgentSnapshot,
  type PolicySnapshot,
  type VerifyAlgorithmInput,
  type VerifyAlgorithmOutput,
  type VerifyPorts,
} from '../../apps/api/src/modules/verify/algorithm/verify.ports';

// ── Fixtures (subset of verify.algorithm.spec.ts helpers) ───────────────

const RP_PRINCIPAL = 'rp_parity_principal_dc';
const NOW_ISO = '2026-05-16T12:00:00.000Z';
const NOW_SEC = Math.floor(new Date(NOW_ISO).getTime() / 1000);

const ACTIVE_AGENT: AgentSnapshot = {
  id: 'agt_dc',
  publicKey: 'pk_dc',
  status: 'ACTIVE',
  trustScore: 720,
  trustBand: 'VERIFIED',
  principalId: 'p_dc',
};

const ACTIVE_POLICY: PolicySnapshot = {
  id: 'pol_dc',
  status: 'ACTIVE',
  expiresAt: new Date('2027-01-01T00:00:00.000Z').toISOString(),
  scopes: [{ category: 'commerce', allowedDomains: ['ok.example'] }],
};

function makePorts(overrides: Partial<VerifyPorts> = {}): VerifyPorts {
  const seen = new Set<string>();
  let counter = 0;
  return {
    now: () => new Date(NOW_ISO),
    getAgent: async () => ACTIVE_AGENT,
    getPolicy: async () => ACTIVE_POLICY,
    verifyJwt: async () => ({
      sub: ACTIVE_AGENT.id,
      pid: ACTIVE_POLICY.id,
      iat: NOW_SEC,
      exp: NOW_SEC + 3600,
      jti: `j_${++counter}`,
    }),
    decodeJwtUnsafe: () => ({
      sub: ACTIVE_AGENT.id,
      pid: ACTIVE_POLICY.id,
      iat: NOW_SEC,
      exp: NOW_SEC + 3600,
      jti: 'j_unsafe',
    }),
    consumeJti: async (jti) => {
      if (seen.has(jti)) return false;
      seen.add(jti);
      return true;
    },
    checkSpend: async () => true,
    recordSpend: () => {},
    recordAudit: async () => `evt_${++counter}`,
    ingestSignal: () => {},
    touchAgent: () => {},
    ...overrides,
  };
}

const baseInput = (extras: Partial<VerifyAlgorithmInput> = {}): VerifyAlgorithmInput => ({
  token: 't_dc',
  relyingPartyPrincipalId: RP_PRINCIPAL,
  ...extras,
});

// ── Closed-set locks ────────────────────────────────────────────────────

describe('FAPI denialContext parity — closed-enum set lock', () => {
  it('ALL_DENIAL_CONTEXT_KINDS is non-empty + has no duplicates', () => {
    expect(ALL_DENIAL_CONTEXT_KINDS.length).toBeGreaterThan(0);
    expect(new Set(ALL_DENIAL_CONTEXT_KINDS).size).toBe(ALL_DENIAL_CONTEXT_KINDS.length);
  });

  it('every kind in ALL_DENIAL_CONTEXT_KINDS is a valid DenialContextKind (TS contract)', () => {
    // Compile-time check expressed at runtime: if any kind in the
    // array fails to match the union type, this assignment fails TS
    // and CI fails before the test runs. The runtime assertion is
    // incidental.
    const typed: readonly DenialContextKind[] = ALL_DENIAL_CONTEXT_KINDS;
    expect(typed.length).toBe(ALL_DENIAL_CONTEXT_KINDS.length);
  });

  it('discriminator naming convention — every kind is snake_case ASCII', () => {
    // Prevents accidental dash/camel/uppercase drift across additions.
    // Matches the convention used in OAuth/JOSE spec literature.
    const valid = /^[a-z][a-z0-9_]*[a-z0-9]$/;
    for (const kind of ALL_DENIAL_CONTEXT_KINDS) {
      expect(valid.test(kind), `kind "${kind}" must be snake_case ASCII`).toBe(true);
    }
  });
});

// ── DenialReason → DenialContextKind coverage lock ──────────────────────

describe('FAPI denialContext parity — every DenialReason has ≥1 corresponding kind', () => {
  // The discriminator's job is to differentiate sub-conditions WITHIN a
  // single denialReason. A DenialReason with zero corresponding kinds
  // would mean the algorithm emits that reason without ever setting a
  // denialContext — defeating the point of the round-10 primitive.

  // The locked ADR-0004 11-reason enum (+ the 2 pre-algorithm gates).
  const ALL_DENIAL_REASONS: DenialReason[] = [
    'AGENT_NOT_FOUND',
    'AGENT_REVOKED',
    'INVALID_SIGNATURE',
    'POLICY_REVOKED',
    'POLICY_EXPIRED',
    'SCOPE_NOT_GRANTED',
    'TRIAL_EXHAUSTED',
    'SPEND_LIMIT_EXCEEDED',
    'TRUST_SCORE_TOO_LOW',
    'ANOMALY_FLAGGED',
    'INTENT_MISMATCH',
  ];

  // The expected discriminator → reason mapping. KEEP IN SYNC with the
  // algorithm's deny() callsites. A wrong mapping here = a test that
  // passes when the algorithm is broken; a missing mapping = a test
  // that fails when the algorithm gains a new kind.
  const KIND_TO_REASON: Record<DenialContextKind, DenialReason | 'PLAN_LIMIT_EXCEEDED'> = {
    token_malformed: 'INVALID_SIGNATURE',
    agent_unknown: 'AGENT_NOT_FOUND',
    agent_revoked: 'AGENT_REVOKED',
    agent_suspended: 'AGENT_NOT_FOUND',
    signature_invalid: 'INVALID_SIGNATURE',
    jar_aud_mismatch: 'INVALID_SIGNATURE',
    jar_iss_sub_mismatch: 'INVALID_SIGNATURE',
    jar_iat_stale: 'INVALID_SIGNATURE',
    replay_consumed: 'INVALID_SIGNATURE',
    replay_port_outage: 'ANOMALY_FLAGGED',
    policy_missing: 'POLICY_EXPIRED',
    policy_revoked: 'POLICY_REVOKED',
    policy_expired: 'POLICY_EXPIRED',
    scope_category_not_granted: 'SCOPE_NOT_GRANTED',
    scope_domain_not_allowed: 'SCOPE_NOT_GRANTED',
    rar_type_unauthorized: 'SCOPE_NOT_GRANTED',
    rar_action_unauthorized: 'SCOPE_NOT_GRANTED',
    rar_instrument_not_whitelisted: 'SCOPE_NOT_GRANTED',
    rar_destination_not_whitelisted: 'SCOPE_NOT_GRANTED',
    rar_resource_not_whitelisted: 'SCOPE_NOT_GRANTED',
    rar_limit_exceeded: 'SCOPE_NOT_GRANTED',
    rar_currency_unauthorized: 'SCOPE_NOT_GRANTED',
    rar_pii_disallowed: 'SCOPE_NOT_GRANTED',
    rar_outside_trading_hours: 'SCOPE_NOT_GRANTED',
    rar_no_authorization_details: 'SCOPE_NOT_GRANTED',
    spend_limit_exceeded: 'SPEND_LIMIT_EXCEEDED',
    trust_below_minimum: 'TRUST_SCORE_TOO_LOW',
    anomaly_flagged: 'ANOMALY_FLAGGED',
    plan_limit_exceeded: 'PLAN_LIMIT_EXCEEDED',
    trial_exhausted: 'TRIAL_EXHAUSTED',
    intent_mismatch: 'INTENT_MISMATCH',
  };

  it('mapping is total — every DenialContextKind has a DenialReason', () => {
    // TS exhaustiveness via the Record type catches missing keys at
    // compile time; this asserts the runtime tally matches.
    expect(Object.keys(KIND_TO_REASON).sort()).toEqual([...ALL_DENIAL_CONTEXT_KINDS].sort());
  });

  it('every DenialReason has ≥1 corresponding DenialContextKind', () => {
    for (const reason of ALL_DENIAL_REASONS) {
      const matches = Object.entries(KIND_TO_REASON).filter(([, r]) => r === reason);
      expect(
        matches.length,
        `DenialReason "${reason}" must have at least one DenialContextKind. ` +
          `If you added a new denial reason, wire a kind in verify.ports.ts ` +
          `+ verify.algorithm.ts + this mapping.`,
      ).toBeGreaterThan(0);
    }
  });

  it('INVALID_SIGNATURE has ≥5 kinds (the round-5-thru-8 sub-conditions)', () => {
    // The whole point of the round-10 primitive: INVALID_SIGNATURE was
    // the biggest collapsed-multi-condition reason. The five conditions:
    // token_malformed, signature_invalid, jar_aud_mismatch,
    // jar_iss_sub_mismatch, jar_iat_stale, replay_consumed.
    // 6 kinds total — assertion is ≥5 to allow one to be re-categorized
    // without false-positive on this specific lock.
    const invSigKinds = Object.entries(KIND_TO_REASON).filter(([, r]) => r === 'INVALID_SIGNATURE');
    expect(invSigKinds.length).toBeGreaterThanOrEqual(5);
  });

  it('SCOPE_NOT_GRANTED has ≥9 kinds (the round-6 RAR sub-reasons + scope/domain)', () => {
    const scopeKinds = Object.entries(KIND_TO_REASON).filter(([, r]) => r === 'SCOPE_NOT_GRANTED');
    expect(scopeKinds.length).toBeGreaterThanOrEqual(9);
  });
});

// ── Behavioral lock — algorithm output always carries denialContext on denial ──

describe('FAPI denialContext parity — algorithm always populates context on denial', () => {
  it('approval path returns denialContext=null', async () => {
    const ports = makePorts({
      getAgent: async () => ACTIVE_AGENT,
      getPolicy: async () => ACTIVE_POLICY,
    });
    const r: VerifyAlgorithmOutput = await verifyAlgorithm(baseInput(), ports);
    expect(r.valid).toBe(true);
    expect(r.denialContext).toBeNull();
  });

  it('every denial path returns denialContext.kind in ALL_DENIAL_CONTEXT_KINDS', async () => {
    // Exercise three representative denial paths; assert each emits a
    // valid kind. The verify.algorithm.spec.ts Step 10 block exercises
    // every kind exhaustively — this is the cross-package sanity check.
    const allowed = new Set<string>(ALL_DENIAL_CONTEXT_KINDS);

    const noAgent = await verifyAlgorithm(baseInput(), makePorts({ getAgent: async () => null }));
    expect(noAgent.valid).toBe(false);
    expect(noAgent.denialContext).not.toBeNull();
    expect(allowed.has(noAgent.denialContext!.kind)).toBe(true);

    const malformed = await verifyAlgorithm(
      baseInput({ token: 'malformed' }),
      makePorts({ decodeJwtUnsafe: () => null }),
    );
    expect(malformed.valid).toBe(false);
    expect(malformed.denialContext).not.toBeNull();
    expect(allowed.has(malformed.denialContext!.kind)).toBe(true);

    const policyMissing = await verifyAlgorithm(
      baseInput(),
      makePorts({
        getAgent: async () => ACTIVE_AGENT,
        getPolicy: async () => null,
      }),
    );
    expect(policyMissing.valid).toBe(false);
    expect(policyMissing.denialContext).not.toBeNull();
    expect(allowed.has(policyMissing.denialContext!.kind)).toBe(true);
  });
});
