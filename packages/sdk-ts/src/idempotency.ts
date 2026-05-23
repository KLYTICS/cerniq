// Idempotency-Key support for SDK write paths.
//
// The AEGIS API ships a per-principal idempotency interceptor
// (`apps/api/src/common/idempotency/`). On a write request carrying
// `Idempotency-Key: <opaque>`, the server stores
// `{principalId, route, key, body-hash} → {status, response-body}` for a
// bounded TTL. A second write with the same key returns the stored
// response and sets `Idempotent-Replay: true` + `Idempotent-First-Seen`.
// A mismatched body under the same key returns 409.
//
// This module gives SDK callers three things:
//   1. `generateIdempotencyKey()` — a portable UUID v4 minted via Web
//      Crypto so it works unchanged in Node 20+, browsers, Bun, Deno,
//      Cloudflare Workers, and Vercel Edge.
//   2. `resolveIdempotencyKey(opts)` — applies the auto-attach policy
//      to an optional `IdempotencyOptions` argument, returning the key
//      string the HTTP client should ship (or `undefined`).
//   3. `parseReplayHeaders(headers)` — converts response headers into
//      a structured `ReplayMetadata` so observability hooks can tell
//      replays from fresh writes.
//
// Composes with the existing `RequestOptions.headers` mechanism in
// `http.ts`. Portability: zero Node-only imports.

/** Wire header constants — mirror `AEGIS_HEADER_IDEMPOTENCY` from `@aegis/types`. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key' as const;
/** Response header set by the API interceptor on a cache hit. */
export const REPLAY_HEADER = 'Idempotent-Replay' as const;
/** Response header carrying the ISO-8601 timestamp of the first request that wrote this key. */
export const FIRST_SEEN_HEADER = 'Idempotent-First-Seen' as const;

/**
 * Caller-supplied options on a write method. Three shapes are valid:
 *   - `undefined` — no idempotency key unless the auto-attach policy
 *     for this method says `'auto'`.
 *   - `{ key: 'my-key' }` — caller-chosen key. Always wins.
 *   - `{ auto: true }` — mint a fresh UUID v4 even when the policy
 *     for this method would otherwise be `'opt-in'`.
 */
export type IdempotencyOptions =
  | { key: string; auto?: never }
  | { auto: true; key?: never };

/**
 * Parsed replay metadata from a write response. Surfaced to consumers
 * via the `onWriteResponse` config hook (M-IDEM-2) so observability
 * systems can distinguish fresh writes from replays without parsing
 * raw headers themselves.
 */
export interface ReplayMetadata {
  /** True iff the API served a stored response for this idempotency key. */
  replayed: boolean;
  /** ISO-8601 timestamp of the first request that wrote this key. */
  firstSeenAt?: string;
}

/**
 * Structured info passed to the `onWriteResponse` hook after any SDK
 * request that carried an `Idempotency-Key`. The hook is fire-and-
 * forget — the HttpClient wraps it in try/catch so a misbehaving
 * subscriber cannot break the verify or write hot path.
 */
export interface WriteResponseInfo {
  /** Replay metadata parsed from the response headers. */
  replay: ReplayMetadata;
  /** Server-provided correlation id from `X-Request-Id`, if any. */
  requestId?: string;
  /** HTTP status code of the response (200, 201, 409, ...). */
  status: number;
  /** Round-trip latency in milliseconds, measured by the HttpClient. */
  latencyMs: number;
  /** The idempotency key the SDK attached to the request. */
  idempotencyKey: string;
}

/**
 * Operator-supplied callback fired for every SDK write request that
 * carried an `Idempotency-Key`. Use to:
 *   - emit a `write.replayed` metric (count of cache hits vs fresh writes),
 *   - tag traces with `idempotent-replay: true`,
 *   - log a warning when an unexpected replay collapses a logical retry
 *     onto a stale response.
 *
 * Must be synchronous-or-fire-and-forget. The HttpClient does NOT await
 * the return value.
 */
export type OnWriteResponse = (info: WriteResponseInfo) => void;

/** Auto-attach policy decision for a single SDK call site. */
export type AutoAttachMode =
  /** SDK mints a UUID v4 key automatically when caller omits one. Best DX. */
  | 'auto'
  /** SDK attaches a key only when caller passes `IdempotencyOptions` explicitly. */
  | 'opt-in'
  /** SDK MUST NOT carry `Idempotency-Key` for this method, even if requested. */
  | 'forbidden';

/**
 * Per-method auto-attach policy, decided by operator 2026-05-22.
 *
 * Modes:
 *   - 'auto'      — SDK mints a UUID v4 and attaches the header when
 *                   the caller omits `IdempotencyOptions`. Safe retries
 *                   by default. Matches Stripe's defaults.
 *   - 'opt-in'    — SDK attaches a key only when the caller passes
 *                   options explicitly. Caller-aware retry behavior.
 *   - 'forbidden' — SDK refuses to attach a key even if the caller
 *                   passes options. For endpoints where a replay
 *                   returns a stale-and-dangerous response (e.g.
 *                   a 5-min-TTL nonce).
 *
 * Rationale by row (changes from default 'opt-in' marked ★):
 *
 *   ★ agents.register      = 'auto'       — mints persistent agent
 *       identity; double-submit creates a duplicate row. High blast
 *       radius. SDK protects by default.
 *   agents.revoke          = 'opt-in'     — DELETE is resource-level
 *       idempotent at the server; second revoke is a server-side no-op.
 *       No SDK protection needed.
 *   ★ agents.report        = 'auto'       — fraud signal report;
 *       double-submit inflates BATE risk delta against legitimate
 *       agents. False-positive cost is real (agent suspension).
 *   ★ agents.challenge     = 'forbidden'  — each call MUST mint a
 *       fresh 5-min-TTL nonce. Server-side replay of the idempotency
 *       key would return a stale nonce; the SDK enforces client-side
 *       so the Idempotency-Key header never reaches the wire here.
 *   agents.verifyHandshake = 'opt-in'     — signature is single-use;
 *       server-side replay defense already covers double-submit.
 *   ★ policies.create      = 'auto'       — mints a new signed policy
 *       JWT; double-submit creates two valid policies, the second
 *       shadowing the first. High blast radius. SDK protects.
 *   policies.revoke        = 'opt-in'     — DELETE is resource-level
 *       idempotent. No SDK protection needed.
 *   intent.reconcile       = 'opt-in'     — PINNED per ADR-0017; the
 *       caller-minted key is part of the manifest identity contract.
 *
 * Changing a row is part of the customer-observable SDK contract.
 * Update CHANGELOG and the rationale block above together.
 */
export const AUTO_IDEMPOTENT_METHODS: Record<string, AutoAttachMode> = {
  // ── agents
  'agents.register':         'auto',
  'agents.revoke':           'opt-in',
  'agents.report':           'auto',
  'agents.challenge':        'forbidden',
  'agents.verifyHandshake':  'opt-in',
  // ── policies
  'policies.create':         'auto',
  'policies.revoke':         'opt-in',
  // ── intent (pinned per ADR-0017)
  'intent.reconcile':        'opt-in',
};

/**
 * Generate a fresh RFC-4122 v4 UUID using Web Crypto. Stable across
 * all SDK runtimes. Used both by `resolveIdempotencyKey({ auto: true })`
 * and by the auto-attach path when the policy table says `'auto'`.
 *
 * Note: `crypto.randomUUID()` is available in Node 19+, modern browsers,
 * Bun, Deno, Workers — we use it directly so we don't ship a 4KB
 * polyfill for one function.
 */
export function generateIdempotencyKey(): string {
  // type-rationale: `crypto.randomUUID` is widely available but TypeScript's
  // global Crypto type still marks it optional in some lib targets.
  const rng = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof rng.randomUUID === 'function') return rng.randomUUID();
  // Manual v4 path for ancient runtimes that have getRandomValues but not
  // randomUUID. Same RFC-4122 wire shape; same entropy.
  const bytes = new Uint8Array(16);
  rng.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC-4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

/**
 * Apply the auto-attach policy for a given SDK call site, given the
 * caller's optional `IdempotencyOptions`. Returns the key the HTTP
 * client should ship in the `Idempotency-Key` header, or `undefined`
 * if no key should be attached.
 *
 * Resolution order:
 *   1. If the method's policy is 'forbidden', return undefined
 *      regardless of caller intent. The server-side interceptor would
 *      also ignore a key on a non-`@Idempotent()` route, but the SDK
 *      enforces this client-side to keep the header off the wire and
 *      out of logs.
 *   2. If caller passed `{ key }`, return it verbatim. Explicit wins.
 *   3. If caller passed `{ auto: true }`, mint a fresh key.
 *   4. If the policy is 'auto', mint a fresh key.
 *   5. Otherwise return undefined.
 */
export function resolveIdempotencyKey(
  callSite: string,
  opts?: IdempotencyOptions,
): string | undefined {
  const policy = AUTO_IDEMPOTENT_METHODS[callSite];
  if (policy === 'forbidden') return undefined;
  if (opts && 'key' in opts && typeof opts.key === 'string') return opts.key;
  if (opts && 'auto' in opts && opts.auto === true) return generateIdempotencyKey();
  if (policy === 'auto') return generateIdempotencyKey();
  return undefined;
}

/**
 * Convert a response headers map into structured replay metadata.
 * Accepts the `Headers` Web API or a plain record (case-insensitive
 * lookup either way). Returns `{ replayed: false }` when the response
 * carries no replay headers.
 */
export function parseReplayHeaders(
  headers: Headers | Record<string, string | undefined>,
): ReplayMetadata {
  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name) ?? undefined;
    }
    const record = headers as Record<string, string | undefined>;
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(record)) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  };
  const replayed = get(REPLAY_HEADER)?.toLowerCase() === 'true';
  if (!replayed) return { replayed: false };
  const firstSeenAt = get(FIRST_SEEN_HEADER);
  return firstSeenAt ? { replayed: true, firstSeenAt } : { replayed: true };
}
