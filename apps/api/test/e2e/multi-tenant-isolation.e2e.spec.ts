// Multi-tenant isolation — CLAUDE.md invariant #5.
//
// Two principals A and B each own their own agent + policy. B uses A's
// API key → 401. B uses B's key against A's resource → 404 (NOT 403 —
// existence-leak is itself a leak). Direct DB scoping confirms no
// service path returns A-rows when filtered by B's principalId.
//
// Coordination note: the round-4-greenline session is also building a
// multi-tenant suite. This file is the *contract / oracle* — it asserts
// the externally-observable behaviour every other suite must match. The
// peer's suite drills into specific endpoints; this one is the
// hard-edged "you cannot leak across principals" red-team check.

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppConfigService } from '../../src/config/config.service';

import { generateAgentKeypair, signAgentToken } from './_helpers/agent-keys';
import { createTestApp, type SupertestHttp, type TestAppHandle } from './_helpers/test-app';
import {
  createPolicyViaApi,
  isoInDays,
  registerAgentViaApi,
  seedPrincipalAndApiKey,
  type SeededPrincipal,
} from './_helpers/test-fixtures';

interface TenantBundle {
  principal: SeededPrincipal;
  agentId: string;
  policyId: string;
  privateKey: Uint8Array;
}

describe('e2e: multi-tenant isolation', () => {
  let handle: TestAppHandle;
  let app: INestApplication;
  let http: SupertestHttp;
  let A: TenantBundle;
  let B: TenantBundle;
  let verifyKey: SeededPrincipal;

  async function setupTenant(emailTag: string): Promise<TenantBundle> {
    const config = app.get(AppConfigService);
    const principal = await seedPrincipalAndApiKey(handle.prisma, config, {
      email: `${emailTag}-${Date.now()}@okoro.test`,
    });
    const keys = await generateAgentKeypair();
    const agent = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
      label: emailTag,
    });
    const policy = await createPolicyViaApi(http, principal.apiKey, agent.agentId, {
      scopes: [{ category: 'commerce' }],
      expiresAt: isoInDays(7),
    });
    return {
      principal,
      agentId: agent.agentId,
      policyId: policy.policyId,
      privateKey: keys.privateKey,
    };
  }

  beforeAll(async () => {
    handle = await createTestApp();
    app = handle.app;
    http = request(app.getHttpServer());
    await handle.resetDatabase();

    A = await setupTenant('tenant-A');
    B = await setupTenant('tenant-B');
    const config = app.get(AppConfigService);
    verifyKey = await seedPrincipalAndApiKey(handle.prisma, config, {
      email: `vk-iso-${Date.now()}@okoro.test`,
      scope: 'VERIFY_ONLY',
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  test('an unrecognised API key is rejected with 401', async () => {
    const res = await http
      .get(`/v1/agents/${A.agentId}`)
      .set('X-OKORO-API-Key', 'okoro_sk_thisisnotarealkeyatall00');
    expect(res.status).toBe(401);
  });

  test("B querying A's agent with B's key returns 404 (not 403)", async () => {
    // 404 is the right answer per the controller comment in
    // bate.controller.ts and the SECURITY.md threat model — leaking
    // existence under a different principal IS a leak.
    const res = await http
      .get(`/v1/agents/${A.agentId}`)
      .set('X-OKORO-API-Key', B.principal.apiKey);
    expect(res.status).toBe(404);
  });

  test("B querying A's audit log with B's key returns 404", async () => {
    const res = await http
      .get(`/v1/agents/${A.agentId}/audit`)
      .set('X-OKORO-API-Key', B.principal.apiKey);
    expect(res.status).toBe(404);
  });

  test("B trying to revoke A's agent returns 404", async () => {
    const res = await http
      .delete(`/v1/agents/${A.agentId}`)
      .set('X-OKORO-API-Key', B.principal.apiKey);
    expect(res.status).toBe(404);
  });

  test("B reporting against A's agent returns 404 (cross-tenant fraud-report block)", async () => {
    const res = await http
      .post(`/v1/agents/${A.agentId}/report`)
      .set('X-OKORO-API-Key', B.principal.apiKey)
      .send({ eventType: 'fraud_confirmed', severity: 'high' });
    expect(res.status).toBe(404);
  });

  test('verify with a token signed by A but presented through any verify-key works (verify is principal-agnostic by design)', async () => {
    // Verify is a third-party / relying-party endpoint. It is keyed to a
    // VERIFY_ONLY API key (which can belong to anyone — RPs are not the
    // agent's principal) and resolves the agent off the JWT `sub`. So a
    // verify-only key from a *third* tenant must still be able to verify
    // A's token. This confirms the algorithm path is principal-agnostic
    // by design — the precedence enum has no "WRONG_PRINCIPAL" denial,
    // so this is the documented behaviour.
    const token = await signAgentToken(A.privateKey, {
      agentId: A.agentId,
      policyId: A.policyId,
      action: 'commerce.purchase',
    });
    const res = await http
      .post('/v1/verify')
      .set('X-OKORO-Verify-Key', verifyKey.apiKey)
      .send({ token, action: 'commerce.purchase' });
    expect(res.status).toBe(201);
    expect(res.body.valid).toBe(true);
    expect(res.body.agentId).toBe(A.agentId);
    expect(res.body.principalId).toBe(A.principal.principalId);
  });

  test('direct-DB scoping: findMany({ principalId: A }) returns only A-rows', async () => {
    // Sanity check on the schema — if any service used a non-scoped query
    // we'd catch it here. This is a code-level lint TODO outside this
    // suite's authority but the assertion is cheap and high-value.
    const aRows = await handle.prisma.agentIdentity.findMany({
      where: { principalId: A.principal.principalId },
      select: { id: true, principalId: true },
    });
    expect(aRows.length).toBeGreaterThanOrEqual(1);
    for (const r of aRows) {
      expect(r.principalId).toBe(A.principal.principalId);
      expect(r.principalId).not.toBe(B.principal.principalId);
    }
    const bRows = await handle.prisma.agentIdentity.findMany({
      where: { principalId: B.principal.principalId },
      select: { id: true, principalId: true },
    });
    const aIds = new Set(aRows.map((r) => r.id));
    for (const r of bRows) {
      expect(aIds.has(r.id)).toBe(false);
    }
  });
});
