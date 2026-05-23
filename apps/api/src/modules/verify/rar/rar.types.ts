// AEGIS RAR (RFC 9396) — type contract.
//
// Binds AEGIS authorization decisions to OAuth 2.0 Rich Authorization
// Requests. A buyer integrating AEGIS into an existing FAPI 2.0 flow
// passes their JAR-extracted `authorization_details` directly into the
// AEGIS evaluator — no protocol translation layer required.
//
// RFC 9396 §2.1 defines `authorization_details` as a JSON array of
// objects, each with at minimum a `type` field. The shape per type is
// application-specific. AEGIS registers four types initially; new types
// are additive and require operator review (see ADR pipeline).
//
// Authority: `docs/spec/05_FAPI_2_0_PROFILE.md` §2 (RFC-9396 binding).

/** Base RAR object shape per RFC 9396 §2 — every AuthDetail must carry `type`. */
export interface RarBase {
  /** RAR detail type identifier. Determines which evaluator handles this object. */
  type: string;
  /** URIs the action targets — RFC 9396 §2.1 "locations". Optional. */
  locations?: readonly string[];
  /** Action verbs — RFC 9396 §2.1 "actions". Optional. */
  actions?: readonly string[];
  /** Data classifications — RFC 9396 §2.1 "datatypes". Optional. */
  datatypes?: readonly string[];
  /** Object identifier — RFC 9396 §2.1 "identifier". Optional. */
  identifier?: string;
  /** Role/permission names — RFC 9396 §2.1 "privileges". Optional. */
  privileges?: readonly string[];
}

// ──────────────────────────────────────────────────────────────────────
// Registered AEGIS types
// ──────────────────────────────────────────────────────────────────────

/** Trading-order RAR detail. Models broker/exchange order routing.
 *  Aligned with Open Banking UK "PSU intent" + FAPI 2.0 Capital Markets
 *  WG draft shapes (where they exist). */
export interface TradingOrderAuthDetail extends RarBase {
  type: 'trading_order';
  /** Allowed actions. RFC 9396 §2.1 actions. */
  actions: ReadonlyArray<'buy' | 'sell'>;
  /** Whitelisted instruments. Supports wildcards: 'NASDAQ:*', 'NYSE:AAPL'.
   *  Omit to allow any instrument. */
  instruments?: readonly string[];
  /** Spend caps for this detail. */
  limits?: {
    per_order_usd?: number;
    per_day_usd?: number;
    per_order_qty?: number;
  };
  /** Restrict to US market hours (09:30-16:00 ET, Mon-Fri).
   *  Trading-hours check uses the candidate's `at` timestamp if provided,
   *  else `Date.now()`. Non-business-day detection is out of scope here. */
  trading_hours_only?: boolean;
}

/** Payment-initiation RAR detail. Aligned with Open Banking UK payment
 *  initiation API + ISO 20022 pain.001 conventions. */
export interface PaymentInitiationAuthDetail extends RarBase {
  type: 'payment_initiation';
  actions: ReadonlyArray<'transfer' | 'pay' | 'refund'>;
  /** Destination account IDs or counterparty IDs. Omit to allow any. */
  destinations?: readonly string[];
  /** Allowed ISO 4217 currency codes. Omit to allow any. */
  currencies?: readonly string[];
  limits?: {
    per_transaction_usd?: number;
    per_day_usd?: number;
  };
}

/** Data-access RAR detail. Aligned with FAPI 2.0 Open Data profile +
 *  GDPR Article 6/7 lawful basis principles. */
export interface DataAccessAuthDetail extends RarBase {
  type: 'data_access';
  actions: ReadonlyArray<'read' | 'list' | 'aggregate'>;
  /** Resource URIs or glob patterns. Omit to allow any. */
  resources?: readonly string[];
  /** Whether personally identifiable information (PII) is in scope.
   *  Strict default: undefined → false (PII denied by default). */
  pii_allowed?: boolean;
}

/** Generic agent action — escape hatch for actions that don't fit
 *  the registered domain-specific types. Carries free-form action
 *  verbs but provides no domain-specific constraint evaluation. */
export interface AgentActionAuthDetail extends RarBase {
  type: 'agent_action';
  actions: readonly string[];
}

/** Union of all registered AEGIS RAR detail types. New types are
 *  additive and require operator review. */
export type AegisAuthorizationDetail =
  | TradingOrderAuthDetail
  | PaymentInitiationAuthDetail
  | DataAccessAuthDetail
  | AgentActionAuthDetail;

/** Stable list of registered type identifiers. The discovery doc
 *  surfaces this as `authorization_details_types_supported`. */
export const REGISTERED_AUTH_DETAIL_TYPES: readonly string[] = Object.freeze([
  'trading_order',
  'payment_initiation',
  'data_access',
  'agent_action',
]);

// ──────────────────────────────────────────────────────────────────────
// Candidate + result types
// ──────────────────────────────────────────────────────────────────────

/** A concrete agent action to evaluate against `authorization_details[]`. */
export interface RarCandidate {
  /** Detail type the candidate claims to fall under. Evaluator finds
   *  the matching AuthDetail by this field. */
  type: string;
  /** Action verb the candidate is performing. */
  action: string;
  /** USD amount of the candidate, if monetary. */
  amount_usd?: number;
  /** Currency of the candidate (ISO 4217). Defaults to USD. */
  currency?: string;
  /** Quantity / count for non-monetary candidates. */
  qty?: number;
  /** Instrument / security identifier — match against TradingOrderAuthDetail.instruments. */
  instrument?: string;
  /** Destination account or counterparty — match against PaymentInitiationAuthDetail.destinations. */
  destination?: string;
  /** Resource URI — match against DataAccessAuthDetail.resources. */
  resource?: string;
  /** Whether the data being accessed is PII. */
  is_pii?: boolean;
  /** Wall-clock timestamp the action is occurring at (for trading_hours_only check). */
  at?: Date;
  /** Daily-spent context — caller provides the running total so far
   *  for the slice (per-agent or per-policy) under this detail-type +
   *  day window. Evaluator adds the candidate amount and compares to
   *  `limits.per_day_usd`. Omit if caller doesn't track day windows. */
  spent_today_usd?: number;
}

/** Result of evaluating a candidate against `authorization_details[]`. */
export type RarEvaluationResult =
  | { ok: true; matched_detail_type: string }
  | { ok: false; reason: RarDenyReason; detail?: string };

/** Typed denial reasons. Mapped to the AEGIS denial-precedence
 *  taxonomy at the caller layer (typically as `SCOPE_NOT_GRANTED`). */
export type RarDenyReason =
  /** No `AuthDetail` in the array matched the candidate's `type`. */
  | 'type_unauthorized'
  /** Found a matching `type` but `actions` does not include the candidate action. */
  | 'action_unauthorized'
  /** Instrument not in the whitelist (and whitelist was non-empty). */
  | 'instrument_not_whitelisted'
  /** Destination not in the whitelist (and whitelist was non-empty). */
  | 'destination_not_whitelisted'
  /** Resource not in the whitelist (and whitelist was non-empty). */
  | 'resource_not_whitelisted'
  /** Per-order, per-transaction, per-qty, or per-day cap exceeded. */
  | 'limit_exceeded'
  /** Currency outside the allowed list. */
  | 'currency_unauthorized'
  /** PII access not allowed under this detail and candidate.is_pii=true. */
  | 'pii_disallowed'
  /** Action occurred outside trading hours and `trading_hours_only=true`. */
  | 'outside_trading_hours'
  /** Empty input array — no details to evaluate against. */
  | 'no_authorization_details';
