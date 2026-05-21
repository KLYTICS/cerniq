// AgentClient.list + AuditClient parity tests.
//
// These methods back the dashboard's "all agents" view, the CLI's
// `aegis agents list` / `aegis audit search`, and the MCP server's
// `aegis.agents.list` / `aegis.audit.search` tools. The contract here
// matches the API DTOs (apps/api/src/modules/identity/identity.dto.ts
// ListAgentsQueryDto + AgentListResponseDto, apps/api/src/modules/audit/
// audit.dto.ts AuditQueryDto + AuditLogResponseDto). Drift between this
// and the API DTOs is caught at integration time; this spec catches
// regressions in the SDK's URL/query encoding before they ship.

import { Aegis } from './index.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function mkClient(response: unknown): { client: Aegis; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new Aegis({
    apiKey: 'aegis_sk_test',
    baseUrl: 'https://api.example.test',
    fetch: fetchFn,
  });
  return { client, calls };
}

describe('AgentClient.list', () => {
  test('encodes all filter params into the query string and hits GET /v1/agents', async () => {
    const page = { agents: [], nextCursor: null, total: 0 };
    const { client, calls } = mkClient(page);

    const result = await client.agents.list({
      limit: 25,
      cursor: 'cur_abc',
      status: 'ACTIVE',
      runtime: 'ANTHROPIC',
      search: 'support-bot',
    });

    expect(result).toEqual(page);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/agents');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('cur_abc');
    expect(url.searchParams.get('status')).toBe('ACTIVE');
    expect(url.searchParams.get('runtime')).toBe('ANTHROPIC');
    expect(url.searchParams.get('search')).toBe('support-bot');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers['X-AEGIS-API-Key']).toBe('aegis_sk_test');
  });

  test('omits undefined filter params (no empty query keys)', async () => {
    const { client, calls } = mkClient({ agents: [], nextCursor: null, total: 0 });

    await client.agents.list();

    const url = new URL(calls[0]!.url);
    expect(url.search).toBe('');
  });

  test('returns the parsed AgentListPage shape verbatim', async () => {
    const page = {
      agents: [
        {
          agentId: 'agt_1',
          publicKey: 'AAAA',
          principalId: 'prin_1',
          runtime: 'OPENAI',
          status: 'ACTIVE',
          trustScore: 800,
          trustBand: 'VERIFIED',
          registeredAt: '2026-05-20T00:00:00Z',
        },
      ],
      nextCursor: 'cur_next',
      total: 42,
    };
    const { client } = mkClient(page);

    const result = await client.agents.list();
    expect(result.agents[0]!.agentId).toBe('agt_1');
    expect(result.nextCursor).toBe('cur_next');
    expect(result.total).toBe(42);
  });
});

describe('AuditClient.search (tenant-wide)', () => {
  test('hits GET /v1/audit-events with from/to/limit/cursor', async () => {
    const page = { events: [], nextCursor: null, count: 0 };
    const { client, calls } = mkClient(page);

    await client.audit.search({
      from: '2026-05-01T00:00:00Z',
      to: '2026-05-20T00:00:00Z',
      limit: 200,
      cursor: 'cur_2',
    });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/audit-events');
    expect(url.searchParams.get('from')).toBe('2026-05-01T00:00:00Z');
    expect(url.searchParams.get('to')).toBe('2026-05-20T00:00:00Z');
    expect(url.searchParams.get('limit')).toBe('200');
    expect(url.searchParams.get('cursor')).toBe('cur_2');
  });

  test('returns the parsed AuditLogPage with chain signature preserved', async () => {
    const event = {
      eventId: 'evt_1',
      agentId: 'agt_1',
      principalId: 'prin_1',
      timestamp: '2026-05-20T00:00:00Z',
      action: 'commerce.purchase',
      actionHash: 'abc123',
      decision: 'APPROVED',
      trustScoreAtEvent: 800,
      signature: 'ed25519-sig-bytes',
    };
    const { client } = mkClient({ events: [event], nextCursor: null, count: 1 });

    const result = await client.audit.search();
    expect(result.events[0]!.eventId).toBe('evt_1');
    expect(result.events[0]!.signature).toBe('ed25519-sig-bytes');
    expect(result.events[0]!.decision).toBe('APPROVED');
  });
});

describe('AuditClient.forAgent (per-agent)', () => {
  test('hits GET /v1/agents/:agentId/audit and URL-encodes the agentId', async () => {
    const { client, calls } = mkClient({ events: [], nextCursor: null, count: 0 });

    await client.audit.forAgent('agt with/slash', { limit: 10 });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/agents/agt%20with%2Fslash/audit');
    expect(url.searchParams.get('limit')).toBe('10');
  });
});
