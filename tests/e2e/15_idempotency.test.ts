import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Cerniq } from '@cerniq/sdk';
import { RawClient, makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, futureIso } from './_support/fixtures';

/**
 * Idempotency-Key on POSTs. The contract: if two requests carry the same
 * Idempotency-Key, body, and target, the server returns the same response
 * (and only commits the side effect once).
 *
 * Tested against /v1/agents/:id/policies because policy creation is the
 * cleanest "creates a row" endpoint with a deterministic response shape.
 */
describe('15 · idempotency', () => {
  let sdk: Cerniq;
  let raw: RawClient;
  const cleanup: string[] = [];

  beforeAll(() => {
    const cfg = readConfig();
    sdk = makeSdk(cfg);
    raw = new RawClient(cfg);
  });

  afterAll(async () => {
    for (const id of cleanup) {
      try {
        await sdk.agents.revoke(id);
      } catch {
        /* ignore */
      }
    }
  });

  it('repeating POST /policies with the same Idempotency-Key returns the same policyId', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const key = `e2e-${randomUUID()}`;

    const body = {
      scopes: [SCOPES.commerce({ maxPerTransaction: 50 })],
      expiresAt: futureIso(),
      label: 'idempotent-test',
    };

    const first = await raw.post<{ policyId?: string }>(
      `/v1/agents/${agent.agentId}/policies`,
      body,
      { idempotencyKey: key },
    );

    if (first.status === 400 || first.status === 422) {
      // Idempotency may not be implemented; the request itself failed for
      // unrelated reasons. Surface the failure.
      throw new Error(`first request failed: ${first.status} ${JSON.stringify(first.body)}`);
    }

    expect([200, 201]).toContain(first.status);
    const id1 = first.body.policyId;
    expect(id1).toBeTruthy();

    const second = await raw.post<{ policyId?: string }>(
      `/v1/agents/${agent.agentId}/policies`,
      body,
      { idempotencyKey: key },
    );

    if (
      second.status === 409 &&
      (second.body as { error?: string }).error === 'IDEMPOTENCY_CONFLICT'
    ) {
      // Conflict means the *body* differs from the first — should not happen
      // here. Surface as failure.
      throw new Error(
        'IDEMPOTENCY_CONFLICT on identical body — server-side body comparison is wrong.',
      );
    }

    expect([200, 201]).toContain(second.status);
    expect(second.body.policyId).toBe(id1);
  });

  it('omitting Idempotency-Key still creates distinct rows', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const body = { scopes: [SCOPES.commerce()], expiresAt: futureIso() };
    const a = await raw.post<{ policyId: string }>(`/v1/agents/${agent.agentId}/policies`, body);
    const b = await raw.post<{ policyId: string }>(`/v1/agents/${agent.agentId}/policies`, body);
    expect(a.body.policyId).not.toBe(b.body.policyId);
  });
});
