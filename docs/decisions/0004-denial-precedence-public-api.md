# ADR-0004 — Denial precedence is part of the public API

**Status**: accepted
**Date**: 2026-05-01

## Context

When `/v1/verify` rejects a request, it returns exactly one
`denialReason` from a fixed list. Real-world relying parties build
retry, escalation, and customer-messaging logic on top of these
reasons:

- A bank may auto-retry on `ANOMALY_FLAGGED` after step-up auth.
- An e-commerce site may block the agent for 24h on `AGENT_REVOKED`
  but allow re-authentication on `POLICY_EXPIRED`.
- A compliance system may escalate to human review on `SPEND_LIMIT_EXCEEDED`.

The order in which we check conditions matters because two reasons can
both apply (e.g., a revoked agent with an expired policy). Whichever
reason we return first **becomes the contract** — relying parties code
against it.

## Decision

The denial precedence is **part of the public API surface**. The order
is:

1. `AGENT_NOT_FOUND`
2. `AGENT_REVOKED`
3. `INVALID_SIGNATURE`
4. `POLICY_REVOKED`
5. `POLICY_EXPIRED`
6. `SCOPE_NOT_GRANTED`
7. `SPEND_LIMIT_EXCEEDED`
8. `TRUST_SCORE_TOO_LOW`
9. `ANOMALY_FLAGGED`

This ordering reflects "identity issues before policy issues before
behavioral issues" — relying parties learn the most actionable
information first.

The order is enforced in three places that must stay in sync:

- `docs/SECURITY.md` § "Denial precedence" (the human-readable contract)
- `packages/types/src/constants.ts` `DENIAL_REASON_PRECEDENCE` (the
  machine-readable constant)
- `apps/api/src/modules/verify/algorithm/verify.algorithm.ts` (the
  actual code path)

A planned spec assertion (`apps/api/src/modules/verify/algorithm/verify.algorithm.spec.ts`)
tests that the runtime order matches the constant.

## Consequences

### Positive
- Customer integrations are stable across our internal refactors.
- Bugs that swap two adjacent reasons are caught by spec assertions,
  not by Stripe complaining.

### Negative
- Adding a new denial reason in the middle of the list is a breaking
  change. New reasons go at the end, only.
- Renaming an existing reason is a breaking change. We accept that
  the names are slightly verbose to avoid future regret.

### Neutral
- We may eventually publish a JSON Schema or OpenAPI extension that
  pins this list at the wire level for downstream code generation.

## Alternatives considered

### Alt A: Return all applicable reasons as an array
More information for the relying party. Rejected because (a) it
encourages relying parties to ignore precedence and pattern-match on
their own, defeating the point of having a contract; (b) it leaks
internal evaluation order; (c) it complicates the "did this request
fail because X or Y" analytics that customers will want.

### Alt B: Return an opaque opaque error code with a free-form message
Rejected because relying parties end up regex-matching on the message
and breaking on every wording change.

### Alt C: Map each denial reason to an HTTP status code (401/403/etc.)
Rejected because `/v1/verify` always returns 200 with a structured
body — we treat denials as expected outcomes, not as errors. A
relying party that gets a 200 knows AEGIS evaluated the request; a
non-200 means AEGIS itself is broken.

## How to reverse this decision

Reversing means breaking the contract — bump the API version (`/v2/verify`)
and run both for the deprecation window. Plan: 90 days minimum after
public launch.

Adding new reasons (non-breaking): append to the constant list, add
the case to the algorithm, document in SECURITY.md, ship in the next
minor.

## References

- `docs/SECURITY.md` § Denial precedence
- `packages/types/src/constants.ts` `DENIAL_REASON_PRECEDENCE`
- `apps/api/src/modules/verify/algorithm/verify.algorithm.ts`
- `OPERATOR_DECISIONS.md` (no live decision touches this; flagged as
  "do not change without operator approval")

## Amendments

### 2026-05-22 — Three reasons added since v1

Since acceptance, the precedence list has grown from 9 to 12 reasons.
The canonical ordering, as enforced in
`packages/types/src/constants.ts` `DENIAL_REASON_PRECEDENCE` and
mirrored by the generated SDK constant
`packages/sdk-ts/src/denial-reason.generated.ts`, is now:

1. `PLAN_LIMIT_EXCEEDED`        ← new (billing pre-gate)
2. `AGENT_NOT_FOUND`
3. `AGENT_REVOKED`
4. `INVALID_SIGNATURE`
5. `POLICY_REVOKED`
6. `POLICY_EXPIRED`
7. `SCOPE_NOT_GRANTED`
8. `TRIAL_EXHAUSTED`            ← new (commercial lifetime gate)
9. `SPEND_LIMIT_EXCEEDED`
10. `TRUST_SCORE_TOO_LOW`
11. `ANOMALY_FLAGGED`
12. `INTENT_MISMATCH`           ← new (behavioral attestation gate)

Rationale for each insertion point:

- `PLAN_LIMIT_EXCEEDED` is the **pre-algorithm billing gate** (see
  root `CLAUDE.md`). It runs before any identity check because a
  customer over their plan cap must not consume engine resources to
  receive a denial. It is the only reason allowed to precede
  `AGENT_NOT_FOUND`.
- `TRIAL_EXHAUSTED` sits between scope and spend because a free-trial
  lifetime exhaustion is a *product-tier* gate, not a per-request
  spend gate. Relying parties may auto-upgrade on this reason, where
  `SPEND_LIMIT_EXCEEDED` requires operator-side action.
- `INTENT_MISMATCH` is appended last because it represents the
  highest-order check: identity, policy, and behavior have all passed,
  but the action does not match the agent's declared intent manifest.
  Relying parties that do not consume intent manifests will never see
  it; placing it last preserves the original "identity → policy →
  behavior" reading.

The non-negotiable-ordering policy of the original decision stands.
Reordering remains a `/v2/verify` breaking change. New reasons may be
appended (or, for billing pre-gates, prepended) without bumping the
API version.

### Sync status at time of amendment

- `docs/SECURITY.md` § "Denial precedence" was verified current at
  this amendment: it documents all 12 reasons in the correct order
  and annotates the 2026-05-05 insertion of `TRIAL_EXHAUSTED`. The
  drift closed by this amendment was exclusively between code and the
  ADR; the human-readable security contract did not drift.
- Cross-package parity tests in `tests/cross-package/` already enforce
  the order at the constant and SDK level
  (`denial-precedence-enum.spec.ts`,
  `denial-reason-parity.spec.ts`,
  `denial-reason-sdk-py-parity.spec.ts`,
  `docs-denial-precedence-parity.spec.ts`); no test update needed for
  this amendment.

### 2026-05-22 — Reaffirmation: non-configurability

The precedence ordering is **non-configurable by design**. No
environment variable, feature flag, principal-scoped override,
per-customer config knob, policy-engine extension point, or runtime
parameter will be added to reorder denial precedence. This is
recorded as a separate amendment so that the refusal is durable
rather than tribal knowledge.

**Why a CISO or sales engineer might be tempted:** a customer with
strong fraud-modeling instincts may ask "can spend checks fire before
signature checks for our flow?" — the request is sensible in
isolation. Granting it once, even behind a per-principal flag, breaks
the property that audit reports are *cross-customer comparable*
(`SPEND_LIMIT_EXCEEDED` on Customer A's chain no longer carries the
same semantic position as on Customer B's chain). The comparability
is what lets third-party auditors generalize, what lets BATE
trust-score signals aggregate across the population, and what lets
denial-reason-keyed retry libraries in customer code work identically
against any OKORO tenant. Per-customer ordering destroys all three in
exchange for one deal's ergonomic preference.

**The escape hatch is API versioning, not configuration.** If a
future market consensus emerges that the ordering must change, the
mechanism is a new major version of `/v1/verify` (i.e. `/v2/verify`)
with the new precedence shipping on both endpoints during the
deprecation window. That preserves the comparability property *within
a version* while letting it evolve *between versions*.

**This refusal is referenced from [docs/NON_GOALS.md](../NON_GOALS.md)
§ "Refused product surfaces"** so it travels with the broader
refuse-to-build list rather than living only in this ADR.
