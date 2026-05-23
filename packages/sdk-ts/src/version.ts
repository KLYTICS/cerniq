// API version pinning — Stripe-shape forward-compat scaffold.
//
// CUSTOMER PROBLEM
// ----------------
// The Aegis API evolves over time. Today the SDK calls `/v1/agents/...`
// unversioned — every customer gets whatever behavior the API ships
// right now. The day the API ships a behavior change (e.g. denial-
// reason precedence reorder, schema field rename, new required scope
// kind) ALL customers see it simultaneously, no opt-out, no preview
// window. That's an enterprise no-fly zone.
//
// THE FIX (Stripe-shape)
// ----------------------
// Customers PIN an API version at SDK construct time. The SDK sends
// `Aegis-Version: <pinned>` on every request. The API honors the
// pin and serves the requested version's behavior. New versions ship
// without breaking existing pinned customers. Customers opt into
// changes at their own pace.
//
//   const aegis = new Aegis({
//     apiKey: process.env.AEGIS_API_KEY,
//     apiVersion: '2026-05-22',  // pin
//   });
//
// FORWARD-COMPAT TODAY
// --------------------
// The API may not yet honor `Aegis-Version`. That's fine — Stripe
// SDKs have always sent the header even on API endpoints that don't
// yet branch on it. The forward-compat is the point: customers pin
// today, the API starts honoring it later, pinned customers get the
// version they expected automatically.
//
// DEPRECATION OBSERVABILITY
// -------------------------
// When the API decides a version will sunset, responses carry the
// `Aegis-Deprecation` header (an ISO-8601 date when the version
// stops being served). The SDK fires `onApiVersionDeprecated` so the
// customer's observability stack can log/alert/ticket the upgrade
// task. Hook is fire-and-forget; HttpClient swallows hook errors so
// a misbehaving subscriber cannot break the response hot path.
//
// PORTABILITY
// -----------
// Zero new dependencies. Just config fields + header threading.

// ────────────────────────────────────────────────────────────────
// TODO[OPERATOR] — DECIDE TWO THINGS, THEN PIN BOTH:
//
// (1) Header name. Two valid conventions in this codebase:
//
//     A. `Aegis-Version` (bare — Stripe-shape, modern)
//        Matches the bare `Idempotency-Key` header used elsewhere.
//        Cleaner; matches RFC 6648 (deprecates the `X-` prefix).
//
//     B. `X-Aegis-Version` (X- prefix — matches existing
//        `X-AEGIS-API-Key`, `X-AEGIS-Verify-Key`, `X-AEGIS-Sdk`)
//        Consistent with the established SDK→API convention in
//        http.ts.
//
//     Recommendation: A (Stripe-shape). RFC 6648 says X- is dead;
//     the existing X-AEGIS-* headers are legacy that the next
//     versioning revamp can clean up alongside. Going with A here
//     so the version header lands on the right convention.
//
// (2) When does `onApiVersionDeprecated` fire?
//
//     A. Only on explicit `Aegis-Deprecation` response header.
//        Server has decided this version will sunset; SDK forwards
//        the warning to the customer. Targeted and quiet.
//
//     B. Also on `Aegis-Latest-Version` drift (server's current
//        != caller's pinned). Proactive but noisy — customers get
//        warned for every server release, even non-breaking.
//
//     Recommendation: A (explicit deprecation only). Drift
//     awareness is a nice-to-have separate hook (`onApiVersionDrift`)
//     that can ship later if customers ask. Today: keep the
//     deprecation channel high-signal-low-noise.
//
// The constants below codify these decisions.
// ────────────────────────────────────────────────────────────────

/**
 * Request header — SDK → API. Carries the pinned version string.
 * Bare-name per RFC 6648; matches the Idempotency-Key convention
 * used elsewhere in this SDK (see http.ts).
 */
export const API_VERSION_HEADER = 'Aegis-Version' as const;

/**
 * Response header — API → SDK. Always present (informational); the
 * server's current latest version. SDK captures for observability;
 * does NOT fire `onApiVersionDeprecated` based on drift (per the
 * operator decision above — drift would be a separate hook).
 */
export const LATEST_VERSION_HEADER = 'Aegis-Latest-Version' as const;

/**
 * Response header — API → SDK. Present only when the caller's
 * pinned version is approaching sunset. Value is an ISO-8601 date
 * (the day the version stops being served). SDK fires the
 * `onApiVersionDeprecated` callback when this header is present.
 */
export const DEPRECATION_HEADER = 'Aegis-Deprecation' as const;

/**
 * Info delivered to `onApiVersionDeprecated`. Populated from the
 * response headers above. Use it to emit a Sentry warning, file a
 * Jira ticket, page the on-call, log to your dashboard — whatever
 * fits the customer's observability stack.
 */
export interface ApiVersionDeprecationInfo {
  /** The version the SDK had pinned. Echo of `AegisConfig.apiVersion`. */
  pinnedVersion: string;
  /** ISO-8601 date when the pinned version stops being served. */
  deprecatedAt: string;
  /** Server's current latest version, if surfaced. */
  latestVersion?: string;
  /** Request URL — useful for routing the alert to the right surface. */
  requestUrl: string;
}

/**
 * Operator-supplied callback fired once per response that carried
 * the `Aegis-Deprecation` header. Must be sync-or-fire-and-forget —
 * HttpClient does NOT await the return value and swallows thrown
 * errors so a misbehaving subscriber cannot break the response
 * hot path.
 *
 * Recommended pattern:
 *
 *   new Aegis({
 *     apiKey: '...',
 *     apiVersion: '2026-05-22',
 *     onApiVersionDeprecated: (info) => {
 *       logger.warn({ ...info }, 'Aegis API version deprecating');
 *       metrics.increment('aegis.api_version_deprecation', 1, {
 *         pinned: info.pinnedVersion,
 *       });
 *     },
 *   });
 */
export type OnApiVersionDeprecated = (info: ApiVersionDeprecationInfo) => void;

/**
 * Parse the three version-related response headers into a structured
 * object. Returns undefined when no deprecation header is present
 * (the common case — we only allocate when the callback would fire).
 *
 * Caller passes `Headers` or a plain record (case-insensitive
 * lookup either way), the request URL for context, and the pinned
 * version. Used internally by HttpClient.request — exposed here so
 * cross-package parity tests can lock the parsing contract.
 */
export function parseVersionResponse(
  headers: Headers | Record<string, string | undefined>,
  requestUrl: string,
  pinnedVersion: string,
): ApiVersionDeprecationInfo | undefined {
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
  const deprecatedAt = get(DEPRECATION_HEADER);
  if (deprecatedAt === undefined || deprecatedAt === '') return undefined;
  const latestVersion = get(LATEST_VERSION_HEADER);
  const info: ApiVersionDeprecationInfo = {
    pinnedVersion,
    deprecatedAt,
    requestUrl,
  };
  if (latestVersion !== undefined && latestVersion !== '') {
    info.latestVersion = latestVersion;
  }
  return info;
}
