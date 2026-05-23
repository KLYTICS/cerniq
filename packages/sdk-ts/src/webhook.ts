// Webhook signature verification.
//
// AEGIS delivers webhooks with three headers:
//   X-AEGIS-Signature:    t=<unix-ts>,v1=<hmac-sha256-hex(`${ts}.${body}`)>
//   X-AEGIS-Event:        <event-type>      (e.g. policy.expired)
//   X-AEGIS-Delivery-Id:  <ulid>            (unique per delivery attempt)
//
// The signature header is Stripe-shape on purpose — it composes a unix
// timestamp + one or more HMAC-SHA-256 signatures (`v1=<hex>`), so:
//   - The timestamp lets receivers reject stale replays without storing
//     every delivery id forever.
//   - Multiple `v1=` segments support key rotation: subscribe with two
//     secrets during cutover; signature passes if ANY `v1=` verifies.
//     (The API currently emits exactly one — this SDK parses
//      permissively so rotation lands without a customer upgrade.)
//
// SECURITY CONSTRAINTS (these are NOT optional):
//   1. Constant-time comparison. We use `crypto.subtle.verify` which is
//      constant-time by definition — never compare HMAC hex strings with
//      `===`. That's the #1 webhook-SDK CVE pattern.
//   2. Timestamp tolerance. A captured-and-replayed signature stays
//      valid forever without a tolerance window. Default = 5 min;
//      operator can tune via `toleranceSeconds`.
//   3. Raw body. The caller MUST pass the unparsed request body string.
//      `JSON.stringify(JSON.parse(body))` does not round-trip; key
//      ordering, whitespace, and number formatting all matter.
//
// Source-of-truth contract: API signs via `WebhookDelivery.sign(secret,
// ts, body)` at `apps/api/src/modules/webhooks/webhook.delivery.ts:438`.
// Cross-package parity is enforced by `tests/cross-package/webhook-
// signature-parity.spec.ts`.
//
// Portability: zero Node-only imports — uses WebCrypto (`crypto.subtle`)
// plus `TextEncoder`. Runs unchanged in Node 20+, browsers, Bun, Deno,
// Cloudflare Workers, Vercel Edge.

import { AegisError, type ErrorCatalogEntry } from './errors.js';

/** Wire header constants — mirror the API's webhook delivery output. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-AEGIS-Signature' as const;
export const WEBHOOK_EVENT_HEADER = 'X-AEGIS-Event' as const;
export const WEBHOOK_DELIVERY_ID_HEADER = 'X-AEGIS-Delivery-Id' as const;

/**
 * Default timestamp tolerance window — 300 seconds (5 minutes).
 *
 * Operator decision (2026-05-22): pinned at 300s, matching Stripe's
 * industry-default. Balances replay defense vs delivery jitter from
 * the BullMQ exponential-backoff retry schedule. A captured signature
 * remains valid for 5 minutes after delivery — receivers wanting
 * tighter defense (e.g. on fraud-confirm or KMS-rotation events) can
 * override per call via `toleranceSeconds: 60`.
 *
 * Trade-offs considered and rejected:
 *   - 60s (strict): rejects legitimate retries past the first backoff
 *     window, which would fire false security alerts.
 *   - 900s (lenient): doubles the replay attack surface for a tiny
 *     delivery-reliability gain.
 *
 * Callers can always override per-call via `toleranceSeconds`. To
 * change the default, update this constant AND `webhook.spec.ts` AND
 * notify customers via the SDK CHANGELOG — this value is part of the
 * customer-observable contract.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Signature header was syntactically malformed — missing `t=`, missing
 * any `v1=`, non-hex `v1=` value, or non-integer timestamp. Receiver
 * should respond 400 to the API; do NOT retry-process the delivery.
 */
export class AegisWebhookSignatureMalformedError extends AegisError {
  static override readonly catalogKey = 'AegisWebhookSignatureMalformedError';
  override readonly code = 'WEBHOOK_SIGNATURE_MALFORMED';
  static override readonly catalog: ErrorCatalogEntry | undefined = undefined;
  constructor(message: string) {
    super(message, 400, undefined);
  }
}

/**
 * Signature header was well-formed but no `v1=` segment verified
 * against the provided secret + payload. Either the secret is wrong,
 * the payload was modified in transit, or the delivery is forged.
 * Receiver should respond 401/403 and audit the attempt.
 */
export class AegisWebhookSignatureInvalidError extends AegisError {
  static override readonly catalogKey = 'AegisWebhookSignatureInvalidError';
  override readonly code = 'WEBHOOK_SIGNATURE_INVALID';
  static override readonly catalog: ErrorCatalogEntry | undefined = undefined;
  constructor(message: string) {
    super(message, 401, undefined);
  }
}

/**
 * Signature header verified but the timestamp is outside the tolerance
 * window. Either a captured-signature replay attack, or a legitimate
 * retry that exceeded the operator's tolerance setting.
 */
export class AegisWebhookTimestampError extends AegisError {
  static override readonly catalogKey = 'AegisWebhookTimestampError';
  override readonly code = 'WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE';
  static override readonly catalog: ErrorCatalogEntry | undefined = undefined;
  constructor(
    message: string,
    /** Timestamp from signature (unix seconds). */
    public readonly signatureTimestamp: number,
    /** Receiver's clock at verification (unix seconds). */
    public readonly receivedAt: number,
    /** Configured tolerance window. */
    public readonly toleranceSeconds: number,
  ) {
    super(message, 400, undefined);
  }
}

export interface VerifyWebhookOptions {
  /**
   * Raw request body — UNPARSED string. Critical: pass `await req.text()`,
   * NOT `JSON.stringify(await req.json())`. JSON round-tripping is
   * lossy on key order, number formatting, and whitespace; the HMAC
   * is computed over the literal bytes the API sent.
   */
  payload: string;
  /** Value of the `X-AEGIS-Signature` header. */
  signature: string;
  /** Operator's webhook subscription secret (`whsec_...`). */
  secret: string;
  /**
   * Tolerance window in seconds. Defaults to `DEFAULT_TOLERANCE_SECONDS`
   * (operator-pinned). Accepts past OR future skew up to this many
   * seconds. Set to `Infinity` to disable the timestamp check entirely
   * (NOT recommended — only for offline replay analysis).
   */
  toleranceSeconds?: number;
  /** Clock injection for tests. Defaults to `Date.now() / 1000`. */
  now?: () => number;
}

export interface VerifiedWebhook {
  /** Unix timestamp from the signature, in seconds. */
  timestamp: number;
  /** Receiver clock skew relative to delivery, in seconds. Positive = late delivery; negative = clock drift. */
  skewSeconds: number;
}

interface ParsedSignatureHeader {
  /** Unix timestamp in seconds. */
  t: number;
  /** All `v1=<hex>` segments, in encounter order. */
  v1: string[];
}

/**
 * Parse a Stripe-shape signature header into structured form. Accepts
 * extra unknown segments (`v2=...`, `unknown=...`) for forward-compat;
 * we ignore them rather than fail. Multiple `v1=` segments are all
 * collected — used during key-rotation cutover when the API may emit
 * signatures from two secrets simultaneously.
 */
function parseSignatureHeader(header: string): ParsedSignatureHeader {
  const segments = header.split(',').map((s) => s.trim()).filter(Boolean);
  let t: number | undefined;
  const v1: string[] = [];
  for (const segment of segments) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const k = segment.slice(0, eq);
    const v = segment.slice(eq + 1);
    if (k === 't') {
      const parsed = Number(v);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new AegisWebhookSignatureMalformedError(
          `webhook signature: 't' must be a non-negative integer, got ${JSON.stringify(v)}`,
        );
      }
      t = parsed;
    } else if (k === 'v1') {
      // Permissive hex check — `crypto.subtle.verify` rejects bad input
      // anyway, but a clearer error here helps operators debug.
      if (!/^[0-9a-fA-F]+$/.test(v) || v.length % 2 !== 0) {
        throw new AegisWebhookSignatureMalformedError(
          `webhook signature: 'v1' must be even-length hex, got ${v.length} chars`,
        );
      }
      v1.push(v);
    }
    // Unknown segments are ignored for forward-compat.
  }
  if (t === undefined) {
    throw new AegisWebhookSignatureMalformedError(
      "webhook signature: missing required 't=<unix-ts>' segment",
    );
  }
  if (v1.length === 0) {
    throw new AegisWebhookSignatureMalformedError(
      "webhook signature: missing required 'v1=<hmac-hex>' segment",
    );
  }
  return { t, v1 };
}

function hexDecode(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    // parseSignatureHeader already validated hex shape; this guard is
    // belt-and-braces against any future refactor that drops the
    // upstream regex.
    if (Number.isNaN(byte)) {
      throw new AegisWebhookSignatureMalformedError(
        `webhook signature: invalid hex at byte ${i}`,
      );
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Verify a webhook signature against the canonical payload + secret.
 *
 * Resolution order:
 *   1. Parse the signature header. Malformed → `AegisWebhookSignatureMalformedError`.
 *   2. Check timestamp against tolerance window. Out of window →
 *      `AegisWebhookTimestampError`. (We check the timestamp BEFORE the
 *      HMAC because a malicious caller could otherwise flood us with
 *      HMAC computations on signatures they already know are stale.)
 *   3. HMAC-verify each `v1=` segment via `crypto.subtle.verify`
 *      (constant-time). Accept on the first match.
 *   4. No segment verified → `AegisWebhookSignatureInvalidError`.
 *
 * Returns `{ timestamp, skewSeconds }` for observability. Receivers
 * concerned about exact-once delivery should also dedupe on
 * `X-AEGIS-Delivery-Id` via their own replay cache — the API supplies
 * the id, this helper supplies the trustworthy timestamp.
 */
export async function verifyWebhookSignature(
  opts: VerifyWebhookOptions,
): Promise<VerifiedWebhook> {
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = opts.now ? opts.now() : Math.floor(Date.now() / 1000);

  const { t, v1 } = parseSignatureHeader(opts.signature);

  const skewSeconds = now - t;
  if (Number.isFinite(tolerance) && Math.abs(skewSeconds) > tolerance) {
    throw new AegisWebhookTimestampError(
      `webhook timestamp out of tolerance: |${skewSeconds}|s > ${tolerance}s`,
      t,
      now,
      tolerance,
    );
  }

  const enc = new TextEncoder();
  // type-rationale: TextEncoder.encode and hexDecode produce Uint8Arrays
  // whose backing buffer is always a plain ArrayBuffer (never Shared),
  // but recent TS libs widen the union to ArrayBufferLike. WebCrypto
  // rejects SharedArrayBuffer at runtime regardless. We cast to
  // BufferSource at each call site rather than poisoning the helper
  // return types — local, auditable, and contained.
  const keyMaterial = enc.encode(opts.secret) as unknown as BufferSource;
  const signedBytes = enc.encode(`${t}.${opts.payload}`) as unknown as BufferSource;

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Try each v1= segment. Accept on first match — constant-time within
  // each comparison; the iteration count leaks "how many sigs in the
  // header", which is not secret information (it's right there in the
  // header bytes).
  for (const candidate of v1) {
    const sigBytes = hexDecode(candidate) as unknown as BufferSource;
    const ok = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, signedBytes);
    if (ok) return { timestamp: t, skewSeconds };
  }

  throw new AegisWebhookSignatureInvalidError(
    `webhook signature: no v1= segment verified (${v1.length} candidate${v1.length === 1 ? '' : 's'} tried)`,
  );
}
