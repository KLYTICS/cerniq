import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Cerniq, generateKeypair } from '@cerniq/sdk';
import type { AgentRecord } from '@cerniq/sdk';
import { RawClient, makeSdk, readConfig } from './_support/client';
import { createAgent } from './_support/fixtures';

describe('03 · agent identity', () => {
  let sdk: Cerniq;
  let raw: RawClient;
  const created: string[] = [];

  beforeAll(() => {
    const cfg = readConfig();
    sdk = makeSdk(cfg);
    raw = new RawClient(cfg);
  });

  afterAll(async () => {
    // Best-effort cleanup. Failures here must not mask test failures.
    for (const id of created) {
      try {
        await sdk.agents.revoke(id);
      } catch {
        /* ignore */
      }
    }
  });

  it('register agent with valid Ed25519 public key returns 201 + ACTIVE', async () => {
    const a = await createAgent(sdk, { runtime: 'anthropic', label: 'shopping-test' });
    created.push(a.agentId);
    expect(a.agentId).toMatch(/^agt_/);
    expect(a.record.status).toMatch(/active|ACTIVE/i);
    expect(a.record.trustScore).toBeGreaterThanOrEqual(0);
    expect(a.record.trustScore).toBeLessThanOrEqual(1000);
    expect(a.record.trustBand).toMatch(/PLATINUM|VERIFIED|WATCH|FLAGGED/);
  });

  it('register agent with invalid public key is rejected with 400', async () => {
    const r = await raw.post('/v1/agents/register', {
      publicKey: 'not-a-valid-key-too-short',
      runtime: 'anthropic',
    });
    expect(r.status).toBe(400);
  });

  it('GET /v1/agents/:id returns the agent for its owning principal', async () => {
    const a = await createAgent(sdk);
    created.push(a.agentId);
    const r = await sdk.agents.get(a.agentId);
    expect(r.agentId).toBe(a.agentId);
    expect(r.publicKey).toBe(a.publicKey);
  });

  it('GET /v1/agents/:id/status is public (no auth required)', async () => {
    const a = await createAgent(sdk);
    created.push(a.agentId);
    const r = await raw.get<AgentRecord>(`/v1/agents/${a.agentId}/status`, { auth: 'none' });
    expect(r.status).toBe(200);
    expect(r.body.agentId).toBe(a.agentId);
    expect(typeof r.body.trustScore).toBe('number');
  });

  it('multi-agent same principal — both visible, distinct IDs', async () => {
    const a = await createAgent(sdk, { runtime: 'anthropic' });
    const b = await createAgent(sdk, { runtime: 'openai' });
    created.push(a.agentId, b.agentId);
    expect(a.agentId).not.toBe(b.agentId);
    const got = await Promise.all([sdk.agents.get(a.agentId), sdk.agents.get(b.agentId)]);
    expect(got[0].agentId).toBe(a.agentId);
    expect(got[1].agentId).toBe(b.agentId);
  });

  it('cross-principal isolation: another principal cannot see this agent (skipped if no second key)', async () => {
    const second = process.env['CERNIQ_E2E_API_KEY_2'];
    if (!second) {
      // Document, do not fail. The harness only requires one principal key
      // by default. Set CERNIQ_E2E_API_KEY_2 to a second principal's key
      // (issued by the same instance) to exercise this path.
      return;
    }
    const a = await createAgent(sdk);
    created.push(a.agentId);
    const cfg = readConfig();
    const otherRaw = new RawClient({ ...cfg, apiKey: second });
    const r = await otherRaw.get(`/v1/agents/${a.agentId}`);
    expect([403, 404]).toContain(r.status);
  });

  it('public key is base64url, not base64 with +/=  (regression — v1 used base64)', async () => {
    const kp = await generateKeypair();
    expect(kp.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(kp.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
