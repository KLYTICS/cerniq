// Cross-package parity — FAPI 2.0 JAR algorithm binding (RFC 9101)
//
// Locks the wedge promotion at the depth `docs/spec/05_FAPI_2_0_PROFILE.md`
// §2 actually claims: not just "JwtUtil accepts opt-in JAR claims" (the
// jwt.util.jar.spec.ts level — already locked by the existing parity
// test fapi-rar-binding-parity.spec.ts via the per-RFC test-existence
// check), but "the verify algorithm enforces aud / iss / iat as gates
// in the hot path."
//
// Round 6 (RAR-in-JAR) caught a half-wired version of this same pattern:
// the JwtUtil layer decoded the claims, but the algorithm did not enforce
// them. The existing per-RFC parity test would have stayed green
// throughout because a binding test file existed at the JwtUtil layer.
// This spec locks the depth so the audit pattern cannot recur silently.
//
// SEV-1: a failure here means the §2 RFC-9101 claim is true at the
// binding-test level but FALSE at the verify-algorithm level — the wedge
// promise is half-wire. Treat like audit-chain-parity.spec.ts.
//
// This spec is intentionally PURE — no HTTP, no DB, no clock fakes. It
// imports the algorithm + the wellknown service-level standards list
// directly. Speed: sub-second.

import { describe, expect, it } from 'vitest';

import { verifyAlgorithm } from '../../apps/api/src/modules/verify/algorithm/verify.algorithm';
import type {
  AgentSnapshot,
  PolicySnapshot,
  VerifyAlgorithmInput,
  VerifyPorts,
} from '../../apps/api/src/modules/verify/algorithm/verify.ports';

// Discovery side — the load-bearing constant the §2 row of the FAPI doc
// reflects. If RFC-9101 ever leaves this list, this entire spec is
// vacuously irrelevant; check that explicitly to fail loudly rather
// than silently skip.
import {
  WellknownService,
  computeKid,
} from '../../apps/api/src/modules/wellknown/wellknown.service';
import { encodeBase64Url } from '../../apps/api/src/common/crypto/ed25519.util';

const ZERO_KEY_B64 = encodeBase64Url(new Uint8Array(32));

function newDiscovery() {
  const svc = new WellknownService({
    aegisSigningPublicKey: ZERO_KEY_B64,
    aegisSigningKeyRotatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
  svc.onModuleInit();
  return svc;
}

// ── Algorithm fixtures (subset of verify.algorithm.spec.ts helpers) ───
// Keep this file standalone — pulling in the full Nest test helpers
// would break the parity-test invariant of zero-framework imports.

const RP_PRINCIPAL = 'rp_parity_principal';
const NOW_ISO = '2026-05-16T12:00:00.000Z';
const NOW_SEC = Math.floor(new Date(NOW_ISO).getTime() / 1000);

const ACTIVE_AGENT: AgentSnapshot = {
  id: 'agt_parity',
  publicKey: 'pk_parity',
  status: 'ACTIVE',
  trustScore: 720,
  trustBand: 'VERIFIED',
  principalId: 'p_parity',
};

const ACTIVE_POLICY: PolicySnapshot = {
  id: 'pol_parity',
  status: 'ACTIVE',
  expiresAt: new Date('2027-01-01T00:00:00.000Z').toISOString(),
  scopes: [{ category: 'commerce', allowedDomains: ['ok.example'] }],
};

function makePorts(overrides: Partial<VerifyPorts> = {}): VerifyPorts {
  const consumed = new Set<string>();
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
      if (consumed.has(jti)) return false;
      consumed.add(jti);
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

const baseInput = (): VerifyAlgorithmInput => ({
  token: 'opaque',
  relyingPartyPrincipalId: RP_PRINCIPAL,
});

const EXPECTED_AUD = 'https://api.aegis.klytics.io';

describe('FAPI JAR algorithm binding parity — discovery ↔ verify algorithm', () => {
  it('discovery surfaces RFC-9101 in standards_implemented (precondition for this spec)', () => {
    // If RFC-9101 is demoted out of standards_implemented, this whole
    // spec becomes vacuous — fail loudly rather than silently pass.
    const cfg = newDiscovery().getAegisConfiguration();
    expect(cfg.standards_implemented).toContain('RFC-9101');
    expect(cfg.standards_aligned).not.toContain('RFC-9101');
  });

  it('Step 3.4 is wired — operator-configured aud + token aud mismatch ⇒ denial', async () => {
    // Locks: discovery says "RFC-9101 implemented" + §2 row says "Step 3.4
    // enforces aud" ⇒ the algorithm MUST actually enforce aud. If the
    // gate is removed, this test fails.
    const ports = makePorts({
      verifyJwt: async () => ({
        sub: ACTIVE_AGENT.id,
        pid: ACTIVE_POLICY.id,
        iat: NOW_SEC,
        exp: NOW_SEC + 3600,
        jti: 'j_aud',
        aud: 'https://wrong.example',
      }),
      expectedAudience: () => EXPECTED_AUD,
    });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('Step 3.5 is wired — strict-iss enabled + iss !== sub ⇒ denial', async () => {
    const ports = makePorts({
      verifyJwt: async () => ({
        sub: ACTIVE_AGENT.id,
        pid: ACTIVE_POLICY.id,
        iat: NOW_SEC,
        exp: NOW_SEC + 3600,
        jti: 'j_iss',
        iss: 'agt_imposter',
      }),
      requireIssMatchesSub: () => true,
    });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('Step 3.6 is wired — max-age enabled + stale iat ⇒ denial', async () => {
    const ports = makePorts({
      verifyJwt: async () => ({
        sub: ACTIVE_AGENT.id,
        pid: ACTIVE_POLICY.id,
        iat: NOW_SEC - 3600, // 1 hour old
        exp: NOW_SEC + 3600,
        jti: 'j_iat',
      }),
      maxTokenAgeSeconds: () => 60,
    });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('all three gates ABSENT (Worker shim) ⇒ algorithm still functional', async () => {
    // Worker adapter parity: VerifyPorts may omit the three FAPI ports
    // entirely. The algorithm must gracefully degrade — pre-JAR behavior.
    // Documents the operator deployment ladder §2.5.2 state A.
    const ports = makePorts();
    delete (ports as { expectedAudience?: VerifyPorts['expectedAudience'] }).expectedAudience;
    delete (ports as { requireIssMatchesSub?: VerifyPorts['requireIssMatchesSub'] })
      .requireIssMatchesSub;
    delete (ports as { maxTokenAgeSeconds?: VerifyPorts['maxTokenAgeSeconds'] }).maxTokenAgeSeconds;
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.valid).toBe(true);
  });

  it('all three gates return undefined (operator at state A) ⇒ pre-JAR behavior', async () => {
    // §2.5.2 deployment ladder state A — code paths dormant.
    const ports = makePorts({
      verifyJwt: async () => ({
        sub: ACTIVE_AGENT.id,
        pid: ACTIVE_POLICY.id,
        iat: NOW_SEC - 86_400, // would reject if max-age were on
        exp: NOW_SEC + 3600,
        jti: 'j_state_a',
        iss: 'something_else',
        aud: 'https://whatever.example',
      }),
      expectedAudience: () => undefined,
      requireIssMatchesSub: () => false,
      maxTokenAgeSeconds: () => undefined,
    });
    const r = await verifyAlgorithm(baseInput(), ports);
    expect(r.valid).toBe(true);
  });

  it('all three gates run BEFORE replay cache — rejected JAR tokens do not consume jti', async () => {
    // The cross-verifier semantic invariant — locked here at the parity
    // level because it's the property that lets two AEGIS deployments
    // with different JAR-enforcement configs coexist without one
    // weaponizing itself against the other's traffic.
    const consumed: string[] = [];
    const consumeJti = async (jti: string) => {
      consumed.push(jti);
      return true;
    };

    const audPorts = makePorts({
      verifyJwt: async () => ({
        sub: ACTIVE_AGENT.id,
        pid: ACTIVE_POLICY.id,
        iat: NOW_SEC,
        exp: NOW_SEC + 3600,
        jti: 'j_aud_only',
        aud: 'https://wrong.example',
      }),
      expectedAudience: () => EXPECTED_AUD,
      consumeJti,
    });
    await verifyAlgorithm(baseInput(), audPorts);

    const issPorts = makePorts({
      verifyJwt: async () => ({
        sub: ACTIVE_AGENT.id,
        pid: ACTIVE_POLICY.id,
        iat: NOW_SEC,
        exp: NOW_SEC + 3600,
        jti: 'j_iss_only',
        iss: 'agt_imposter',
      }),
      requireIssMatchesSub: () => true,
      consumeJti,
    });
    await verifyAlgorithm(baseInput(), issPorts);

    const iatPorts = makePorts({
      verifyJwt: async () => ({
        sub: ACTIVE_AGENT.id,
        pid: ACTIVE_POLICY.id,
        iat: NOW_SEC - 3600,
        exp: NOW_SEC + 3600,
        jti: 'j_iat_only',
      }),
      maxTokenAgeSeconds: () => 60,
      consumeJti,
    });
    await verifyAlgorithm(baseInput(), iatPorts);

    // None of the three rejected tokens should have reached the
    // replay cache — they're rejected at Steps 3.4 / 3.5 / 3.6.
    expect(consumed).toEqual([]);
  });

  it('VerifyPorts type carries all three FAPI ports (TS contract lock)', () => {
    // Compile-time check expressed at runtime. If `expectedAudience`,
    // `requireIssMatchesSub`, or `maxTokenAgeSeconds` is removed from
    // VerifyPorts, this assignment fails to compile and CI fails before
    // the test runs. The runtime assertion is incidental — the TS check
    // is what locks the contract.
    const shape = {
      expectedAudience: (): string | undefined => undefined,
      requireIssMatchesSub: (): boolean | undefined => undefined,
      maxTokenAgeSeconds: (): number | undefined => undefined,
    } satisfies Pick<
      VerifyPorts,
      'expectedAudience' | 'requireIssMatchesSub' | 'maxTokenAgeSeconds'
    >;
    expect(typeof shape.expectedAudience).toBe('function');
    expect(typeof shape.requireIssMatchesSub).toBe('function');
    expect(typeof shape.maxTokenAgeSeconds).toBe('function');
  });
});

// Helper export to keep linters happy about `computeKid` import — used
// to ensure the wellknown.service module-init path runs cleanly.
void computeKid;
