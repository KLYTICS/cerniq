// Tiny raw-JSON helper for tools whose backing endpoint is not yet
// modeled in `@aegis/sdk`. The MCP tool surface is part of AEGIS's
// public API (ADR-0008 §2 — tool names cannot be silently dropped), so
// when the typed SDK lags an endpoint we go through this rather than
// either (a) fabricating SDK methods or (b) reaching into the SDK's
// private `http` field.

export interface RawHttpInit {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export interface RawHttp {
  json<T = unknown>(path: string, init?: RawHttpInit): Promise<T>;
}

export function createRawHttp(baseUrl: string, apiKey: string): RawHttp {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async json<T>(path: string, init?: RawHttpInit): Promise<T> {
      const query = init?.query
        ? '?' +
          Object.entries(init.query)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')
        : '';
      const url = `${base}${path.startsWith('/') ? path : '/' + path}${query}`;
      const res = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: {
          'X-AEGIS-API-Key': apiKey,
          Accept: 'application/json',
          ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}
