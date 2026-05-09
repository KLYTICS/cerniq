# ADR-0014 — Pricing tiers + free-trial design

**Status**: accepted
**Date**: 2026-05-05
**Deciders**: operator (Erwin Kiess-Alfonso)
**Supersedes**: none — closes OPERATOR_DECISIONS.md OD-003

## Context

`OPERATOR_DECISIONS.md` OD-003 has been **OPEN** since the project's
inception, blocking module M-011 (Stripe billing). The row carries an
unresolved conflict between two competing tier sets:

1. The default published in OD-003 itself: **Free 1K / Developer $49 (50K)
   / Growth $299 (500K) / Enterprise (custom)**.
2. The structure proposed in `docs/spec/04_COMMERCIAL_STRATEGY.md` Part V:
   **Free 10K / Developer $29 (500K) / Growth $149 (5M)**.

A separate, related decision was implicit but never formally recorded: how
generous should the **free trial** be, and is it time-bounded or
usage-bounded? `docs/spec/04_COMMERCIAL_STRATEGY.md` Persona A names a
"free tier that lasts long enough to prove value" but does not specify
mechanics.

These two decisions are coupled — pricing is meaningless without the
trial that funnels developers into it. M-011 cannot ship until both are
locked.

A companion financial model
(`docs/finance/AEGIS_Financial_Model_v1.xlsx`) was built on 2026-05-05 to
size the consequences of each candidate combination over a 24-month
horizon. The companion strategy memo
(`docs/finance/AEGIS_Strategy_Memo_v1.docx`) walks through the rationale
in narrative form. This ADR is the binding decision.

## Decision

AEGIS adopts the following pricing surface and free-trial design,
encoded in `apps/api/src/modules/billing/plans.ts`:

| Tier        | Price/mo | Verifies included/mo | Overage rate          |
| ----------- | -------- | -------------------- | --------------------- |
| Free trial  | $0       | 10,000 (lifetime cap) | n/a — verify returns 402 at cap |
| Developer   | $49      | 50,000               | $0.0008 / verify      |
| Team        | $299     | 500,000              | $0.0008 / verify      |
| Scale       | $1,499   | 5,000,000            | $0.0008 / verify      |
| Enterprise  | Custom   | Custom               | Negotiated            |

The free trial is **usage-capped, not time-capped**. There is no
30-day clock. A principal that hits the 10,000-verification cap receives
HTTP 402 with a new denial code `TRIAL_EXHAUSTED` (added to the
denial-precedence chain in `docs/SECURITY.md` § Denial Precedence,
between `SCOPE_NOT_GRANTED` and `SPEND_LIMIT_EXCEEDED`).

The overage rate of $0.0008/verify is uniform across paid tiers (Dev,
Team, Scale). The rate is 160× the marginal compute cost of $5/M-verify
documented in `docs/CAPACITY_PLAN.md` §11.2 — overage is convenience
pricing, not consumption pricing.

## Consequences

### Positive

- **Closes OD-003.** Move the row from § 2 (Open decisions) to § 3
  (Recently decided) in `OPERATOR_DECISIONS.md` with resolution
  "See ADR-0014".
- **Unblocks M-011 (Stripe billing).** Tiers, verify caps, and overage
  rate are unambiguous; `plans.ts` can be implemented from this row.
- **Funnel and unit economics defensible.** Per the financial model,
  break-even conversion rate is 0.026% (LTV-based) or 0.69% (one-time
  ARPU-based) against a modeled 18% steady-state — extreme headroom.
- **Aligns with Persona A's revealed preference.** A 10K-verify cap is
  enough to integrate AEGIS into a real workflow (Persona A's "free tier
  that lasts long enough to prove value") but not enough to substitute
  for a paid tier indefinitely.
- **Removes calendar pressure from the developer.** Usage-capped trials
  do not penalize a developer who takes a week's vacation between signup
  and integration, fixing a common dev-tool free-trial failure mode.
- **Preserves the OD-003 default Developer price ($49).** No change to
  the price already discussed in OPERATOR_DECISIONS.md, just resolves
  the spec-vs-default conflict on verify caps.

### Negative

- **Departs from spec § Part V.** The spec proposed Developer at $29
  with 500K verifies; we keep $49 with 50K. The spec text in
  `docs/spec/04_COMMERCIAL_STRATEGY.md` Part V should be updated in the
  same merge to reflect this ADR, or it will accumulate drift.
- **Overage rate is high.** $0.0008/verify is 160× marginal cost. A
  customer who naively crosses their tier cap by a large amount will
  feel surprise billing. Mitigation: surface usage warnings at 80%, 90%,
  and 100% of cap in the dashboard and via webhook.
- **Trial cap encodes abuse risk into a fixed number.** If trial abuse
  exceeds 10% of signups, the cap will need to drop (the strategy memo
  recommends to 5K). Operationally this means we must instrument
  abuse-rate measurement before relying on the model's economics
  (FN-1 in §8 of the strategy memo).
- **Scale tier ($1,499) is a new price point.** It is not validated
  against any existing customer conversation. First Persona C-flavored
  buyer may push for custom Enterprise pricing immediately.

### Neutral

- Spec docs `docs/spec/04_COMMERCIAL_STRATEGY.md` Part V and
  `docs/spec/01_MASTER.md` § "Tiers" need a follow-up edit to match this
  decision. Out of scope for this ADR.
- Stripe metering must support per-tier verify caps with overage.
  Confirmed feasible (matches Stripe's metered-billing primitives).
- The denial-code addition (`TRIAL_EXHAUSTED`) bumps the public API
  minor version. Per CLAUDE.md invariant #6, the OpenAPI spec and SDK
  types must be updated in the same merge.

## Alternatives considered

### Alt A — OD-003 default verbatim (Free 1K / Dev $49 / Growth $299)

The 1K free tier is too small to integrate AEGIS into a real workflow.
A typical agent integration test exercises ~500 verifications during
development alone — a 1K cap would force a paywall before the developer
had tested the production code path. Forecast trial-to-paid conversion
under this configuration drops to ~6-8%, not enough to justify the
acquisition spend. Rejected.

### Alt B — Spec § Part V verbatim (Free 10K / Dev $29 / Growth $149)

The 10K free trial is right (we adopted it). The $29 Dev price is wrong.
At $29 the Dev tier is too close to free in the buyer's mental model
("why pay anything?") and mid-funnel monetization disappears. The $49
price creates a meaningful psychological gap that paradoxically improves
activation depth — paying customers integrate harder than free-tier
squatters. Rejected on the price point only; verify cap adopted.

### Alt C — Time-bounded trial (30 days unlimited)

Time trials punish the user's calendar, not their intent. They also
expose us to tail risk: a single bad-faith trial can consume
unrestricted compute for 30 days. A usage cap binds the worst-case cost
to a known quantity ($0.05 marginal compute per trial). Rejected.

### Alt D — Permanent free tier (1K verifies/mo forever)

Permanent free tiers compress monetization expectations and dilute the
upgrade trigger. Engineering effort spent maintaining a durable free
tier (rate-limit isolation, quota carry-over edge cases, billing-page
"free" branding) is non-trivial. AEGIS is too early-stage to absorb
this overhead. Reconsider in 18-24 months once the paid funnel is
proven. Rejected for now.

### Alt E — Pure usage pricing ($0.001/verify, $50 minimum)

Twilio-style pure usage. Lowest friction to start but creates lumpy,
unpredictable revenue. Forecasting becomes hard, and the absence of
monthly subscription anchors makes upsell conversations weaker. Buyer
Personas B and C explicitly mentioned wanting a published, predictable
monthly price. Rejected.

## How to reverse this decision

If pricing or trial design needs to change:

1. **Code surfaces** —
   - `apps/api/src/modules/billing/plans.ts` (tier catalogue)
   - `apps/api/src/modules/billing/trial.service.ts` (cap + denial code)
   - `apps/api/src/modules/verify/verify.module.ts` (TRIAL_EXHAUSTED
     wiring + rate-limit)
   - `packages/sdk-ts/src/billing.ts` (public types)
   - `packages/sdk-py/aegis/billing.py` (public types)
2. **Docs** —
   - `docs/SECURITY.md` § Denial Precedence (update or remove
     TRIAL_EXHAUSTED)
   - `docs/spec/04_COMMERCIAL_STRATEGY.md` Part V (tier table)
   - `docs/finance/AEGIS_Strategy_Memo_v1.docx` § 4 (pricing rationale)
   - `docs/finance/AEGIS_Financial_Model_v1.xlsx` Assumptions tab (blue
     cells for tier prices, verify caps, free-trial cap)
3. **Customer comms** —
   - Existing paying customers on legacy tiers: grandfathering policy
     must be specified; recommend 12-month grandfather window.
   - Active free-trial users: remaining trial allowance preserved at
     conversion to new structure.
   - Public pricing page + changelog entry.
4. **API versioning** —
   - Adding/removing denial codes is a minor-version bump per
     CLAUDE.md invariant #6.
   - Changing tier prices is not an API-version event.
5. **OPERATOR_DECISIONS.md** —
   - Re-open OD-003 with reference to the superseding ADR-NNNN.
6. **Financial impact** —
   - Re-run the financial model with new inputs. Quarterly review
     cadence per `docs/CAPACITY_PLAN.md` § review schedule is the
     natural moment to evaluate.

## References

- `OPERATOR_DECISIONS.md` § 2 OD-003 (closed by this ADR)
- `docs/spec/04_COMMERCIAL_STRATEGY.md` (buyer personas + sales motions)
- `docs/CAPACITY_PLAN.md` §11 (per-1M-verify marginal cost = $5)
- `docs/SECURITY.md` § Denial Precedence (TRIAL_EXHAUSTED insertion)
- `docs/finance/AEGIS_Financial_Model_v1.xlsx` (24-month projection)
- `docs/finance/AEGIS_Strategy_Memo_v1.docx` (rationale narrative)
- `CLAUDE.md` invariant #6 (denial-precedence change requires API
  minor-version bump)
- ADR-0006 (audit-event redactability) — relevant because TRIAL_EXHAUSTED
  becomes an auditable denial event
- ADR-0012 (pluggable policy engine) — pricing tier hard gates do not
  block this; tiers are a billing concern, not a policy-engine concern
