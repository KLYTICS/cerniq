import type { ErrorCatalogEntry } from '@aegis/types';

import {
  AegisAuthenticationError,
  AegisAuthorizationError,
  AegisConflictError,
  AegisError,
  AegisInternalError,
  AegisNetworkError,
  AegisNotFoundError,
  AegisRateLimitedError,
  AegisServiceUnavailableError,
  AegisValidationError,
  catalogEntryFor,
  isAegisErrorRetryable,
} from './errors.js';

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
  /**
   * Caller-supplied additional headers, MERGED onto the default
   * Content-Type + auth + SDK-version header set. Use for endpoints
   * that require additional contract headers (e.g. Idempotency-Key
   * on POST /v1/intent/{id}/actuals per ADR-0017).
   *
   * Cannot override Content-Type, X-AEGIS-API-Key, X-AEGIS-Verify-Key,
   * or X-AEGIS-Sdk — those are reserved for the HttpClient.
   */
  headers?: Record<string, string>;
}

/** Knobs for the catalog-driven retry wrapper. */
export interface RetryOptions {
  /** Hard ceiling on attempts (including the first). Default: 3. */
  maxAttempts?: number;
  /** Hook for tests / observability — fires before each backoff sleep. */
  onRetry?: (info: { attempt: number; delayMs: number; error: AegisError }) => void;
  /** Override the sleep implementation (for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Override the Retry-After header reader (for tests). */
  getRetryAfter?: (err: AegisError) => number | undefined;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly verifyKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly userAgent: string | undefined;
  /** Captured Retry-After header from the last response, if any (seconds). */
  private lastRetryAfterSeconds: number | undefined;

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
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [useVerifyKey ? 'X-AEGIS-Verify-Key' : 'X-AEGIS-API-Key']: key,
      'X-AEGIS-Sdk': '@aegis/sdk@0.1.0',
    };
    if (this.userAgent) headers['User-Agent'] = this.userAgent;
    // Caller-supplied headers merge LAST but cannot override reserved
    // auth/content headers (those are HttpClient contract; override
    // would let callers leak verify-key material on management calls).
    if (opts.headers) {
      const RESERVED = new Set([
        'content-type',
        'x-aegis-api-key',
        'x-aegis-verify-key',
        'x-aegis-sdk',
      ]);
      for (const [k, v] of Object.entries(opts.headers)) {
        if (RESERVED.has(k.toLowerCase())) continue;
        headers[k] = v;
      }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); }, this.timeoutMs);
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
        // Capture Retry-After for the retry wrapper before throwing.
        this.lastRetryAfterSeconds = parseRetryAfter(res.headers.get('retry-after'));
        const catalogCode = extractCatalogCodeFromBody(payload);
        switch (res.status) {
          case 400:
            throw new AegisValidationError(message, 400, requestId, details, catalogCode);
          case 401:
            throw new AegisAuthenticationError(message, 401, requestId, details, catalogCode);
          case 403:
            throw new AegisAuthorizationError(message, 403, requestId, details, catalogCode);
          case 404:
            throw new AegisNotFoundError(message, 404, requestId, details, catalogCode);
          case 409:
            throw new AegisConflictError(message, 409, requestId, details, catalogCode);
          case 429:
            throw new AegisRateLimitedError(message, 429, requestId, details, catalogCode);
          case 503:
            throw new AegisServiceUnavailableError(message, 503, requestId, details, catalogCode);
          default:
            throw new AegisInternalError(message, res.status, requestId, details, catalogCode);
        }
      }
      this.lastRetryAfterSeconds = undefined;
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

  /**
   * Retry wrapper that consults the error catalog. Strict ADDITIVE — any
   * existing caller of `request(...)` is unaffected. Use this for new
   * idempotent flows where the SDK should respect server-declared
   * retryability.
   *
   * Backoff strategy (per catalog `backoff`):
   *   - none / undefined: no retry
   *   - linear:           100ms, 200ms, 400ms (up to maxAttempts)
   *   - exponential:      100ms, 400ms, 1600ms (jittered ±10%)
   *   - on_retry_after_header: honor Retry-After (seconds or HTTP date),
   *     capped at 60s
   *
   * Network-layer failures (AegisNetworkError) are treated as exponential
   * with the same schedule, since transport errors carry no catalog code.
   */
  async requestWithRetry<T>(path: string, opts: RequestOptions, retryOpts: RetryOptions = {}): Promise<T> {
    return await withRetry(() => this.request<T>(path, opts), {
      ...retryOpts,
      getRetryAfter: retryOpts.getRetryAfter ?? (() => this.lastRetryAfterSeconds),
    });
  }
}

// ─── Retry wrapper ────────────────────────────────────────────────────

const MAX_ATTEMPTS_DEFAULT = 3;
const MAX_RETRY_AFTER_MS = 60_000;

const LINEAR_SCHEDULE_MS: readonly number[] = [100, 200, 400];
const EXPONENTIAL_SCHEDULE_MS: readonly number[] = [100, 400, 1600];

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Catalog-driven retry. Wraps any thrown AegisError, decides whether to
 * retry based on `catalogEntryFor(err).backoff`, and sleeps the catalog-
 * specified amount.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS_DEFAULT;
  const sleep = opts.sleep ?? defaultSleep;
  const onRetry = opts.onRetry;
  const getRetryAfter = opts.getRetryAfter;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!(err instanceof AegisError)) throw err;
      if (attempt >= maxAttempts) throw err;
      if (!isAegisErrorRetryable(err)) throw err;

      const entry = catalogEntryFor(err);
      const delayMs = nextDelayMs({
        attempt,
        entry,
        retryAfterSeconds: err instanceof AegisError ? getRetryAfter?.(err) : undefined,
        isNetwork: err instanceof AegisNetworkError,
      });
      if (delayMs === null) throw err; // backoff says "do not retry"
      onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  // Loop only exits via return or throw; this satisfies the type checker.
  throw lastError;
}

interface NextDelayInput {
  attempt: number; // 1-based
  entry: ErrorCatalogEntry | undefined;
  retryAfterSeconds: number | undefined;
  isNetwork: boolean;
}

/** Returns null when the error should not be retried regardless of attempt count. */
export function nextDelayMs(input: NextDelayInput): number | null {
  const { attempt, entry, retryAfterSeconds, isNetwork } = input;
  // Network-layer fall-through: exponential schedule.
  if (isNetwork) {
    return jittered(scheduleAt(EXPONENTIAL_SCHEDULE_MS, attempt));
  }
  if (entry === undefined) return null;
  const backoff = entry.backoff;
  if (backoff === undefined || backoff === 'none') return null;
  if (backoff === 'linear') return scheduleAt(LINEAR_SCHEDULE_MS, attempt);
  if (backoff === 'exponential') return jittered(scheduleAt(EXPONENTIAL_SCHEDULE_MS, attempt));
  // backoff is now narrowed to 'on_retry_after_header'.
  if (retryAfterSeconds === undefined || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    // Server said "honor Retry-After" but didn't send one — fall back
    // to a conservative linear schedule so we don't hammer.
    return scheduleAt(LINEAR_SCHEDULE_MS, attempt);
  }
  return Math.min(Math.floor(retryAfterSeconds * 1000), MAX_RETRY_AFTER_MS);
}

function scheduleAt(schedule: readonly number[], attempt: number): number {
  // attempt is 1-based; clamp to last bucket.
  const idx = Math.min(attempt - 1, schedule.length - 1);
  const v = schedule[idx];
  if (v === undefined) {
    // type-rationale: noUncheckedIndexedAccess — schedules are non-empty
    // constants so this is unreachable, but the compiler can't see that.
    return schedule[schedule.length - 1] ?? 0;
  }
  return v;
}

/** Apply a deterministic ±10% jitter using crypto-grade randomness. */
function jittered(baseMs: number): number {
  // Use a single random byte (0..255) → jitter factor in [-0.1, +0.1].
  // globalThis.crypto.getRandomValues works in both Node 18+ and browsers.
  const buf = new Uint8Array(1);
  globalThis.crypto.getRandomValues(buf);
  const byte = buf[0] ?? 128;
  const factor = (byte / 255) * 0.2 - 0.1; // [-0.1, +0.1]
  return Math.max(0, Math.round(baseMs * (1 + factor)));
}

/** Parse a `Retry-After` header into seconds. Accepts both delta-seconds and HTTP date. */
export function parseRetryAfter(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return undefined;
  // Pure integer seconds.
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  // HTTP date.
  const ts = Date.parse(trimmed);
  if (Number.isFinite(ts)) {
    const deltaMs = ts - Date.now();
    return deltaMs > 0 ? Math.ceil(deltaMs / 1000) : 0;
  }
  return undefined;
}

function extractCatalogCodeFromBody(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const code = (payload as Record<string, unknown>).code;
  if (typeof code === 'string' && code.length > 0) return code;
  // Server filter may nest under details.
  const details = (payload as Record<string, unknown>).details;
  if (details !== null && typeof details === 'object') {
    const inner = (details as Record<string, unknown>).code;
    if (typeof inner === 'string' && inner.length > 0) return inner;
  }
  return undefined;
}
