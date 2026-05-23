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
import { parseReplayHeaders, type OnWriteResponse } from './idempotency.js';
import {
  API_VERSION_HEADER,
  parseVersionResponse,
  type OnApiVersionDeprecated,
} from './version.js';

export interface HttpClientConfig {
  apiKey?: string | undefined;
  verifyKey?: string | undefined;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch | undefined;
  userAgent?: string | undefined;
  /**
   * Optional observability hook for idempotent writes. See `AegisConfig.
onWriteResponse` for full semantics. Fired only when the request carried
   * `idempotencyKey`. Errors thrown by the hook are swallowed.
   */
  onWriteResponse?: OnWriteResponse | undefined;
  /**
   * Default AbortSignal forwarded into every request. Combined with
   * the per-request timeout and any per-call `RequestOptions.signal`
   * — whichever aborts first cancels the in-flight fetch. See the
   * docstring on `AegisConfig.signal` for the customer-facing pattern.
   */
  signal?: AbortSignal | undefined;
  /**
   * Pinned API version sent as `Aegis-Version` header on every
   * request. Passed opaquely — SDK does not validate the format.
   * See `AegisConfig.apiVersion` for the customer-facing rationale.
   */
  apiVersion?: string | undefined;
  /**
   * Optional callback fired when a response carries the
   * `Aegis-Deprecation` header. Fire-and-forget; HttpClient swallows
   * thrown errors. See `AegisConfig.onApiVersionDeprecated`.
   */
  onApiVersionDeprecated?: OnApiVersionDeprecated | undefined;
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
  /**
   * Idempotency-Key for the request. When set, the HttpClient ships
   * `Idempotency-Key: <value>` on the wire so the API's per-principal
   * idempotency interceptor can dedupe replays. Higher-level callers
   * should use `resolveIdempotencyKey()` from `./idempotency.js` to
   * apply the auto-attach policy and pass the result here. Set to
   * `undefined` to omit (the default for reads and pure POSTs that
   * are forbidden from carrying a key — e.g. `/agents/:id/challenge`).
   */
  idempotencyKey?: string;
  /**
   * Per-call AbortSignal. Combined with `HttpClientConfig.signal` and
   * the internal per-request timeout — whichever aborts first wins.
   * External aborts propagate the signal's `reason` to the caller;
   * timeout aborts continue to throw `AegisNetworkError`.
   */
  signal?: AbortSignal;
}

/** Knobs for the catalog-driven retry wrapper. */
export interface RetryOptions {
  /** Hard ceiling on attempts (including the first). Default: 3. */
  maxAttempts?: number;
  /** Hook for tests / observability — fires before each backoff sleep. */
  onRetry?: (info: { attempt: number; delayMs: number; error: AegisError }) => void;
  /**
   * Override the sleep implementation (for tests). The implementation
   * MUST honor the optional `signal` argument: if the signal aborts
   * during the sleep, reject with the signal's reason. The default
   * implementation does this.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Override the Retry-After header reader (for tests). */
  getRetryAfter?: (err: AegisError) => number | undefined;
  /**
   * AbortSignal — when aborted, the retry loop terminates immediately
   * (mid-sleep or before the next attempt). Per the M-ABORT-1 design
   * choice: abort during backoff throws the signal's reason; we do
   * NOT finish the current sleep or attempt one more request after
   * an abort signal fires.
   */
  signal?: AbortSignal;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly verifyKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly userAgent: string | undefined;
  private readonly onWriteResponse: OnWriteResponse | undefined;
  private readonly configSignal: AbortSignal | undefined;
  private readonly apiVersion: string | undefined;
  private readonly onApiVersionDeprecated: OnApiVersionDeprecated | undefined;
  /** Captured Retry-After header from the last response, if any (seconds). */
  private lastRetryAfterSeconds: number | undefined;

  constructor(config: HttpClientConfig) {
    this.apiKey = config.apiKey;
    this.verifyKey = config.verifyKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs;
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = config.userAgent;
    this.onWriteResponse = config.onWriteResponse;
    this.configSignal = config.signal;
    this.apiVersion = config.apiVersion;
    this.onApiVersionDeprecated = config.onApiVersionDeprecated;
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
        'aegis-version',
      ]);
      for (const [k, v] of Object.entries(opts.headers)) {
        if (RESERVED.has(k.toLowerCase())) continue;
        headers[k] = v;
      }
    }
    // Idempotency-Key wins over any same-named entry in opts.headers —
    // the structured field is the supported public path; the raw
    // header is a backwards-compat affordance for callers that
    // pre-date this slice.
    if (opts.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }
    // Pinned API version — Stripe-shape forward-compat. Send the
    // header on every request when the customer has pinned;
    // otherwise omit (server uses current).
    if (this.apiVersion !== undefined) {
      headers[API_VERSION_HEADER] = this.apiVersion;
    }

    // Multi-source abort: combine the internal per-request timeout with
    // any caller-supplied `opts.signal` and the client-level
    // `configSignal`. We keep the timeout controller SEPARATE from the
    // combined controller so the catch handler can disambiguate "we
    // timed out" (→ AegisNetworkError) from "caller aborted" (→
    // propagate the caller's reason verbatim).
    //
    // Listener forwarding pattern: register `abort` listeners on each
    // input signal that abort the combined controller, then collect
    // cleanup thunks. The `finally` block runs them all so we never
    // leak listeners on long-lived caller signals (e.g. an
    // AbortController shared across many requests in a tab session).
    const timeoutCtrl = new AbortController();
    const combinedCtrl = new AbortController();
    const timer = setTimeout(() => {
      timeoutCtrl.abort();
      combinedCtrl.abort(timeoutCtrl.signal.reason);
    }, this.timeoutMs);
    const cleanups: Array<() => void> = [];
    const forwardAbort = (source: AbortSignal | undefined): void => {
      if (source === undefined) return;
      if (source.aborted) {
        combinedCtrl.abort(source.reason);
        return;
      }
      const onAbort = (): void => combinedCtrl.abort(source.reason);
      source.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => source.removeEventListener('abort', onAbort));
    };
    forwardAbort(opts.signal);
    forwardAbort(this.configSignal);

    // Capture the wall-clock start so the `onWriteResponse` hook can
    // report measured RTT. Read once after fetch returns regardless of
    // success/failure (the hook only fires on success below, but the
    // capture cost is one Date.now() call either way).
    const startedAt = Date.now();
    try {
      const res = await this.fetchFn(url.toString(), {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: combinedCtrl.signal,
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
      // Fire the onWriteResponse hook for any request that carried an
      // idempotency key. Subscribers observe replay rate + correlate
      // first-seen timestamps. Hook errors are swallowed — the write
      // hot path must never break because an observability subscriber
      // threw.
      if (opts.idempotencyKey !== undefined && this.onWriteResponse !== undefined) {
        try {
          this.onWriteResponse({
            replay: parseReplayHeaders(res.headers),
            requestId: res.headers.get('x-request-id') ?? undefined,
            status: res.status,
            latencyMs: Date.now() - startedAt,
            idempotencyKey: opts.idempotencyKey,
          });
        } catch {
          // Swallow — observability hook is not part of the write contract.
        }
      }
      // Fire the onApiVersionDeprecated hook when the response carries
      // the Aegis-Deprecation header. Fires on EVERY request (read
      // or write) when both apiVersion is pinned AND the callback is
      // wired AND the header is present. parseVersionResponse returns
      // undefined when the header is absent, so the common case is
      // free of allocation. Hook errors are swallowed for the same
      // reason as onWriteResponse — observability cannot break the
      // response hot path.
      if (this.apiVersion !== undefined && this.onApiVersionDeprecated !== undefined) {
        const deprecation = parseVersionResponse(res.headers, url.toString(), this.apiVersion);
        if (deprecation !== undefined) {
          try {
            this.onApiVersionDeprecated(deprecation);
          } catch {
            // Swallow — observability hook is not part of the response contract.
          }
        }
      }
      return payload as T;
    } catch (err) {
      // Disambiguate aborts: our internal timeout vs an external signal
      // (caller's `opts.signal` or the client-level `configSignal`).
      //
      // Source-of-truth for "was this an abort?" is the SIGNAL STATE,
      // not `err.name`. Runtime variation across Node / browsers /
      // workers means a DOMException thrown by fetch may or may not
      // pass `instanceof Error`, and the default abort reason
      // construction varies by version. Checking the signal's
      // `.aborted` property is reliable and unambiguous.
      //
      // - Timeout: preserve the existing customer contract — throw
      //   `AegisNetworkError` with the same message shape callers
      //   already match on.
      // - External: propagate the caller's `reason` verbatim. This
      //   matches the Web `fetch` convention (callers get back the
      //   exact DOMException / Error they aborted with) so existing
      //   `catch (err) { if (err.name === 'AbortError') ... }`
      //   patterns work unchanged.
      const isAbort =
        combinedCtrl.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      if (isAbort) {
        if (timeoutCtrl.signal.aborted) {
          throw new AegisNetworkError(
            `Request to ${url.toString()} timed out after ${this.timeoutMs}ms`,
            err,
          );
        }
        // External abort — re-throw the caller's reason, or the
        // original AbortError if no reason was supplied.
        throw combinedCtrl.signal.reason ?? err;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      // Remove every forwarded listener so caller-supplied signals
      // don't retain references to our internal closures past the
      // request's lifetime.
      for (const cleanup of cleanups) cleanup();
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

/**
 * Default sleep implementation — signal-aware. If `signal` is provided
 * and aborts during the sleep window, the returned promise rejects
 * immediately with `signal.reason`. Tests can override via
 * `RetryOptions.sleep` but the contract requires preserving the same
 * abort semantics.
 */
const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      // type-rationale: addEventListener fires only when `signal` is
      // defined, so the non-null assertion holds at this call site.
      reject(signal!.reason);
    };
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });
  });

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
  const signal = opts.signal;

  // Preflight: if the caller arrives with an already-aborted signal,
  // do not invoke `fn` at all — fail fast with the same reason. This
  // is the canonical AbortSignal contract; not honoring it here would
  // burn one request worth of API budget before the inevitable abort.
  if (signal?.aborted) throw signal.reason;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Abort-during-attempt: if the caller's signal aborted the fetch,
      // do not retry — propagate the abort reason and stop.
      if (signal?.aborted) throw signal.reason;
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
      // Signal-aware sleep: an abort during backoff rejects with the
      // signal's reason, terminating the loop immediately. Per the
      // design choice in this slice — we do NOT finish the current
      // sleep or attempt one more request after the signal fires.
      // The caller asked to abort; the SDK respects that now.
      await sleep(delayMs, signal);
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
