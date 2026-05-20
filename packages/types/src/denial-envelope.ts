// Shared denial-envelope builder — Round 25 supplement audit fix W10.
//
// The adapter-pattern invariants in docs/SEEDS.md say every adapter
// (adapter-nextjs, -cloudflare-workers, -vercel-edge, -aws-lambda, -hono,
// and every Round-26 future adapter) produces the SAME denial envelope
// for the same denial reason:
//
//   { error, message, statusCode, requestId?, next? }
//
// Until this module landed, that invariant was inlined separately in
// each adapter. A future contributor could rename `error` → `code` or
// drop `next` in one adapter and the build would still pass — silent
// drift across the adoption surface, exactly the class of failure the
// catalog `next`/`docsUrl` work was meant to prevent.
//
// This module is the single source of truth. Every adapter imports
// `buildDenialEnvelope` from here. The companion cross-package parity
// test in tests/cross-package/adapter-denial-envelope-parity.spec.ts
// asserts that all 5 adapters call this helper (regex-anchored on the
// import line).

export interface DenialEnvelope {
  /** Stable lower-snake-case error code (matches the error catalog). */
  error: string;
  /** Customer-safe message. NEVER includes key material or stack data. */
  message: string;
  /** HTTP status the wrapper should set on its Response. */
  statusCode: number;
  /** Stable request id for support correlation. Generated when absent. */
  requestId: string;
  /** Optional actionable next step from the error catalog. */
  next?: string;
  /** Optional stable docs URL deep-link. */
  docsUrl?: string;
}

export interface BuildDenialInput {
  /** Stable lower-snake-case code. */
  error: string;
  /** Customer-safe message. */
  message: string;
  /** HTTP status. */
  statusCode: number;
  /** Optional override of the auto-generated request id. */
  requestId?: string;
  /** Optional actionable next step. */
  next?: string;
  /** Optional docs URL. */
  docsUrl?: string;
}

/**
 * Generate a stable request id. Uses `crypto.randomUUID()` when
 * available (all modern runtimes), falls back to a Math.random-suffixed
 * timestamp for edge cases (older browsers, restricted sandboxes).
 *
 * NOTE: Not cryptographic. The id is for correlation only — never use
 * for authorization or token material.
 */
function cryptoRandomId(): string {
  // type-rationale: globalThis.crypto is widely available; we check
  // dynamically because older runtimes lack `randomUUID`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `req_${Date.now()}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Build the canonical denial envelope. Every adapter MUST emit
 * verbatim what this function returns — no shape deviation, no field
 * addition without coordinating the change here first.
 *
 * Returns a plain object (not a Response or a JSON string) so each
 * adapter can wrap it in whatever response shape its runtime expects
 * (Response, Lambda result, Hono c.json, etc.).
 */
export function buildDenialEnvelope(input: BuildDenialInput): DenialEnvelope {
  const envelope: DenialEnvelope = {
    error: input.error,
    message: input.message,
    statusCode: input.statusCode,
    requestId: input.requestId ?? cryptoRandomId(),
  };
  if (input.next !== undefined) envelope.next = input.next;
  if (input.docsUrl !== undefined) envelope.docsUrl = input.docsUrl;
  return envelope;
}

/**
 * Stable key set every denial envelope MUST carry. Used by the
 * cross-package parity test to assert structural equality across the
 * adapter packages.
 */
export const DENIAL_ENVELOPE_REQUIRED_KEYS: readonly string[] = Object.freeze([
  'error',
  'message',
  'statusCode',
  'requestId',
] as const);

/**
 * Optional keys the envelope MAY carry. The parity test treats their
 * presence as additive — an adapter that emits these is conforming;
 * one that omits them is also conforming.
 */
export const DENIAL_ENVELOPE_OPTIONAL_KEYS: readonly string[] = Object.freeze([
  'next',
  'docsUrl',
] as const);
