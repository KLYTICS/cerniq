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
relying party that gets a 200 knows OKORO evaluated the request; a
non-200 means OKORO itself is broken.

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
