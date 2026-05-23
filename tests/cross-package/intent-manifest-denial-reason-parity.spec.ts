// Cross-package parity — @aegis/intent-manifest INTENT_MISMATCH_DENIAL_REASON
// vs. @aegis/types DENIAL_REASON_PRECEDENCE.
//
// Why this exists (load-bearing):
//   intent-manifest's source flags this parity in THREE separate places,
//   all explicitly noting it is enforced by convention (not by the type
//   system) because the package deliberately stays zero-dependency on
//   @aegis/types:
//
//     1. packages/intent-manifest/src/types.ts lines 198-209
//        (recommendedDenialReason field comment):
//          "The literal is byte-identical to the INTENT_MISMATCH member
//           appended to DENIAL_REASON_PRECEDENCE in @aegis/types. We use
//           a string (not an imported constant) so this package stays
//           zero-dependency on @aegis/types and remains edge-runtime
//           portable."
//
//     2. packages/intent-manifest/src/reconcile.ts lines 5-9
//        (module-level locked-behavior block):
//          "Denial reason on mismatch: literal 'INTENT_MISMATCH'.
//           Mirrors the member appended to DENIAL_REASON_PRECEDENCE in
//           @aegis/types. We use a string literal (not an imported
//           constant) so this package stays zero-dependency on
//           @aegis/types — preserves edge-runtime portability per
//           invariant #2."
//
//     3. packages/intent-manifest/src/reconcile.ts lines 29-33
//        (INTENT_MISMATCH_DENIAL_REASON export comment):
//          "Kept as a string-literal constant so the kernel doesn't take
//           a runtime dep on @aegis/types; mirrors
//           DENIAL_REASON_PRECEDENCE[11] (locked 2026-05-15, appended
//           after ANOMALY_FLAGGED per ADR-0016 DECISION 3 option (a))."
//
//   Three pieces of prose asserting the same invariant means three
//   places to silently rot. The compiler can never catch drift here
//   because of the deliberate zero-dep decision — the spec is the only
//   regression gate. If @aegis/types ever renames INTENT_MISMATCH (or
//   intent-manifest drifts its literal), the gateway's denial-precedence
//   behavior silently degrades:
//
//     - apps/api emits 'INTENT_MISMATCH' from reconciler.
//     - SDK / dashboard / public docs receive an unknown denial reason
//       (because @aegis/types no longer lists it) and either fall through
//       to a default branch or drop the reason on the floor.
//     - Operators see "ANOMALY_FLAGGED" or generic denials in metrics
//       instead of INTENT_MISMATCH and chase a phantom incident.
//
//   CLAUDE.md root invariant #6: "Denial precedence is stable API
//   behavior." This spec is one of its gates.
//
// What this spec DOES NOT cover:
//   - Reconciliation logic itself — that's reconcile.spec.ts.
//   - Whether INTENT_MISMATCH is wired into the gateway's algorithm in
//     the correct precedence position — that's apps/api's denial
//     precedence parity spec.
//   - The full @aegis/types ↔ @aegis/sdk-ts precedence sync — that's
//     tests/cross-package/denial-reason-parity.spec.ts. This file is
//     specifically the intent-manifest ↔ types axis, which the other
//     spec does not cover (intent-manifest is deliberately decoupled).

import { describe, expect, it } from 'vitest';

import { INTENT_MISMATCH_DENIAL_REASON } from '../../packages/intent-manifest/src/reconcile';
import { DENIAL_REASON_PRECEDENCE } from '../../packages/types/src/constants';

describe('intent-manifest INTENT_MISMATCH_DENIAL_REASON ↔ @aegis/types DENIAL_REASON_PRECEDENCE', () => {
  it('the intent-manifest literal is exactly the wire string "INTENT_MISMATCH"', () => {
    // Locks the WIRE string. A typo or case-shift here ('intent_mismatch',
    // 'INTENT-MISMATCH', 'IntentMismatch') would silently route to a
    // default branch in any consumer that switches exhaustively on the
    // DenialReason union.
    expect(INTENT_MISMATCH_DENIAL_REASON).toBe('INTENT_MISMATCH');
  });

  it('the canonical precedence tuple contains the intent-manifest literal', () => {
    // Locks MEMBERSHIP. If @aegis/types ever removes INTENT_MISMATCH from
    // DENIAL_REASON_PRECEDENCE (e.g., during a precedence refactor), this
    // fails immediately instead of letting intent-manifest emit a string
    // that no consumer recognizes.
    expect(DENIAL_REASON_PRECEDENCE as readonly string[]).toContain(
      INTENT_MISMATCH_DENIAL_REASON,
    );
  });

  it('the canonical precedence tuple lists INTENT_MISMATCH exactly once', () => {
    // Locks UNIQUENESS. A duplicate entry breaks denialReasonRank()'s
    // indexOf semantics and silently re-ranks the duplicate at the lower
    // index, distorting precedence ordering.
    const count = DENIAL_REASON_PRECEDENCE.filter(
      (r) => r === INTENT_MISMATCH_DENIAL_REASON,
    ).length;
    expect(count).toBe(1);
  });

  it('INTENT_MISMATCH appears AFTER ANOMALY_FLAGGED in the precedence tuple', () => {
    // Locks the ORDERING invariant documented in reconcile.ts:29-33:
    //   "mirrors DENIAL_REASON_PRECEDENCE[11] (locked 2026-05-15, appended
    //    after ANOMALY_FLAGGED per ADR-0016 DECISION 3 option (a))."
    //
    // Using relative ordering (not absolute index 11) keeps this lock
    // robust to legitimate inserts between them; rename, removal, or
    // reorder still fails loudly.
    const reasons = DENIAL_REASON_PRECEDENCE as readonly string[];
    const idxAnomaly = reasons.indexOf('ANOMALY_FLAGGED');
    const idxIntent = reasons.indexOf(INTENT_MISMATCH_DENIAL_REASON);

    expect(idxAnomaly).toBeGreaterThanOrEqual(0);
    expect(idxIntent).toBeGreaterThanOrEqual(0);
    expect(idxIntent).toBeGreaterThan(idxAnomaly);
  });

  it('INTENT_MISMATCH is positioned AFTER the eleven-step algorithm chain', () => {
    // Pre-algorithm and algorithm reasons enumerate as a stable chain;
    // INTENT_MISMATCH was appended outside of it (ADR-0016). The
    // PLAN_LIMIT_EXCEEDED billing gate comes BEFORE the chain;
    // INTENT_MISMATCH comes AFTER. This lock ensures intent-bound
    // attestation always evaluates last among the wire-level denial
    // surfaces, matching the algorithm's design.
    const reasons = DENIAL_REASON_PRECEDENCE as readonly string[];
    const idxIntent = reasons.indexOf(INTENT_MISMATCH_DENIAL_REASON);
    const idxBilling = reasons.indexOf('PLAN_LIMIT_EXCEEDED');

    expect(idxBilling).toBeGreaterThanOrEqual(0);
    expect(idxIntent).toBeGreaterThan(idxBilling);
  });
});
