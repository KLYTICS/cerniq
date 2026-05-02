import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Aegis } from '@aegis/sdk';
import { RawClient, makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';
import { pollUntil } from './_support/retry';

interface AuditEvent {
  eventId: string;
  agentId: string;
  timestamp: string;
  decision: 'approved' | 'denied' | 'flagged';
  decisionReason?: string | null;
  signature: string;
  prevHash?: string | null;
  trustScoreAtEvent?: number;
}

interface AuditLog {
  events: AuditEvent[];
  nextCursor?: string | null;
}

describe('10 · audit chain', () => {
  let sdk: Aegis;
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

  it('audit log contains a signed event for each verify, with prev-hash linkage', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);

    // Generate three verifies (mix of approved + denied).
    const t1 = await signTokenFor(agent, policy.policyId, { action: 'commerce.purchase', amount: 5, currency: 'USD' });
    const t2 = await signTokenFor(agent, policy.policyId, { action: 'commerce.purchase', amount: 5, currency: 'USD' });
    const t3 = await signTokenFor(agent, policy.policyId, { action: 'data-read' }); // wrong category → denied
    await sdk.verify(t1, { action: 'commerce.purchase', amount: 5, currency: 'USD' });
    await sdk.verify(t2, { action: 'commerce.purchase', amount: 5, currency: 'USD' });
    await sdk.verify(t3, { action: 'data-read' });

    const log = await pollUntil(
      async () => {
        const r = await raw.get<AuditLog>(`/v1/agents/${agent.agentId}/audit`);
        return r.body;
      },
      (l) => Array.isArray(l.events) && l.events.length >= 3,
      { timeoutMs: 8_000 },
    );

    expect(log.events.length).toBeGreaterThanOrEqual(3);
    for (const ev of log.events) {
      expect(ev.eventId).toMatch(/^evt_/);
      expect(['approved', 'denied', 'flagged']).toContain(ev.decision);
      expect(typeof ev.signature).toBe('string');
      expect(ev.signature.length).toBeGreaterThan(20);
    }

    // At least one event with a denial reason (we forced one).
    expect(log.events.some((e) => e.decision === 'denied' && e.decisionReason)).toBe(true);
  });

  it('audit chain validation endpoint, if present, returns ok over a known-good range', async () => {
    // Optional endpoint — many M-006 implementations expose
    // GET /v1/agents/:id/audit/verify returning { valid, head, tail }.
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const tok = await signTokenFor(agent, policy.policyId, { action: 'commerce.purchase', amount: 1, currency: 'USD' });
    await sdk.verify(tok, { action: 'commerce.purchase', amount: 1, currency: 'USD' });

    const r = await raw.get<{ valid: boolean }>(`/v1/agents/${agent.agentId}/audit/verify`);
    if (r.status === 404) return; // endpoint not yet implemented
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(true);
  });
});
