// AEGIS RAR (RFC 9396) — pure-function evaluator.
//
// Given an `authorization_details[]` and a candidate action, return
// ALLOW or a typed DENY reason. Zero NestJS dependencies; safe to
// import from edge runtimes and SDK packages.
//
// Algorithm:
//   1. If `details[]` is empty → 'no_authorization_details'.
//   2. Find the first detail whose `type` matches `candidate.type`. If
//      none match → 'type_unauthorized'.
//   3. Check `actions[]` includes `candidate.action`. If not →
//      'action_unauthorized'.
//   4. Apply type-specific constraints (instruments / destinations /
//      resources / limits / currencies / pii / trading_hours).
//   5. Return ALLOW with the matched type.
//
// Multiple matching details with the same type are NOT supported in
// this version — the first match wins. Adding union-of-matching-details
// is roadmap work (would need OR semantics across detail rows).
//
// Authority: `docs/spec/05_FAPI_2_0_PROFILE.md` §2 — promotion test
// `rar.evaluator.spec.ts`.

import type {
  AegisAuthorizationDetail,
  AgentActionAuthDetail,
  DataAccessAuthDetail,
  PaymentInitiationAuthDetail,
  RarCandidate,
  RarEvaluationResult,
  TradingOrderAuthDetail,
} from './rar.types';

/** Evaluate a candidate action against an array of RAR authorization
 *  details. Pure function — no IO, no side effects. */
export function evaluateRar(
  details: readonly AegisAuthorizationDetail[],
  candidate: RarCandidate,
): RarEvaluationResult {
  if (details.length === 0) {
    return { ok: false, reason: 'no_authorization_details' };
  }

  const matched = details.find((d) => d.type === candidate.type);
  if (!matched) {
    return { ok: false, reason: 'type_unauthorized' };
  }

  // Per-type evaluation. Discriminated-union narrowing keeps each
  // evaluator typed to its own detail shape.
  switch (matched.type) {
    case 'trading_order':
      return evaluateTradingOrder(matched, candidate);
    case 'payment_initiation':
      return evaluatePaymentInitiation(matched, candidate);
    case 'data_access':
      return evaluateDataAccess(matched, candidate);
    case 'agent_action':
      return evaluateAgentAction(matched, candidate);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Type-specific evaluators
// ──────────────────────────────────────────────────────────────────────

function evaluateTradingOrder(
  d: TradingOrderAuthDetail,
  c: RarCandidate,
): RarEvaluationResult {
  if (!d.actions.includes(c.action as 'buy' | 'sell')) {
    return { ok: false, reason: 'action_unauthorized' };
  }

  // Instrument whitelist with glob support: 'NASDAQ:*' matches any
  // NASDAQ ticker; 'NYSE:AAPL' is an exact match.
  if (d.instruments && d.instruments.length > 0) {
    if (!c.instrument) {
      return { ok: false, reason: 'instrument_not_whitelisted' };
    }
    if (!matchesAnyGlob(c.instrument, d.instruments)) {
      return { ok: false, reason: 'instrument_not_whitelisted' };
    }
  }

  // Spend caps.
  const limits = d.limits;
  if (limits) {
    if (
      limits.per_order_usd != null &&
      c.amount_usd != null &&
      c.amount_usd > limits.per_order_usd
    ) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        detail: `per_order_usd=${limits.per_order_usd} amount=${c.amount_usd}`,
      };
    }
    if (
      limits.per_day_usd != null &&
      c.amount_usd != null &&
      (c.spent_today_usd ?? 0) + c.amount_usd > limits.per_day_usd
    ) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        detail: `per_day_usd=${limits.per_day_usd} spent_today+amount=${
          (c.spent_today_usd ?? 0) + c.amount_usd
        }`,
      };
    }
    if (
      limits.per_order_qty != null &&
      c.qty != null &&
      c.qty > limits.per_order_qty
    ) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        detail: `per_order_qty=${limits.per_order_qty} qty=${c.qty}`,
      };
    }
  }

  // Trading-hours check. US Eastern Time, 09:30-16:00, Mon-Fri.
  // Operator may override the calendar in a future spec_version; this
  // is the FAPI 2.0 Capital Markets WG draft assumption.
  if (d.trading_hours_only) {
    const at = c.at ?? new Date();
    if (!isUsTradingHours(at)) {
      return { ok: false, reason: 'outside_trading_hours' };
    }
  }

  return { ok: true, matched_detail_type: 'trading_order' };
}

function evaluatePaymentInitiation(
  d: PaymentInitiationAuthDetail,
  c: RarCandidate,
): RarEvaluationResult {
  if (!d.actions.includes(c.action as 'transfer' | 'pay' | 'refund')) {
    return { ok: false, reason: 'action_unauthorized' };
  }

  if (d.destinations && d.destinations.length > 0) {
    if (!c.destination || !d.destinations.includes(c.destination)) {
      return { ok: false, reason: 'destination_not_whitelisted' };
    }
  }

  if (d.currencies && d.currencies.length > 0) {
    const cur = c.currency ?? 'USD';
    if (!d.currencies.includes(cur)) {
      return { ok: false, reason: 'currency_unauthorized' };
    }
  }

  const limits = d.limits;
  if (limits) {
    if (
      limits.per_transaction_usd != null &&
      c.amount_usd != null &&
      c.amount_usd > limits.per_transaction_usd
    ) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        detail: `per_transaction_usd=${limits.per_transaction_usd} amount=${c.amount_usd}`,
      };
    }
    if (
      limits.per_day_usd != null &&
      c.amount_usd != null &&
      (c.spent_today_usd ?? 0) + c.amount_usd > limits.per_day_usd
    ) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        detail: `per_day_usd=${limits.per_day_usd} spent_today+amount=${
          (c.spent_today_usd ?? 0) + c.amount_usd
        }`,
      };
    }
  }

  return { ok: true, matched_detail_type: 'payment_initiation' };
}

function evaluateDataAccess(
  d: DataAccessAuthDetail,
  c: RarCandidate,
): RarEvaluationResult {
  if (!d.actions.includes(c.action as 'read' | 'list' | 'aggregate')) {
    return { ok: false, reason: 'action_unauthorized' };
  }

  if (d.resources && d.resources.length > 0) {
    if (!c.resource) {
      return { ok: false, reason: 'resource_not_whitelisted' };
    }
    if (!matchesAnyGlob(c.resource, d.resources)) {
      return { ok: false, reason: 'resource_not_whitelisted' };
    }
  }

  // PII strict-default: undefined or false → PII access denied. Only
  // explicit pii_allowed=true permits PII candidates.
  if (c.is_pii && !d.pii_allowed) {
    return { ok: false, reason: 'pii_disallowed' };
  }

  return { ok: true, matched_detail_type: 'data_access' };
}

function evaluateAgentAction(
  d: AgentActionAuthDetail,
  c: RarCandidate,
): RarEvaluationResult {
  if (!d.actions.includes(c.action)) {
    return { ok: false, reason: 'action_unauthorized' };
  }
  return { ok: true, matched_detail_type: 'agent_action' };
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/** Glob match — supports trailing-`*` wildcard only.
 *  'NASDAQ:*' matches 'NASDAQ:AAPL'; 'NYSE:AAPL' matches itself.
 *  Future: anchored regex syntax if operator demand emerges. */
function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (p.endsWith('*')) {
      const prefix = p.slice(0, -1);
      if (value.startsWith(prefix)) return true;
    } else if (p === value) {
      return true;
    }
  }
  return false;
}

/** US trading hours check: Mon-Fri 09:30-16:00 America/New_York.
 *  No holiday awareness (out of scope for v1). */
function isUsTradingHours(at: Date): boolean {
  // Use a stable approach without timezone libraries: derive ET offset
  // from the system's reported timezone offset for the given date and
  // adjust. JavaScript's Intl API is the right primitive here.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);

  // Weekend reject
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  // 09:30 inclusive to 16:00 exclusive (standard NYSE/NASDAQ hours)
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
