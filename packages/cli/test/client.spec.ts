import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rawJson, CliError } from '../src/client.js';
import * as credentials from '../src/credentials.js';

describe('rawJson', () => {
  beforeEach(() => {
    vi.spyOn(credentials, 'resolveCredentials').mockResolvedValue({
      apiKey: 'aegis_sk_test',
      baseUrl: 'https://api.example.test',
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues an authenticated GET against the configured base URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }) as never);

    const result = await rawJson<{ ok: boolean }>('/v1/audit-events?limit=10');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/audit-events?limit=10');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-AEGIS-API-Key']).toBe('aegis_sk_test');
    expect(headers.Accept).toBe('application/json');
  });

  it('throws a typed CliError when the upstream returns non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404 }) as never,
    );
    await expect(rawJson('/v1/missing')).rejects.toBeInstanceOf(CliError);
  });

  it('joins the path correctly when the base URL has a trailing slash', async () => {
    vi.spyOn(credentials, 'resolveCredentials').mockResolvedValue({
      apiKey: 'aegis_sk_test',
      baseUrl: 'https://api.example.test/',
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }) as never);

    await rawJson('/v1/agents');

    expect(fetchSpy.mock.calls[0]![0]).toBe('https://api.example.test/v1/agents');
  });
});
