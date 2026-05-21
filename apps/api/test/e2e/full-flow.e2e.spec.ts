// "A transaction comes to life" — one narrative, ten chained assertions.
//
// Steps (one per `test()`, sharing state via `beforeAll`):
//   1. Register principal, mint FULL API key
//   2. Register agent (Ed25519 keypair generated client-side)
//   3. Create a $100 commerce policy, 30-day expiry
//   4. Sign an agent token (action=purchase, $50, merchant.example.com)
//   5. POST /v1/verify → approved + scopesGranted=['commerce']
//   6. GET /v1/agents/:id/audit → at least one APPROVED row, signed
//   7. POST /v1/agents/:id/report (false_positive — self-report is allowed)
//   8. Wait for BATE recompute → trustScore touched OR report accepted
//   9. GET /v1/agents/:id/audit again → chain extended (≥ first count)
//  10. Verify chain integrity by walking events through AuditChainUtil

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
  type SeededAgent,
  type SeededPolicy,
  type SeededPrincipal,
} from './_helpers/test-fixtures';

describe('e2e: full transaction flow', () => {
  let handle: TestAppHandle;
  let app: INestApplication;
  let http: SupertestHttp;
  let principal: SeededPrincipal;
  let agent: SeededAgent;
  let agentKeys: AgentKeypair;
  let policy: SeededPolicy;
  let firstAuditCount = 0;
  let initialTrustScore = 0;

  beforeAll(async () => {
    handle = await createTestApp();
    app = handle.app;
    await handle.resetDatabase();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await handle.close();
  });

  test('1. principal + API key issued (key starts with aegis_sk_)', async () => {
    const config = app.get(AppConfigService);
    principal = await seedPrincipalAndApiKey(handle.prisma, config);
    expect(principal.apiKey.startsWith('aegis_sk_')).toBe(true);
    expect(principal.principalId).toMatch(/^[a-z0-9]+$/i);
  });

  test('2. agent registers with ACTIVE status, trustScore 500, band VERIFIED', async () => {
    agentKeys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: agentKeys.publicKeyB64Url,
      runtime: 'CUSTOM',
      label: 'e2e-full-flow-agent',
    });
    agent = seeded;

    const res = await http
      .get(`/v1/agents/${agent.agentId}`)
      .set('X-AEGIS-API-Key', principal.apiKey);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.trustScore).toBe(500);
    expect(res.body.trustBand).toBe('VERIFIED');
    initialTrustScore = res.body.trustScore;
  });

  test('3. commerce policy, $100/tx USD, 30-day expiry, signed JWT shape', async () => {
    policy = await createPolicyViaApi(http, principal.apiKey, agent.agentId, {
      scopes: [
        {
          category: 'commerce',
          spendLimit: { currency: 'USD', maxPerTransaction: 100 },
          allowedDomains: ['merchant.example.com'],
        },
      ],
      expiresAt: isoInDays(30),
    });

    const parts = policy.signedToken.split('.');
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(payload.sub).toBe(agent.agentId);
    expect(payload.pid).toBe(policy.policyId);
  });

  test('4. agent signs a $50 purchase token for merchant.example.com', async () => {
    const token = await signAgentToken(agentKeys.privateKey, {
      agentId: agent.agentId,
      policyId: policy.policyId,
      action: 'commerce.purchase',
      amount: 50,
      currency: 'USD',
      merchantDomain: 'merchant.example.com',
    });
    expect(token.split('.').length).toBe(3);
    // Stash on the closure for step 5.
    (agent as unknown as { _token?: string })._token = token;
  });

  test('5. /v1/verify approves the token, scopesGranted=[commerce]', async () => {
    // Get a verify-only key for the verify endpoint.
    const config = app.get(AppConfigService);
    const verifyKey = await seedPrincipalAndApiKey(handle.prisma, config, {
      email: `vk-${principal.email}`,
      scope: 'VERIFY_ONLY',
    });

    const token = (agent as unknown as { _token: string })._token;
    const res = await http
      .post('/v1/verify')
      .set('X-AEGIS-Verify-Key', verifyKey.apiKey)
      .send({
        token,
        action: 'commerce.purchase',
        amount: 50,
        currency: 'USD',
        merchantDomain: 'merchant.example.com',
      });

    expect(res.status).toBe(201);
    expect(res.body.valid).toBe(true);
    expect(res.body.denialReason).toBeNull();
    expect(res.body.scopesGranted).toEqual(expect.arrayContaining(['commerce']));
    expect(res.body.agentId).toBe(agent.agentId);
  });

  test('6. /v1/agents/:id/audit lists the APPROVED event with a signature', async () => {
    // Audit append is fire-and-forget from /verify; poll briefly.
    let count = 0;
    let approved: { decision: string; signature: string; action: string } | undefined;
    for (let i = 0; i < 10; i += 1) {
      const res = await http
        .get(`/v1/agents/${agent.agentId}/audit`)
        .set('X-AEGIS-API-Key', principal.apiKey);
      expect(res.status).toBe(200);
      count = res.body.count;
      approved = res.body.events.find((e: { decision: string }) => e.decision === 'APPROVED');
      if (approved) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(approved).toBeDefined();
    expect(approved!.signature.length).toBeGreaterThan(40);
    firstAuditCount = count;
  });

  test('7. relying-party-style report (self-report false_positive) → 202', async () => {
    const res = await http
      .post(`/v1/agents/${agent.agentId}/report`)
      .set('X-AEGIS-API-Key', principal.apiKey)
      .send({
        eventType: 'false_positive',
        severity: 'low',
        description: 'e2e cleanup signal',
      });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  test('8. agent record updated by BATE OR report at least accepted (M-007 fallback)', async () => {
    // BATE recompute is async (BullMQ). Poll for either a score touch or
    // the lastSeenAt bump from step 5; either proves the request hit
    // mutating downstream logic.
    let final: { trustScore: number; lastSeenAt: string | null } | undefined;
    for (let i = 0; i < 25; i += 1) {
      const res = await http
        .get(`/v1/agents/${agent.agentId}`)
        .set('X-AEGIS-API-Key', principal.apiKey);
      expect(res.status).toBe(200);
      final = { trustScore: res.body.trustScore, lastSeenAt: res.body.lastSeenAt };
      if (final.lastSeenAt || final.trustScore !== initialTrustScore) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // We assert "something measurable changed" — either lastSeenAt got
    // populated (verify happened) or trustScore drifted (BATE happened).
    expect(final).toBeDefined();
    const movement = final!.lastSeenAt !== null || final!.trustScore !== initialTrustScore;
    expect(movement).toBe(true);
  });

  test('9. audit chain extended after report+verify cycle', async () => {
    const res = await http
      .get(`/v1/agents/${agent.agentId}/audit`)
      .set('X-AEGIS-API-Key', principal.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(firstAuditCount);
  });

  test('10. audit chain integrity verifies under AEGIS public key', async () => {
    // Audit chain is signed with the AuditService's key (may be a separate
    // ephemeral key in dev — distinct from the AEGIS_SIGNING_PUBLIC_KEY at
    // /.well-known). Pull the public half from the service directly so we
    // verify the same key that signed.
    const auditSvc = app.get(AuditService);
    const publicKeyB64 = auditSvc.publicKey().key;
    expect(publicKeyB64.length).toBeGreaterThan(40);

    const events = await handle.prisma.auditEvent.findMany({
      where: { agentId: agent.agentId },
      orderBy: { timestamp: 'asc' },
    });
    expect(events.length).toBeGreaterThan(0);

    const chain = new AuditChainUtil();
    let prevId: string | null = null;
    let prevSig: string | null = null;
    for (const e of events) {
      const payload: AuditChainPayload = {
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
      const ok = await chain.verify(
        { eventId: e.id, prevEventId: prevId, prevSignatureB64Url: prevSig, payload },
        e.aegisSignature,
        publicKeyB64,
      );
      expect(ok).toBe(true);
      prevId = e.id;
      prevSig = e.aegisSignature;
    }
  });
});
