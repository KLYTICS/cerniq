// Reconciliation kernel — pure function that walks `actuals` against a
// signed intent manifest and returns a closed-shape ReconciliationResult.
//
// Locked behavior (ADR-0016 / operator 2026-05-15):
//   - Denial reason on mismatch: literal 'INTENT_MISMATCH'. Mirrors the
//     member appended to DENIAL_REASON_PRECEDENCE in @aegis/types. We
//     use a string literal (not an imported constant) so this package
//     stays zero-dependency on @aegis/types — preserves edge-runtime
//     portability per invariant #2.
//   - Strictness modes:
//       strict    → ANY mismatch → DENY('INTENT_MISMATCH')
//       advisory  → mismatches still returned, recommendedDenialReason=null
//       graduated → over-call-count tolerated up to floor(maxCalls *
//                   (1 + tolerance/100)); default tolerance=20%. NON-count
//                   mismatches ALWAYS strict (wrong-merchant, over-amount-
//                   cap, wrong-method, wrong-endpoint, arg-shape-mismatch).

import {
  DEFAULT_GRADUATED_TOLERANCE_PCT,
  type ActualCallObservation,
  type IntentClaim,
  type IntentMismatch,
  type IntentMismatchKind,
  type ReconciliationResult,
  type SignedIntentManifest,
} from './types.js';

/**
 * The literal value AEGIS emits on intent-mismatch denial. Kept as a
 * string-literal constant so the kernel doesn't take a runtime dep on
 * @aegis/types; mirrors `DENIAL_REASON_PRECEDENCE[11]` (locked 2026-05-15,
 * appended after `ANOMALY_FLAGGED` per ADR-0016 DECISION 3 option (a)).
 */
export const INTENT_MISMATCH_DENIAL_REASON = 'INTENT_MISMATCH' as const;

export interface ReconcileOptions {
  /** Override the system clock for tests. */
  now?: () => number;
}

/**
 * Walk every observed actual against the manifest and return mismatches.
 * Pure — no IO, no logging, no audit-event emission. Caller wires those
 * side-effects at the boundary (apps/api/src/modules/verify/...).
 *
 * Contract:
 *   - Returns a result EVEN WHEN VERIFY-MANIFEST FAILS (signature is
 *     the caller's gate; this kernel trusts inputs).
 *   - Mismatches are ordered by detectedAt (caller-supplied via observedAt).
 *   - recommendedDenialReason is null on clean match OR when strictness
 *     is 'advisory' with mismatches present (advisory never denies).
 */
export function reconcileIntent(
  signed: SignedIntentManifest,
  actuals: readonly ActualCallObservation[],
  opts: ReconcileOptions = {},
): ReconciliationResult {
  const now = opts.now ?? Date.now;
  const nowSec = Math.floor(now() / 1000);
  const body = signed.body;
  const mismatches: IntentMismatch[] = [];

  // Temporal envelope — fire first because expired/not-yet-valid invalidates
  // every actual reconciliation that follows.
  if (nowSec > body.expiresAt) {
    mismatches.push({
      kind: 'manifest-expired',
      detail: `manifest expired ${nowSec - body.expiresAt}s ago`,
      detectedAt: nowSec,
    });
  } else if (nowSec < body.issuedAt) {
    mismatches.push({
      kind: 'manifest-not-yet-valid',
      detail: `clock skew or replay: now ${nowSec} < issuedAt ${body.issuedAt}`,
      detectedAt: nowSec,
    });
  }

  // Per-actual checks. Discriminator-driven so adding a new intent kind
  // means adding a new switch arm (and the compiler will yell — see
  // assertNever at the bottom).
  let perKindCount = 0;
  for (const actual of actuals) {
    perKindCount++;
    if (actual.kind !== body.intent.kind) {
      mismatches.push({
        kind: 'wrong-endpoint',
        detail: `actual.kind=${actual.kind} ≠ intent.kind=${body.intent.kind}`,
        detectedAt: actual.observedAt,
      });
      continue;
    }
    pushClaimMismatches(body.intent, actual, mismatches);
  }

  // Count cap is shape-agnostic.
  if (perKindCount > body.intent.maxCalls) {
    mismatches.push({
      kind: 'over-call-count',
      detail: `observed ${perKindCount} > declared maxCalls ${body.intent.maxCalls}`,
      detectedAt: nowSec,
    });
  }

  return {
    manifestId: body.manifestId,
    actualCount: actuals.length,
    mismatches,
    recommendedDenialReason: mapDenialReason(
      body.reconciliation.strictness,
      mismatches,
      body.intent.maxCalls,
      perKindCount,
      body.reconciliation.tolerance,
    ),
  };
}

function pushClaimMismatches(
  intent: IntentClaim,
  actual: ActualCallObservation,
  out: IntentMismatch[],
): void {
  switch (intent.kind) {
    case 'http-call': {
      const url = String(actual.payload.url ?? '');
      const method = String(actual.payload.method ?? '');
      if (url !== intent.url) {
        out.push({
          kind: 'wrong-endpoint',
          detail: `url ${url} ≠ ${intent.url}`,
          detectedAt: actual.observedAt,
        });
      }
      if (method.toUpperCase() !== intent.method) {
        out.push({
          kind: 'wrong-method',
          detail: `method ${method} ≠ ${intent.method}`,
          detectedAt: actual.observedAt,
        });
      }
      break;
    }
    case 'commerce-action': {
      const action = String(actual.payload.action ?? '');
      if (action !== intent.action) {
        out.push({
          kind: 'wrong-endpoint',
          detail: `action ${action} ≠ ${intent.action}`,
          detectedAt: actual.observedAt,
        });
      }
      if (intent.merchantId !== undefined) {
        const merchantId = String(actual.payload.merchantId ?? '');
        if (merchantId !== intent.merchantId) {
          out.push({
            kind: 'wrong-merchant',
            detail: `merchantId ${merchantId} ≠ ${intent.merchantId}`,
            detectedAt: actual.observedAt,
          });
        }
      }
      if (intent.amountCap) {
        const amount = String(actual.payload.amount ?? '0');
        if (Number(amount) > Number(intent.amountCap.amount)) {
          out.push({
            kind: 'over-amount-cap',
            detail: `amount ${amount} > cap ${intent.amountCap.amount}`,
            detectedAt: actual.observedAt,
          });
        }
      }
      break;
    }
    case 'tool-invocation': {
      const toolName = String(actual.payload.toolName ?? '');
      const argsHash = String(actual.payload.argsSha256B64Url ?? '');
      if (toolName !== intent.toolName) {
        out.push({
          kind: 'wrong-endpoint',
          detail: `tool ${toolName} ≠ ${intent.toolName}`,
          detectedAt: actual.observedAt,
        });
      }
      if (argsHash !== intent.argsSha256B64Url) {
        out.push({
          kind: 'arg-shape-mismatch',
          detail: 'argsSha256B64Url differs from declared',
          detectedAt: actual.observedAt,
        });
      }
      break;
    }
    default:
      // Compiler-enforced exhaustiveness. Adding a new IntentClaim member
      // without updating this switch is a build break.
      assertNever(intent);
  }
}

/**
 * Maps (strictness, mismatches, count) → wire-level denial reason.
 * Locked per ADR-0016 (operator 2026-05-15). See module docstring.
 *
 * Tolerance semantics for `graduated`:
 *   denyThreshold = floor(declaredMax * (1 + tolerance/100))
 *   observedCount > denyThreshold → DENY
 *   Non-count mismatches → DENY regardless of tolerance
 *
 * Why `floor` not `ceil`: floor is friendlier to small `declaredMax`
 * values. declaredMax=2 @ tolerance=20 → floor(2.4)=2 (no extra slack);
 * declaredMax=10 @ tolerance=20 → floor(12)=12 (2 extra calls). This
 * matches the operator-locked preview shown at decision time.
 */
function mapDenialReason(
  strictness: 'strict' | 'advisory' | 'graduated',
  mismatches: IntentMismatch[],
  declaredMax: number,
  observedCount: number,
  tolerancePctMaybe: number | undefined,
): 'INTENT_MISMATCH' | null {
  if (mismatches.length === 0) return null;
  switch (strictness) {
    case 'strict':
      return INTENT_MISMATCH_DENIAL_REASON;
    case 'advisory':
      return null;
    case 'graduated': {
      const tolerancePct = tolerancePctMaybe ?? DEFAULT_GRADUATED_TOLERANCE_PCT;
      const denyThreshold = Math.floor(declaredMax * (1 + tolerancePct / 100));
      const overCount = observedCount > denyThreshold;
      const nonCount = mismatches.some(
        (m) => (m.kind as IntentMismatchKind) !== 'over-call-count',
      );
      return overCount || nonCount ? INTENT_MISMATCH_DENIAL_REASON : null;
    }
  }
}

function assertNever(_x: never): never {
  throw new Error('unreachable: IntentClaim discriminator switch is non-exhaustive');
}
