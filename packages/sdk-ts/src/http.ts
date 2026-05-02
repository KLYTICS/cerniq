import { AegisInternalError, AegisNotFoundError, AegisRateLimitedError, AegisValidationError, AegisAuthenticationError, AegisAuthorizationError, AegisConflictError, AegisNetworkError } from './errors.js';

export interface HttpClientConfig {
  apiKey?: string | undefined;
  verifyKey?: string | undefined;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch | undefined;
  userAgent?: string | undefined;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  /**
   * If true, the request is sent with the verify-only key (`X-AEGIS-Verify-Key`).
   * Required for `/v1/verify` calls — the management key has too much power and
   * relying parties should never see it.
   */
  verifyOnly?: boolean;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly verifyKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly userAgent: string | undefined;

  constructor(config: HttpClientConfig) {
    this.apiKey = config.apiKey;
    this.verifyKey = config.verifyKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs;
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = config.userAgent;
  }

  async request<T>(path: string, opts: RequestOptions): Promise<T> {
    const useVerifyKey = opts.verifyOnly === true;
    const key = useVerifyKey ? this.verifyKey : this.apiKey;
    if (!key) {
      throw new Error(
        useVerifyKey
          ? 'AEGIS verifyKey is required for verify() calls.'
          : 'AEGIS apiKey is required for management calls.',
      );
    }

    const url = new URL(`/v1${path.startsWith('/') ? path : `/${path}`}`, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [useVerifyKey ? 'X-AEGIS-Verify-Key' : 'X-AEGIS-API-Key']: key,
      'X-AEGIS-Sdk': '@aegis/sdk@0.1.0',
    };
    if (this.userAgent) headers['User-Agent'] = this.userAgent;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url.toString(), {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      const payload: unknown = contentType.includes('application/json')
        ? await res.json()
        : await res.text();

      if (!res.ok) {
        const message =
          typeof payload === 'string'
            ? payload
            : (payload as { message?: string } | null)?.message ?? `AEGIS request failed (${res.status})`;
        const requestId = res.headers.get('x-request-id') ?? undefined;
        const details = typeof payload === 'object' && payload !== null ? payload : undefined;
        switch (res.status) {
          case 400:
            throw new AegisValidationError(message, 400, requestId, details);
          case 401:
            throw new AegisAuthenticationError(message, 401, requestId, details);
          case 403:
            throw new AegisAuthorizationError(message, 403, requestId, details);
          case 404:
            throw new AegisNotFoundError(message, 404, requestId, details);
          case 409:
            throw new AegisConflictError(message, 409, requestId, details);
          case 429:
            throw new AegisRateLimitedError(message, 429, requestId, details);
          default:
            throw new AegisInternalError(message, res.status, requestId, details);
        }
      }
      return payload as T;
    } catch (err) {
      // Network / abort errors — wrap so callers can `instanceof AegisError`.
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AegisNetworkError(`Request to ${url.toString()} timed out after ${this.timeoutMs}ms`, err);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
