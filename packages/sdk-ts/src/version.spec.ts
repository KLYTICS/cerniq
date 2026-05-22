// Tests for API version pinning end-to-end.
//
// What this spec guards:
//   1. Header sent on out-request when apiVersion is pinned.
//   2. Header omitted when apiVersion is unset (default behavior —
//      server uses current version).
//   3. Reserved-header contract: opts.headers.Aegis-Version cannot
//      override the pinned value (config is source of truth).
//   4. parseVersionResponse: returns undefined when no deprecation
//      header; returns structured info when deprecation present;
//      surfaces latest-version when also present; case-insensitive.
//   5. onApiVersionDeprecated callback: fires on deprecation header;
//      does NOT fire when header absent; does NOT fire when apiVersion
//      unset; survives subscriber-throw (hot path doesn't break).

import { HttpClient } from './http.js';
import {
  API_VERSION_HEADER,
  DEPRECATION_HEADER,
  LATEST_VERSION_HEADER,
  parseVersionResponse,
  type ApiVersionDeprecationInfo,
} from './version.js';

function captureFetch(): {
  fetch: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
  setResponse: (status: number, headers: Record<string, string>) => void;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let responseStatus = 200;
  let responseHeaders: Record<string, string> = {};
  return {
    calls,
    setResponse: (status, headers) => {
      responseStatus = status;
      responseHeaders = headers;
    },
    fetch: async (input, init) => {
      const headersMap: Record<string, string> = {};
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          headersMap[k] = v;
        }
      }
      calls.push({ url: String(input), headers: headersMap });
      return new Response('{"ok":true}', {
        status: responseStatus,
        headers: {
          'content-type': 'application/json',
          ...responseHeaders,
        },
      });
    },
  };
}

function buildClient(opts: {
  fetch: typeof fetch;
  apiVersion?: string;
  onApiVersionDeprecated?: (info: ApiVersionDeprecationInfo) => void;
}): HttpClient {
  return new HttpClient({
    apiKey: 'aegis_sk_test',
    verifyKey: undefined,
    baseUrl: 'https://api.test.local',
    timeoutMs: 5000,
    fetch: opts.fetch,
    ...(opts.apiVersion !== undefined ? { apiVersion: opts.apiVersion } : {}),
    ...(opts.onApiVersionDeprecated !== undefined
      ? { onApiVersionDeprecated: opts.onApiVersionDeprecated }
      : {}),
  });
}

describe('Aegis-Version request header', () => {
  it('is sent on out-request when apiVersion is pinned', async () => {
    const captured = captureFetch();
    const client = buildClient({ fetch: captured.fetch, apiVersion: '2026-05-22' });
    await client.request('/agents', { method: 'GET' });
    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0]!.headers[API_VERSION_HEADER]).toBe('2026-05-22');
  });

  it('is omitted when apiVersion is unset', async () => {
    const captured = captureFetch();
    const client = buildClient({ fetch: captured.fetch });
    await client.request('/agents', { method: 'GET' });
    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0]!.headers[API_VERSION_HEADER]).toBeUndefined();
  });

  it('is sent on every request, not just the first', async () => {
    const captured = captureFetch();
    const client = buildClient({ fetch: captured.fetch, apiVersion: '2026-05-22' });
    await client.request('/agents', { method: 'GET' });
    await client.request('/agents/agt_1', { method: 'GET' });
    await client.request('/agents/agt_2', { method: 'GET' });
    expect(captured.calls).toHaveLength(3);
    for (const call of captured.calls) {
      expect(call.headers[API_VERSION_HEADER]).toBe('2026-05-22');
    }
  });

  it('cannot be overridden via opts.headers (reserved-header contract)', async () => {
    const captured = captureFetch();
    const client = buildClient({ fetch: captured.fetch, apiVersion: '2026-05-22' });
    await client.request('/agents', {
      method: 'GET',
      headers: { 'Aegis-Version': '2025-01-01' }, // attacker / mistake
    });
    expect(captured.calls[0]!.headers[API_VERSION_HEADER]).toBe('2026-05-22');
    // Belt-and-braces: also the lowercase form
    expect(captured.calls[0]!.headers['aegis-version']).toBeUndefined();
  });
});

describe('parseVersionResponse', () => {
  it('returns undefined when no deprecation header is present', () => {
    expect(
      parseVersionResponse({}, 'https://api.test/agents', '2026-05-22'),
    ).toBeUndefined();
    expect(
      parseVersionResponse({ 'content-type': 'application/json' }, 'https://api.test/agents', '2026-05-22'),
    ).toBeUndefined();
  });

  it('returns deprecation info when the header is present', () => {
    const info = parseVersionResponse(
      { [DEPRECATION_HEADER]: '2027-01-01' },
      'https://api.test/agents',
      '2026-05-22',
    );
    expect(info).toEqual({
      pinnedVersion: '2026-05-22',
      deprecatedAt: '2027-01-01',
      requestUrl: 'https://api.test/agents',
    });
  });

  it('surfaces latestVersion when both headers are present', () => {
    const info = parseVersionResponse(
      {
        [DEPRECATION_HEADER]: '2027-01-01',
        [LATEST_VERSION_HEADER]: '2026-12-15',
      },
      'https://api.test/agents',
      '2026-05-22',
    );
    expect(info).toEqual({
      pinnedVersion: '2026-05-22',
      deprecatedAt: '2027-01-01',
      latestVersion: '2026-12-15',
      requestUrl: 'https://api.test/agents',
    });
  });

  it('is case-insensitive on header lookup', () => {
    const info = parseVersionResponse(
      {
        'aegis-deprecation': '2027-01-01',
        'AEGIS-LATEST-VERSION': '2026-12-15',
      },
      'https://api.test/agents',
      '2026-05-22',
    );
    expect(info?.deprecatedAt).toBe('2027-01-01');
    expect(info?.latestVersion).toBe('2026-12-15');
  });

  it('treats empty deprecation value as absent', () => {
    expect(
      parseVersionResponse(
        { [DEPRECATION_HEADER]: '' },
        'https://api.test/agents',
        '2026-05-22',
      ),
    ).toBeUndefined();
  });

  it('works with Web API Headers', () => {
    const h = new Headers();
    h.set(DEPRECATION_HEADER, '2027-01-01');
    h.set(LATEST_VERSION_HEADER, '2026-12-15');
    const info = parseVersionResponse(h, 'https://api.test/agents', '2026-05-22');
    expect(info?.deprecatedAt).toBe('2027-01-01');
    expect(info?.latestVersion).toBe('2026-12-15');
  });
});

describe('onApiVersionDeprecated hook', () => {
  it('fires when response carries Aegis-Deprecation header', async () => {
    const captured = captureFetch();
    captured.setResponse(200, {
      [DEPRECATION_HEADER]: '2027-01-01',
      [LATEST_VERSION_HEADER]: '2026-12-15',
    });
    const fired: ApiVersionDeprecationInfo[] = [];
    const client = buildClient({
      fetch: captured.fetch,
      apiVersion: '2026-05-22',
      onApiVersionDeprecated: (info) => fired.push(info),
    });
    await client.request('/agents', { method: 'GET' });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toEqual({
      pinnedVersion: '2026-05-22',
      deprecatedAt: '2027-01-01',
      latestVersion: '2026-12-15',
      requestUrl: 'https://api.test.local/v1/agents',
    });
  });

  it('does NOT fire when response has no deprecation header', async () => {
    const captured = captureFetch();
    const fired: ApiVersionDeprecationInfo[] = [];
    const client = buildClient({
      fetch: captured.fetch,
      apiVersion: '2026-05-22',
      onApiVersionDeprecated: (info) => fired.push(info),
    });
    await client.request('/agents', { method: 'GET' });
    expect(fired).toHaveLength(0);
  });

  it('does NOT fire when apiVersion is unset (no pin = no deprecation surface)', async () => {
    const captured = captureFetch();
    captured.setResponse(200, { [DEPRECATION_HEADER]: '2027-01-01' });
    const fired: ApiVersionDeprecationInfo[] = [];
    const client = buildClient({
      fetch: captured.fetch,
      // apiVersion intentionally unset
      onApiVersionDeprecated: (info) => fired.push(info),
    });
    await client.request('/agents', { method: 'GET' });
    expect(fired).toHaveLength(0);
  });

  it('does NOT fire when callback is unset (server header present but no subscriber)', async () => {
    const captured = captureFetch();
    captured.setResponse(200, { [DEPRECATION_HEADER]: '2027-01-01' });
    const client = buildClient({
      fetch: captured.fetch,
      apiVersion: '2026-05-22',
      // onApiVersionDeprecated intentionally unset
    });
    // Just needs to not throw.
    await expect(client.request('/agents', { method: 'GET' })).resolves.toBeDefined();
  });

  it('survives subscriber-throw — response hot path does not break', async () => {
    const captured = captureFetch();
    captured.setResponse(200, { [DEPRECATION_HEADER]: '2027-01-01' });
    const client = buildClient({
      fetch: captured.fetch,
      apiVersion: '2026-05-22',
      onApiVersionDeprecated: () => {
        throw new Error('subscriber blew up');
      },
    });
    // The customer's request must still complete normally; the
    // subscriber error is swallowed (it's an observability hook,
    // not part of the wire contract).
    const result = await client.request<{ ok: boolean }>('/agents', { method: 'GET' });
    expect(result).toEqual({ ok: true });
  });

  it('fires on every deprecating response, not just the first', async () => {
    const captured = captureFetch();
    captured.setResponse(200, { [DEPRECATION_HEADER]: '2027-01-01' });
    const fired: ApiVersionDeprecationInfo[] = [];
    const client = buildClient({
      fetch: captured.fetch,
      apiVersion: '2026-05-22',
      onApiVersionDeprecated: (info) => fired.push(info),
    });
    await client.request('/agents', { method: 'GET' });
    await client.request('/agents/agt_1', { method: 'GET' });
    expect(fired).toHaveLength(2);
    // Each carries its own request URL — useful for routing alerts.
    expect(fired[0]!.requestUrl).toContain('/v1/agents');
    expect(fired[1]!.requestUrl).toContain('/v1/agents/agt_1');
  });
});

describe('header name constant locks the wire contract', () => {
  // Operator decision 2026-05-22 (M-VERSION-1): bare `Aegis-Version`
  // per Stripe-shape + RFC 6648. Changing this is part of the
  // customer-observable contract; flipping requires CHANGELOG +
  // customer release notes.
  it('API_VERSION_HEADER is exactly "Aegis-Version"', () => {
    expect(API_VERSION_HEADER).toBe('Aegis-Version');
  });
  it('LATEST_VERSION_HEADER is exactly "Aegis-Latest-Version"', () => {
    expect(LATEST_VERSION_HEADER).toBe('Aegis-Latest-Version');
  });
  it('DEPRECATION_HEADER is exactly "Aegis-Deprecation"', () => {
    expect(DEPRECATION_HEADER).toBe('Aegis-Deprecation');
  });
});
