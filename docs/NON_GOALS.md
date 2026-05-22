# OKORO — Non-goals

Last updated: 2026-05-22

A register of things OKORO will deliberately **not** build, with the
reasoning recorded so that the refusals are durable rather than tribal.

Non-goals are not eternal. Each entry includes an **escape hatch**
describing how the refusal could be reversed if a future situation
genuinely warrants it. The point of recording the refusal is to make
sure the reversal happens *because the reasoning has changed*, not
because the original reasoning was forgotten.

This document is referenced from:

- [docs/decisions/0004-denial-precedence-public-api.md](decisions/0004-denial-precedence-public-api.md)
  (configurable precedence)
- [docs/spec/03_TECHNICAL_SPEC.md](spec/03_TECHNICAL_SPEC.md) (SDK and
  edge surface area)
- `WORK_BOARD.md` (when a refused item is requested as a new module)

---

## 1. Refused product surfaces

### 1.1 — Configurable denial precedence

**What.** A configuration knob (env var, feature flag, per-principal
override, policy-engine extension) that reorders the canonical
denial precedence (see `DENIAL_REASON_PRECEDENCE` in
[packages/types/src/constants.ts](../packages/types/src/constants.ts)).

**Why refused.** The constancy of denial precedence is what makes
audit reports *cross-customer comparable*: `SPEND_LIMIT_EXCEEDED` at
position 9 means the same thing for Customer A and Customer B. That
property is what lets third-party auditors generalize, lets BATE
trust-score signals aggregate across the population, and lets
denial-reason-keyed retry libraries in customer code work
identically against any OKORO tenant. Per-customer ordering destroys
all three.

**Tempting moment.** A fintech or fraud-modeling customer with strong
domain instincts asks "can spend checks fire before signature checks
for our flow?" The request is sensible in isolation; granting it
once breaks the comparability property forever.

**Escape hatch.** API versioning, not configuration. If a market
consensus emerges that the ordering must change, ship `/v2/verify`
with the new precedence and run both endpoints during the
deprecation window. See ADR-0004 § "Reaffirmation: non-configurability".

---

### 1.2 — Additional first-party SDK languages

**What.** Net-new OKORO-maintained SDKs in Go, Java, Ruby, .NET, Rust,
or any language beyond the currently-shipped TypeScript
(`@aegis/sdk`) and Python (`aegis` PyPI).

**Why refused.** TS + Py covers ~95% of the agent-runtime ecosystem
this codebase targets. Adding a third first-party SDK without a
named customer who is *blocked* on it commits OKORO to language-
specific bug-fixing, security-patching, and contract-parity testing
in perpetuity. Public packages are forever once shipped; the
maintenance tax compounds. The wire contract is OpenAPI-published
and the cryptographic primitives are stdlib in every major language,
so unofficial community SDKs can exist without OKORO underwriting them.

**Tempting moment.** A prospect's engineering team says "we'd
integrate if you had a Go/Java/Rust SDK." Often the underlying
constraint is "we need official support," not "TypeScript bindings
won't run in our environment."

**Escape hatch.** A named design-partner customer with a paid
commitment whose stack genuinely cannot consume the OpenAPI spec
directly. The escape requires (a) the customer signing on, (b) an
internal staffing commitment to maintain the new SDK for at least 24
months, and (c) parity tests added to
[tests/cross-package/](../tests/cross-package/) before the SDK ships.

---

### 1.3 — Multi-cloud edge enforcement

**What.** Porting the Cloudflare verify-edge worker
(`workers/cf-verify/`) to AWS Lambda@Edge, Fastly Compute@Edge,
Azure Front Door, or any second edge provider.

**Why refused.** Single-cloud edge is sufficient for sub-50ms p99
in every region OKORO currently serves. Multi-cloud edge doubles
the operational surface (two runtimes, two deploy pipelines, two
sets of platform incidents to track) for a benefit that no customer
is currently asking for. The verify algorithm is portable by design
(CLAUDE.md invariant #2), so when a customer's contract genuinely
requires their edge provider, the *algorithm* moves cleanly — the
investment is in operations, not engineering.

**Tempting moment.** A prospect with an existing AWS-only or
Azure-only edge story asks if OKORO can run on theirs.

**Escape hatch.** First customer whose contract requires a specific
non-Cloudflare edge AND who pays for the integration. The escape
costs (a) implementing the second edge in their stack, (b) wiring
it into the existing parity suite (`tests/cross-package/fapi-worker-parity.spec.ts`
and siblings), and (c) committing to dual-deploy releases forever.

---

### 1.4 — Alternative canonicalization formats

**What.** Supporting JSON formats other than the deterministic
`sortKeys`-based canonicalization used by
[audit-chain.util.ts](../apps/api/src/common/crypto/audit-chain.util.ts)
and [intent manifest signing](../packages/intent-manifest/). RFC 8785
(JCS) compliance, customer-supplied canonicalization, or content-type
negotiation for the signed bytes.

**Why refused.** Canonicalization is a *single bit of cryptographic
agreement* between signer and verifier. Adding a second canonical
format means every signature carries an implicit format-version
field, every verifier must accept both, and any drift in
canonicalization libraries (sort stability, number formatting,
Unicode normalization) becomes a security-grade bug across the
matrix. The current sort-keys-recursive scheme is sufficient because
OKORO controls both signer and verifier surfaces, the test corpus
covers the edge cases
(`tests/cross-package/canonical-corpus-fixture.spec.ts`), and a
*third-party* verifier already ships in
[packages/audit-verifier](../packages/audit-verifier) using the same
canonical algorithm — so the wedge "an auditor can verify without
trusting us" is met without negotiating formats.

**Tempting moment.** A customer or third-party auditor cites RFC 8785
as a "standard" and asks for compliance. The standard is real and
the citation is correct, but compliance buys interoperability with
*other RFC 8785 implementations* — and no other implementation
shares our signed corpus.

**Escape hatch.** Publishing the signing format to *non-OKORO-built*
verifiers (a customer building their own from scratch, refusing to
use `@aegis/audit-verifier`). At that point the format must be a
published standard with vetted libraries; see
[audit-chain.util.ts:14-19](../apps/api/src/common/crypto/audit-chain.util.ts:14)
for the comment that pre-records this exact escape path.

---

### 1.5 — Customer-tunable BATE weights

**What.** Per-principal or per-policy configuration of the BATE
signal weights (currently locked at `v1.2.0-intent-2026-05-15` in
[bate.weights.ts](../apps/api/src/modules/bate/bate.weights.ts)).

**Why refused.** Trust scores are only meaningful if they are
*comparable across customers*. A fraud-report signal worth -200 in
one tenant and -50 in another produces incomparable BATE scores and
defeats the cross-tenant signal aggregation that makes the score
useful. The denial reason `TRUST_SCORE_TOO_LOW` exists precisely
because the score is calibrated against a population, not per
customer.

**Tempting moment.** A relying party asks "can we make velocity
anomalies count less for our flow, since we expect high velocity?"
The right answer is to adjust *their threshold for accepting low
scores* (a per-policy field), not the *score itself*.

**Escape hatch.** Per-policy thresholds are already supported — a
relying party can require trust ≥ 700 for high-value flows and
≥ 400 for low-value flows. This satisfies most "we have unusual
traffic patterns" requests without touching the weights. If a
customer's domain genuinely requires re-weighted scoring, the
escape is a separately-namespaced score (e.g.
`trustScore.industry_fintech`) — additive and disclosed, never a
mutation of the headline score.

---

## 2. Refused operational surfaces

### 2.1 — Customer-facing dashboard features before Auth0 v4 lands

**What.** New end-user dashboard screens, account-self-service
flows, or subscriptions UI shipped before the Auth0 v4 SDK is
installed and the login receiver is wired to a real IdP session.

**Why refused.** Every dashboard surface depends on the login
receiver. Shipping unexercised dashboard surfaces accumulates
features that can't be end-to-end tested by the customer, which
*looks* like progress and is actually drift between dashboard
state and what an authenticated user can actually do. The
dashboard CLAUDE.md guardrail makes this concrete.

**Tempting moment.** A sales asset (demo, screenshot, walkthrough)
requires a dashboard view that doesn't exist yet, and "build the
screen with a hard-coded session for the demo" is faster than
unblocking Auth0.

**Escape hatch.** Auth0 v4 installation completes (operator-owned)
and the login receiver passes its first end-to-end test with a real
session. At that point the dashboard freeze is lifted in a single
SESSION_HANDOFF entry.

---

### 2.2 — Stripe-side configuration without operator sign-off

**What.** Creating Stripe price IDs, configuring metered prices,
setting up Stripe Tax, or any other Stripe console action that
ships from a code change rather than an operator decision.

**Why refused.** Stripe console state is *production billing
infrastructure*. A mistake here charges real customers real money
incorrectly. The discipline boundary is: code changes can prepare
for Stripe state (env vars, test scaffolds, mock prices), but
actual Stripe console changes are operator-only.

**Tempting moment.** A pricing-related code path looks broken
because `STRIPE_PRICE_ID_*` env vars aren't set in the deployed
environment, and "I'll just create the price" is faster than
flagging it for the operator.

**Escape hatch.** Operator-owned process change: a documented
runbook for Stripe console actions, executed by the operator with
peer review. Not eligible for Claude execution under any
circumstance until that runbook exists.

---

## 3. Refused positioning claims

### 3.1 — "Universal AI agent identity" framing

**What.** Marketing copy or positioning language that frames OKORO
as a general-purpose AI agent identity layer for any consumer SaaS,
chat experience, browser extension, or hobbyist agent use case.

**Why refused.** The codebase has already chosen its vertical
through its `examples/` surface: FINRA broker-dealer, ISO 20022
treasury, banking-rails, fintech-payments, ACP fintech,
reconciliation, SaaS seat provisioning. These are regulated
financial services and adjacent procurement-shaped buyers.
Positioning OKORO as universal pulls discovery traffic from
audiences who can't justify the engineering OKORO has actually
built (audit-chain forensics, multi-tenant isolation, FAPI 2.0
conformance, KMS abstraction).

**Tempting moment.** A general-purpose AI agent framework gains
press attention and the temptation is to position OKORO as "verify
for [framework]." This optimizes for traffic; it does not optimize
for procurement-shaped customers.

**Escape hatch.** A specific market signal (paying customer in a
non-regulated vertical, a strategic partnership with a major
agent-framework vendor, or a deliberate Phase-2 expansion) makes
the universal framing earn its keep. Until then, the positioning is
"cryptographic agent receipts that an auditor can verify without
trusting us," and the buyers are CISOs of regulated industries.

---

## 4. How to add a non-goal

1. **Write the entry** in the appropriate section with the four-part
   structure: What / Why refused / Tempting moment / Escape hatch.
2. **Reference back** from any ADR or design doc that motivates the
   refusal, so the refused item appears in two places (here and at
   the decision surface).
3. **No "soft no" entries.** If something might be built later under
   ordinary circumstances, it's a roadmap item, not a non-goal. Only
   list things that require *new information* to revisit.

## 5. How to retire a non-goal (escape hatch fires)

1. The escape-hatch condition documented in the entry must be
   verifiably met (named customer, deployed precondition, market
   signal).
2. Open the ADR or design doc that proposes the new build. Reference
   the retired non-goal entry by anchor.
3. Move the retired entry to a "## Retired" section at the bottom of
   this file with a dated note explaining what changed. Do not
   delete it — future readers benefit from the history of refusals
   that were reconsidered.
