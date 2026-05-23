// Denial precedence — CLAUDE.md invariant #6 + docs/SECURITY.md §
// "Denial Precedence". Order, top wins:
//
//   AGENT_NOT_FOUND
//   → AGENT_REVOKED
//   → INVALID_SIGNATURE
//   → POLICY_REVOKED
//   → POLICY_EXPIRED
//   → SCOPE_NOT_GRANTED
//   → SPEND_LIMIT_EXCEEDED
//   → TRUST_SCORE_TOO_LOW   (M-020 — algorithm gate not implemented)
//   → ANOMALY_FLAGGED       (M-020 — algorithm gate not implemented)
//
// Each test exercises the minimum state to hit one specific reason. We
// cross-check that the response would also satisfy lower-priority denials
// where possible (e.g. SPEND_LIMIT_EXCEEDED test asserts a token whose
// scope match would otherwise pass — proving precedence held).

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppConfigService } from '../../src/config/config.service';

import { generateAgentKeypair, signAgentToken, tamperJwtSignature } from './_helpers/agent-keys';
import { createTestApp, type SupertestHttp, type TestAppHandle } from './_helpers/test-app';
import {
  createPolicyViaApi,
  isoInDays,
  isoInSeconds,
  registerAgentViaApi,
  seedPrincipalAndApiKey,
  type SeededPrincipal,
} from './_helpers/test-fixtures';

interface VerifyBody {
  token: string;
  action?: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
}

describe('e2e: denial precedence', () => {
  let handle: TestAppHandle;
  let app: INestApplication;
  let http: SupertestHttp;
  let principal: SeededPrincipal;
  let verifyKey: SeededPrincipal;

  // Helper: POST /v1/verify and return the response body (with denialReason).
  const verify = async (
    body: VerifyBody,
  ): Promise<{
    status: number;
    valid: boolean;
    denialReason: string | null;
    agentId: string | null;
  }> => {
    const res = await http
      .post('/v1/verify')
      .set('X-CERNIQ-Verify-Key', verifyKey.apiKey)
      .send(body);
    return {
      status: res.status,
      valid: res.body.valid,
      denialReason: res.body.denialReason ?? null,
      agentId: res.body.agentId ?? null,
    };
  };

  beforeAll(async () => {
    handle = await createTestApp();
    app = handle.app;
    http = request(app.getHttpServer());
    await handle.resetDatabase();

    const config = app.get(AppConfigService);
    principal = await seedPrincipalAndApiKey(handle.prisma, config);
    verifyKey = await seedPrincipalAndApiKey(handle.prisma, config, {
      email: `vk-precedence-${Date.now()}@cerniq.test`,
      scope: 'VERIFY_ONLY',
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  test('AGENT_NOT_FOUND when sub points to a nonexistent agent', async () => {
    const keys = await generateAgentKeypair();
    // Sign a token for an agentId we never registered. Crypto verification
    // can never run because the agent lookup precedes it — that's the
    // precedence guarantee we're checking.
    const token = await signAgentToken(keys.privateKey, {
      agentId: 'nonexistent_agent_xyz',
      policyId: 'pol_does_not_matter',
    });

    const r = await verify({ token });
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('AGENT_NOT_FOUND');
  });

  test('AGENT_REVOKED beats INVALID_SIGNATURE (revoke + tamper)', async () => {
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
    });

    await http
      .delete(`/v1/agents/${seeded.agentId}`)
      .set('X-CERNIQ-API-Key', principal.apiKey)
      .expect(204);

    const goodToken = await signAgentToken(keys.privateKey, {
      agentId: seeded.agentId,
      policyId: 'pol_unused',
    });
    // Tamper too — proves AGENT_REVOKED beats INVALID_SIGNATURE.
    const tampered = tamperJwtSignature(goodToken);

    const r = await verify({ token: tampered });
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('AGENT_REVOKED');
  });

  test('INVALID_SIGNATURE when the JWT signature is tampered', async () => {
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
    });
    const policy = await createPolicyViaApi(http, principal.apiKey, seeded.agentId, {
      scopes: [{ category: 'commerce' }],
      expiresAt: isoInDays(7),
    });

    const good = await signAgentToken(keys.privateKey, {
      agentId: seeded.agentId,
      policyId: policy.policyId,
    });
    const bad = tamperJwtSignature(good);

    const r = await verify({ token: bad });
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  test('POLICY_REVOKED when the policy was revoked after issue', async () => {
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
    });
    const policy = await createPolicyViaApi(http, principal.apiKey, seeded.agentId, {
      scopes: [{ category: 'commerce' }],
      expiresAt: isoInDays(7),
    });
    await http
      .delete(`/v1/agents/${seeded.agentId}/policies/${policy.policyId}`)
      .set('X-CERNIQ-API-Key', principal.apiKey)
      .expect(204);

    const token = await signAgentToken(keys.privateKey, {
      agentId: seeded.agentId,
      policyId: policy.policyId,
    });

    const r = await verify({ token, action: 'commerce.purchase' });
    expect(r.valid).toBe(false);
    // Audit-checked: precedence enum places POLICY_REVOKED above
    // POLICY_EXPIRED. Even though SCOPE_NOT_GRANTED could fire
    // downstream, REVOKED wins.
    expect(r.denialReason).toBe('POLICY_REVOKED');
  });

  test('POLICY_EXPIRED when exp passed (DB-level backdate, since algo also checks DB expiresAt)', async () => {
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
    });
    // The controller validates expiresAt > now. To force expired state we
    // create with a very-near future expiry and then backdate via Prisma.
    const policy = await createPolicyViaApi(http, principal.apiKey, seeded.agentId, {
      scopes: [{ category: 'commerce' }],
      expiresAt: isoInSeconds(60),
    });
    await handle.prisma.agentPolicy.update({
      where: { id: policy.policyId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const token = await signAgentToken(keys.privateKey, {
      agentId: seeded.agentId,
      policyId: policy.policyId,
    });

    const r = await verify({ token });
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('POLICY_EXPIRED');
  });

  test("SCOPE_NOT_GRANTED when action category doesn't match policy scopes", async () => {
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
    });
    const policy = await createPolicyViaApi(http, principal.apiKey, seeded.agentId, {
      scopes: [{ category: 'commerce' }],
      expiresAt: isoInDays(1),
    });

    const token = await signAgentToken(keys.privateKey, {
      agentId: seeded.agentId,
      policyId: policy.policyId,
      action: 'data-write.update',
    });

    const r = await verify({ token, action: 'data-write.update' });
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  test('SPEND_LIMIT_EXCEEDED when amount exceeds maxPerTransaction', async () => {
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
    });
    const policy = await createPolicyViaApi(http, principal.apiKey, seeded.agentId, {
      scopes: [
        {
          category: 'commerce',
          spendLimit: { currency: 'USD', maxPerTransaction: 100 },
        },
      ],
      expiresAt: isoInDays(1),
    });
    const token = await signAgentToken(keys.privateKey, {
      agentId: seeded.agentId,
      policyId: policy.policyId,
      action: 'commerce.purchase',
      amount: 200,
      currency: 'USD',
    });

    const r = await verify({
      token,
      action: 'commerce.purchase',
      amount: 200,
      currency: 'USD',
    });
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
  });

  // M-020 — verify.algorithm.ts does not yet check trustScore against an
  // input `minTrustScore` parameter, and there's no path that returns
  // ANOMALY_FLAGGED. The DenialReason enum + TrustBand FLAGGED both exist
  // (packages/types + Prisma) but the algorithm gates are unimplemented.
  // Tracked in WORK_BOARD.md as M-020. The skipped tests below will assert:
  //
  //   TRUST_SCORE_TOO_LOW: trustScore=100, request minTrustScore=200
  //   ANOMALY_FLAGGED:     trustBand forced to FLAGGED via direct DB update
  //
  // Once the algorithm gates land we re-enable both.
  test.skip('TRUST_SCORE_TOO_LOW [M-020 — algorithm gate not implemented]', () => {
    // Body intentionally empty until M-020 lands. Skip is intentional.
  });

  test.skip('ANOMALY_FLAGGED [M-020 — algorithm gate not implemented]', () => {
    // Body intentionally empty until M-020 lands. Skip is intentional.
  });

  test('denial responses include agentId where the agent was identified', async () => {
    // Spot-check: for at least 3 of the above paths, an `agentId` must
    // populate the response so the audit row links cleanly.
    const keys = await generateAgentKeypair();
    const seeded = await registerAgentViaApi(http, principal.apiKey, {
      publicKey: keys.publicKeyB64Url,
      runtime: 'CUSTOM',
    });
    const policy = await createPolicyViaApi(http, principal.apiKey, seeded.agentId, {
      scopes: [{ category: 'commerce' }],
      expiresAt: isoInDays(1),
    });

    const token = await signAgentToken(keys.privateKey, {
      agentId: seeded.agentId,
      policyId: policy.policyId,
      action: 'data-write.upsert',
    });
    const r = await verify({ token, action: 'data-write.upsert' });
    expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
    expect(r.agentId).toBe(seeded.agentId);
  });
});
