// Audit chain integrity — CLAUDE.md invariant #3.
//
// 1. After N=20 verify cycles the chain extends correctly: every row has a
//    non-empty signature, every signature verifies under the CERNIQ audit
//    public key.
// 2. Tampering an event payload after-the-fact (we update the `action`
//    field directly via Prisma — bypassing the no-UPDATE convention to
//    SIMULATE a bad actor) breaks the chain at the tampered row, and
//    AuditChainUtil.verify returns false for that row.
// 3. Chains are per-agent: events for agent A and agent B form independent
//    chains. Verifying B's events with A's prev-link produces no false
//    positives.

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditChainUtil, type AuditChainPayload } from '../../src/common/crypto/audit-chain.util';
import { AppConfigService } from '../../src/config/config.service';
import { AuditService } from '../../src/modules/audit/audit.service';

import { generateAgentKeypair, signAgentToken, type AgentKeypair } from './_helpers/agent-keys';
import { createTestApp, type SupertestHttp, type TestAppHandle } from './_helpers/test-app';
import {
  createPolicyViaApi,
  isoInDays,
  registerAgentViaApi,
  seedPrincipalAndApiKey,
  type SeededPrincipal,
} from './_helpers/test-fixtures';

interface AgentSetup {
  agentId: string;
  policyId: string;
  keys: AgentKeypair;
}

const N_VERIFIES = 20;

describe('e2e: audit chain integrity', () => {
  let handle: TestAppHandle;
  let app: INestApplication;
  let http: SupertestHttp;
  let principal: SeededPrincipal;
  let verifyKey: SeededPrincipal;
  let chain: AuditChainUtil;
  let publicKeyB64: string;

  async function setupAgent(label: string): Promise<AgentSetup> {
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
      label,
    });
    const policy = await createPolicyViaApi(http, principal.apiKey, seeded.agentId, {
      scopes: [{ category: 'commerce', spendLimit: { currency: 'USD', maxPerTransaction: 1000 } }],
      expiresAt: isoInDays(7),
    });
    return { agentId: seeded.agentId, policyId: policy.policyId, keys };
  }

  async function runVerify(setup: AgentSetup, amount: number): Promise<void> {
    const token = await signAgentToken(setup.keys.privateKey, {
      agentId: setup.agentId,
      policyId: setup.policyId,
      action: 'commerce.purchase',
      amount,
      currency: 'USD',
    });
    const res = await http
      .post('/v1/verify')
      .set('X-CERNIQ-Verify-Key', verifyKey.apiKey)
      .send({ token, action: 'commerce.purchase', amount, currency: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body.valid).toBe(true);
  }

  async function waitForAuditCount(
    agentId: string,
    want: number,
    timeoutMs = 10_000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const c = await handle.prisma.auditEvent.count({ where: { agentId } });
      if (c >= want) return c;
      await new Promise((r) => setTimeout(r, 100));
    }
    return await handle.prisma.auditEvent.count({ where: { agentId } });
  }

  beforeAll(async () => {
    handle = await createTestApp();
    app = handle.app;
    http = request(app.getHttpServer());
    await handle.resetDatabase();

    const config = app.get(AppConfigService);
    principal = await seedPrincipalAndApiKey(handle.prisma, config);
    verifyKey = await seedPrincipalAndApiKey(handle.prisma, config, {
      email: `vk-chain-${Date.now()}@cerniq.test`,
      scope: 'VERIFY_ONLY',
    });
    chain = new AuditChainUtil();
    publicKeyB64 = app.get(AuditService).publicKey().key;
  });

  afterAll(async () => {
    await handle.close();
  });

  test(`chain of ${N_VERIFIES} events: every row signs + verifies`, async () => {
    const setup = await setupAgent('chain-extend-agent');
    for (let i = 0; i < N_VERIFIES; i += 1) {
      // Distinct amounts so payloads differ — catches a hash-collision
      // false positive in the canonicalizer if one ever sneaks in.
      await runVerify(setup, 10 + i);
    }
    const count = await waitForAuditCount(setup.agentId, N_VERIFIES);
    expect(count).toBeGreaterThanOrEqual(N_VERIFIES);

    const events = await handle.prisma.auditEvent.findMany({
      where: { agentId: setup.agentId },
      orderBy: { timestamp: 'asc' },
    });

    let prevId: string | null = null;
    let prevSig: string | null = null;
    for (const e of events) {
      expect(e.cerniqSignature.length).toBeGreaterThan(40);
      const payload = toPayload(e);
      const ok = await chain.verify(
        { eventId: e.id, prevEventId: prevId, prevSignatureB64Url: prevSig, payload },
        e.cerniqSignature,
        publicKeyB64,
      );
      expect(ok).toBe(true);
      prevId = e.id;
      prevSig = e.cerniqSignature;
    }
  }, 30_000);

  test('tamper detection: mutating an event payload breaks verification at that row', async () => {
    const setup = await setupAgent('chain-tamper-agent');
    await runVerify(setup, 42);
    await runVerify(setup, 43);
    await runVerify(setup, 44);
    await waitForAuditCount(setup.agentId, 3);

    const events = await handle.prisma.auditEvent.findMany({
      where: { agentId: setup.agentId },
      orderBy: { timestamp: 'asc' },
    });
    expect(events.length).toBeGreaterThanOrEqual(3);

    // Tamper the middle row's `action`. CLAUDE.md invariant #3 forbids
    // UPDATE on AuditEvent in production; here we use the raw client to
    // SIMULATE an attacker with DB access.
    const target = events[1];
    await handle.prisma.auditEvent.update({
      where: { id: target.id },
      data: { action: 'ATTACKER_REWROTE_ACTION' },
    });

    const refreshed = await handle.prisma.auditEvent.findMany({
      where: { agentId: setup.agentId },
      orderBy: { timestamp: 'asc' },
    });

    let prevId: string | null = null;
    let prevSig: string | null = null;
    let firstBrokenAt: string | null = null;
    for (const e of refreshed) {
      const payload = toPayload(e);
      const ok = await chain.verify(
        { eventId: e.id, prevEventId: prevId, prevSignatureB64Url: prevSig, payload },
        e.cerniqSignature,
        publicKeyB64,
      );
      if (!ok && firstBrokenAt === null) firstBrokenAt = e.id;
      prevId = e.id;
      prevSig = e.cerniqSignature;
    }
    expect(firstBrokenAt).toBe(target.id);
  });

  test('chains are per-agent: agent A and agent B chain independently', async () => {
    const a = await setupAgent('chain-iso-A');
    const b = await setupAgent('chain-iso-B');
    await runVerify(a, 11);
    await runVerify(b, 22);
    await runVerify(a, 33);
    await waitForAuditCount(a.agentId, 2);
    await waitForAuditCount(b.agentId, 1);

    const aEvents = await handle.prisma.auditEvent.findMany({
      where: { agentId: a.agentId },
      orderBy: { timestamp: 'asc' },
    });
    const bEvents = await handle.prisma.auditEvent.findMany({
      where: { agentId: b.agentId },
      orderBy: { timestamp: 'asc' },
    });
    expect(aEvents.length).toBeGreaterThanOrEqual(2);
    expect(bEvents.length).toBeGreaterThanOrEqual(1);

    // Verify A's chain in isolation; verify B's chain with B's first event
    // having no prior (genesis). If chains were shared by agentId we'd
    // expect verifications to fail for B starting from the second
    // operation — they don't, which proves isolation.
    const verifyChain = async (events: typeof aEvents): Promise<boolean> => {
      let prevId: string | null = null;
      let prevSig: string | null = null;
      for (const e of events) {
        const payload = toPayload(e);
        const ok = await chain.verify(
          { eventId: e.id, prevEventId: prevId, prevSignatureB64Url: prevSig, payload },
          e.cerniqSignature,
          publicKeyB64,
        );
        if (!ok) return false;
        prevId = e.id;
        prevSig = e.cerniqSignature;
      }
      return true;
    };

    expect(await verifyChain(aEvents)).toBe(true);
    expect(await verifyChain(bEvents)).toBe(true);

    // Cross-chain check: feed B's first event with A's last event as the
    // claimed predecessor. The signature was computed against B's actual
    // genesis prev-hash, so the wrong prev_hash produces a verify=false.
    const bFirst = bEvents[0];
    const aLast = aEvents[aEvents.length - 1];
    const crossOk = await chain.verify(
      {
        eventId: bFirst.id,
        prevEventId: aLast.id,
        prevSignatureB64Url: aLast.cerniqSignature,
        payload: toPayload(bFirst),
      },
      bFirst.cerniqSignature,
      publicKeyB64,
    );
    expect(crossOk).toBe(false);
  });
});

function toPayload(e: {
  agentId: string;
  principalId: string;
  action: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason: string | null;
  relyingParty: string | null;
  requestedAmount: { toFixed(d: number): string } | null;
  currency: string | null;
  policyId: string | null;
  policySnapshot: unknown;
  trustScoreAtEvent: number;
  trustBandAtEvent: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  timestamp: Date;
}): AuditChainPayload {
  return {
    agentId: e.agentId,
    principalId: e.principalId,
    action: e.action,
    decision: e.decision,
    denialReason: e.denialReason ?? null,
    relyingParty: e.relyingParty ?? null,
    requestedAmount: e.requestedAmount != null ? e.requestedAmount.toFixed(2) : null,
    currency: e.currency ?? null,
    policyId: e.policyId ?? null,
    policySnapshot: e.policySnapshot ?? null,
    trustScoreAtEvent: e.trustScoreAtEvent,
    trustBandAtEvent: e.trustBandAtEvent,
    timestamp: e.timestamp.toISOString(),
  };
}
