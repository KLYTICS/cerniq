/**
 * Thin wrapper that combines:
 *
 *   - the public @okoro/sdk client (typed convenience methods)
 *   - a raw fetch helper for endpoints the SDK does not yet cover
 *     (token sign for tests, audit log GET, well-known JWKS, /metrics).
 *
 * Why both: the SDK is the supported surface for normal callers, but the
 * test harness deliberately reaches behind the SDK to exercise the raw
 * HTTP contract — including endpoints that should *not* be in the public
 * SDK (admin, internal, audit-chain validation).
 */

import { Okoro } from '@okoro/sdk';
import {
  OKORO_HEADER_API_KEY,
  OKORO_HEADER_IDEMPOTENCY,
  OKORO_HEADER_REQUEST_ID,
  OKORO_HEADER_VERIFY_KEY,
} from '@okoro/types';

export interface E2EConfig {
  baseUrl: string;
  apiKey: string;
  verifyKey?: string;
}

export interface RawResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Headers;
  body: T;
  text: string;
}

export function readConfig(): E2EConfig {
  const baseUrl = (process.env['OKORO_E2E_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
  const apiKey = process.env['OKORO_E2E_API_KEY'];
  if (!apiKey) {
    // setup.ts should have skipped before this is reached, but fail loudly
    // if a test file is run in isolation without the env var.
    throw new Error('OKORO_E2E_API_KEY is required (set it before running vitest).');
  }
  return {
    baseUrl,
    apiKey,
    verifyKey: process.env['OKORO_E2E_VERIFY_KEY'],
  };
}

export function makeSdk(cfg: E2EConfig): Okoro {
  // Verify-only key falls back to the management key when not separately
  // provided — FULL-scope keys are accepted on the verify endpoint per
  // api-key.guard. Lets the harness exercise verify() without minting two
  // keys in the seed.
  return new Okoro({
    apiKey: cfg.apiKey,
    verifyKey: cfg.verifyKey ?? cfg.apiKey,
    baseUrl: cfg.baseUrl,
  });
}

/**
 * Raw HTTP helpers — no SDK envelope. Tests assert on status codes and
 * body shapes directly because the SDK throws on non-2xx, which would
 * mask the very contract we want to verify.
 */
export class RawClient {
  constructor(private readonly cfg: E2EConfig) {}

  private url(path: string): string {
    if (path.startsWith('http')) return path;
    return `${this.cfg.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
  }

  private headers(opts: { auth?: 'api' | 'verify' | 'none'; idempotencyKey?: string } = {}): HeadersInit {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    const mode = opts.auth ?? 'api';
    if (mode === 'api') h[OKORO_HEADER_API_KEY] = this.cfg.apiKey;
    if (mode === 'verify') h[OKORO_HEADER_VERIFY_KEY] = this.cfg.verifyKey ?? this.cfg.apiKey;
    if (opts.idempotencyKey) h[OKORO_HEADER_IDEMPOTENCY] = opts.idempotencyKey;
    return h;
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    init: { body?: unknown; auth?: 'api' | 'verify' | 'none'; idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<RawResponse<T>> {
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers({ auth: init.auth, idempotencyKey: init.idempotencyKey }),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
    const text = await res.text();
    let body: unknown = undefined;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      body: body as T,
      text,
    };
  }

  get<T = unknown>(path: string, opts?: { auth?: 'api' | 'verify' | 'none' }): Promise<RawResponse<T>> {
    return this.request<T>('GET', path, opts);
  }

  post<T = unknown>(
    path: string,
    body: unknown,
    opts: { auth?: 'api' | 'verify' | 'none'; idempotencyKey?: string } = {},
  ): Promise<RawResponse<T>> {
    return this.request<T>('POST', path, { body, ...opts });
  }

  del<T = unknown>(path: string, opts?: { auth?: 'api' | 'verify' | 'none' }): Promise<RawResponse<T>> {
    return this.request<T>('DELETE', path, opts);
  }

  /**
   * Last-resort: pull the request id off a response for human-friendly
   * failure messages.
   */
  static requestIdOf(res: RawResponse): string | undefined {
    return res.headers.get(OKORO_HEADER_REQUEST_ID) ?? undefined;
  }
}
