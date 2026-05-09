---
title: AEGIS — Quality Gates
audience: every Reviewer; every contributor before requesting review
last-reviewed: 2026-05-08
status: source-of-truth — v1
---

# 04 — Quality Gates

> The bar every deliverable clears. There are six gates: Code, Security,
> Design, Documentation, Compliance, Narrative. Different stages of work
> clear different subsets of gates; an architecture ADR clears Narrative
> but not Code, a UI fix clears Design and Code but not Compliance, a
> board update clears Narrative and Compliance but not Code. The
> Reviewer's job is to know which gates apply and confirm each.

---

## Gate routing — which gates apply to which work

```
                       Code  Security  Design  Docs  Compliance  Narrative
─────────────────────  ────  ────────  ──────  ────  ──────────  ─────────
Code change (non-UI)    ●       ●               ●                    ●
UI/visual code change   ●       ●        ●      ●                    ●
Crypto / audit code     ●       ●               ●        ●           ●
ADR (architectural)             ●                                    ●
ADR (security/audit)            ●                        ●           ●
Marketing copy                                  ●        ●           ●
Docs page                                       ●                    ●
Brand foundation change                  ●                           ●
Customer-facing claim                           ●        ●           ●
Investor / board doc                                     ●           ●
Pricing change          ●                                ●           ●
Release notes                                   ●                    ●
Threat model update             ●                        ●           ●
Incident postmortem             ●                        ●           ●
```

If your work falls into more than one row, the gates are the union.

---

## Gate 1 — Code

The bar for code merging into `main`.

### 1.1 Compilation and type-safety

- ✅ `pnpm typecheck` (or per-app `pnpm --filter @aegis/<package>
  typecheck`) passes with zero errors.
- ✅ `noUncheckedIndexedAccess` is on at the base `tsconfig`. The API
  workspace softens it; nothing else does.
- ✅ No `any` without `// type-rationale: <reason>` comment immediately
  above.
- ✅ Strict mode in TS is on; no `// @ts-ignore` without a `// FIXME:
  <reason> + <issue link>` and an issue tracking the removal.

### 1.2 Lint and format

- ✅ `pnpm lint --max-warnings 0` passes (per-app or repo-wide).
- ✅ Prettier formatted. CI enforces.

### 1.3 Tests

- ✅ Every public service method has a unit test or `// untestable:
  <reason>`.
- ✅ Cryptographic code has a paired `.spec.ts`. No exception. (See
  `CLAUDE.md` § Quality bar.)
- ✅ Tests pass locally. The Reviewer runs them too for non-trivial
  PRs.
- ✅ New tests added for the new behavior. The PR's test plan
  checklist matches reality.
- ✅ Snapshot tests, if used, are reviewed and not blindly accepted —
  diff is meaningful.
- ✅ Coverage delta is non-negative. A change that drops coverage in
  the affected module fails this gate without a `// coverage-rationale:`
  comment.

### 1.4 Architectural invariants (`CLAUDE.md`)

- ✅ Invariant 1 (private keys never enter AEGIS) — confirmed.
- ✅ Invariant 2 (verify hot path is portable, no framework imports) —
  confirmed if the change is in `apps/api/src/modules/verify/` or
  related.
- ✅ Invariant 3 (audit log is append-only and signed) — confirmed if
  the change touches audit.
- ✅ Invariant 4 (no silent failures, no fabricated data) — confirmed.
  Look for any `try/catch` that swallows; any default-empty array
  pretending to be a "no results" answer; any `Math.random` in
  production paths.
- ✅ Invariant 5 (multi-tenant isolation by `principalId`) — confirmed
  if the change touches a service method or query.
- ✅ Invariant 6 (denial precedence is fixed) — confirmed if the change
  touches the verify response or a denial reason.

### 1.5 Errors

- ✅ Errors are typed (`AegisError` subclasses), not strings.
- ✅ Error messages do not leak secrets.
- ✅ Error responses follow the documented shape (the API contract in
  `packages/types`).

### 1.6 Database

- ✅ Schema changes have a Prisma migration.
- ✅ Migration is reversible (or has a documented `// IRREVERSIBLE:
  <reason>` block).
- ✅ Data migration scripts (when needed) are idempotent.
- ✅ No schema change introduces a `UPDATE` or `DELETE` capability on
  `AuditEvent` (invariant 3).

### 1.7 Cross-package parity

- ✅ Constants live in `packages/types`, not duplicated in apps.
- ✅ If a duplication exists (a fallback table in the dashboard mirrors
  the API), a parity test exists in `tests/cross-package/` that fails
  the build if the two drift. The Round 23 entry in
  `SESSION_HANDOFF.md` is the canonical example.

### Gate 1 checklist (paste into PR review)

```
[ ] typecheck: zero errors
[ ] lint: zero warnings
[ ] tests: pass locally + in CI; coverage non-negative
[ ] no `any` without rationale
[ ] no silent failures or fabricated data
[ ] invariant 1 (private keys): preserved
[ ] invariant 2 (verify path portability): preserved
[ ] invariant 3 (audit append-only): preserved
[ ] invariant 4 (no silent failures): preserved
[ ] invariant 5 (principal isolation): preserved
[ ] invariant 6 (denial precedence): preserved
[ ] errors typed; no secrets in messages
[ ] DB migrations reversible or documented
[ ] cross-package parity test if duplication exists
```

---

## Gate 2 — Security

The bar for changes that touch the security surface.

### 2.1 Surface identification

A change touches the security surface if it changes any of:
- Cryptographic primitives or their use.
- Signature creation or verification.
- The audit chain (event creation, hashing, linking, export).
- Denial precedence (reasons, order, semantics).
- Authentication or session handling.
- Input validation on a public endpoint.
- Threat-model assumptions.

### 2.2 Required artifacts

- ✅ A paired `.spec.ts` for new crypto code with positive AND negative
  test vectors.
- ✅ Constant-time comparison where required (e.g. signature equality
  checks).
- ✅ Test vectors covering: empty input, max input, malformed input,
  valid-looking-but-invalid input.
- ✅ No secret in error messages.
- ✅ Threat model updated within 14 days if the change creates a new
  attack surface.
- ✅ For changes to denial precedence: an ADR exists, a public API
  minor-version bump is queued, downstream RP integrations are
  notified.

### 2.3 Crypto-specific

- ✅ One curve, one library: Ed25519 via `@noble/ed25519`. No
  alternatives introduced (`CLAUDE.md` § Stack reality).
- ✅ JWTs are EdDSA via `jose`. No HS256, no RS256.
- ✅ Random number generation uses `crypto.randomBytes` or platform-
  equivalent CSPRNG. No `Math.random` ever.
- ✅ Key derivation uses canonical primitives. No homegrown KDF.

### 2.4 Audit chain

- ✅ Events are created via `audit.service.append()`. No direct
  `prisma.auditEvent.create` outside the service.
- ✅ Hash chain links correctly: `prev_sig || canonical(event)` is
  signed.
- ✅ The audit-chain integrity test (`audit-chain.util.spec.ts`)
  passes.

### 2.5 Public endpoint

- ✅ Input validation by Zod schema imported from `packages/types`.
- ✅ Rate limiting via `@nestjs/throttler` is in effect.
- ✅ The endpoint is documented in the OpenAPI spec.
- ✅ An audit event is written for the call (success or failure).

### Gate 2 checklist

```
[ ] paired .spec.ts for crypto code
[ ] constant-time comparisons where required
[ ] no secrets in error messages
[ ] random uses CSPRNG, not Math.random
[ ] one curve, one library — no alternatives introduced
[ ] audit events written via audit.service.append() only
[ ] hash chain integrity test passes
[ ] threat model updated if attack surface changed
[ ] denial precedence: ADR exists if order/reason changed
```

---

## Gate 3 — Design

The bar for visual surfaces.

### 3.1 Brand foundation compliance

- ✅ All colors source from `docs/design/00_BRAND_FOUNDATION.md` § 4.
  No hardcoded hex outside the foundation file. Any deviation is a
  block.
- ✅ Type stack is Inter + JetBrains Mono, no other fonts.
- ✅ Spacing follows the §6 scale.
- ✅ Radius and shadows follow §6.3 and §6.4.
- ✅ No gradient on text, no stock photo, no mascot, no glow orb (§9).
- ✅ Motion respects `prefers-reduced-motion`.

### 3.2 Accessibility

- ✅ WCAG 2.2 AA minimum (AAA preferred for body text).
- ✅ Color contrast verified.
- ✅ Every interactive element has a visible focus state.
- ✅ Keyboard navigation works — Tab through every flow.
- ✅ Screen reader pass on at least one detail page in the surface.
- ✅ Labels are visible; placeholder is not used as a label.
- ✅ Tables use `<th scope>`.
- ✅ Modals trap focus and restore on close.

### 3.3 Performance

- ✅ Lighthouse Performance ≥95 (≥98 for docs).
- ✅ Lighthouse Accessibility ≥95 (≥98 for docs).
- ✅ Lighthouse Best Practices ≥95.
- ✅ Lighthouse SEO ≥95 (for marketing/docs).
- ✅ Largest Contentful Paint <2.5s on simulated mobile.

### 3.4 Visual coherence

- ✅ The surface reads as the same product as adjacent surfaces. (Test:
  navigate from marketing → dashboard → docs → marketing; if the
  visual register shifts unintentionally, fail.)
- ✅ Recurring brand visuals (4-layer stack, denial-precedence ladder,
  request-lifecycle swim-lane) come from `packages/ui-brand/visuals/`,
  not redrawn locally.
- ✅ Code samples follow `00_BRAND_FOUNDATION.md` § 10 — bold-italic
  on AEGIS-specific calls, mono header strip, copy button, language
  label.

### Gate 3 checklist

```
[ ] all colors from foundation tokens (no inline hex)
[ ] Inter + JetBrains Mono only
[ ] no stock photos, no mascots, no glow orbs
[ ] motion respects prefers-reduced-motion
[ ] WCAG 2.2 AA verified (real screen-reader pass)
[ ] keyboard navigation works
[ ] visible focus states everywhere
[ ] Lighthouse: ≥95 on every category (≥98 for docs)
[ ] LCP <2.5s on mobile
[ ] recurring brand visuals from ui-brand package, not redrawn
[ ] code samples follow §10 treatment
```

---

## Gate 4 — Documentation

The bar for prose.

### 4.1 Existence

- ✅ For every shipped feature: API reference updated.
- ✅ For every shipped feature: at least one concept page or guide
  references it.
- ✅ For every shipped feature: a release note exists per
  `docs/RELEASE_NOTES_TEMPLATE.md`.
- ✅ For breaking changes: a migration guide exists.
- ✅ For internal-only changes that affect contributors: an entry in
  `docs/SESSION_HANDOFF.md`.

### 4.2 Accuracy

- ✅ Numbers cited to source. Every metric, latency claim, customer
  count, revenue figure links to a source of truth.
- ✅ Code samples are syntactically valid and run against the current
  API.
- ✅ The 10 denial reasons are quoted from the canonical source, not
  paraphrased.
- ✅ Algorithm names (Ed25519, EdDSA, etc.) are correct.
- ✅ Endpoint paths and HTTP methods are exact.

### 4.3 Voice and tone

- ✅ Voice matches `docs/design/00_BRAND_FOUNDATION.md` § 2 — precise,
  cryptographically grounded, builder-respectful.
- ✅ No paraphrase of technical specifics.
- ✅ No speculative claims as fact. Forward-looking statements are
  bracketed.
- ✅ No "industry-leading," "revolutionary," "best-in-class," "next-gen,"
  etc.

### 4.4 Linting

- ✅ markdownlint passes.
- ✅ Link-checker passes — no broken internal or external links.
- ✅ Code blocks have language tags.

### Gate 4 checklist

```
[ ] API reference updated (for shipped features)
[ ] release note exists
[ ] migration guide exists for breaking changes
[ ] every claim has a source link
[ ] code samples valid and tested against current API
[ ] technical specifics quoted, not paraphrased
[ ] no marketing-superlatives
[ ] markdownlint clean
[ ] link-checker clean
```

---

## Gate 5 — Compliance

The bar for changes that affect what AEGIS claims externally about
controls.

### 5.1 Claim auditability

- ✅ Every external compliance claim has a control mapping in
  `docs/COMPLIANCE.md` (or its successors).
- ✅ Every claim has an evidence pointer (the artifact a SOC2 auditor
  would inspect).
- ✅ Status (In place / In progress / Roadmap) is honest.

### 5.2 Change management

- ✅ Production change is tied to a ticket or claim. No untraceable
  prod change.
- ✅ The change has an audit-event trail (the change is itself audited
  separate from the runtime audit chain — this is the change-management
  trail).
- ✅ Author and Approver are different identities (segregation of
  duties).

### 5.3 Sub-processor and data

- ✅ New sub-processor: added to the list, customer-notification flow
  triggered if existing customer contracts require it.
- ✅ New PII or sensitive-data flow: documented in the data inventory,
  reviewed by Compliance before ship.
- ✅ Cross-region data transfer: documented per `docs/EU_RESIDENCY.md`.

### 5.4 Customer-facing legal claims

- ✅ Privacy policy and ToS reflect the change (Legal review).
- ✅ DPA reflects the change if it affects data processing.
- ✅ Customer notification triggered if the change affects a contractual
  commitment.

### Gate 5 checklist

```
[ ] every external claim has a control mapping
[ ] every claim has an evidence pointer
[ ] status is honest (In place / In progress / Roadmap)
[ ] production change is in change-management trail
[ ] segregation of duties: author ≠ approver
[ ] new sub-processor: list updated, customers notified if required
[ ] new PII flow: documented in data inventory
[ ] cross-region transfer: documented per EU_RESIDENCY.md
[ ] Privacy/ToS/DPA updated if affected
```

---

## Gate 6 — Narrative

The bar for any artifact intended to be read by a customer, investor,
board member, regulator, or future self in audit. The Narrative gate
is the IPO-bar discipline that every external piece of writing
inherits.

### 6.1 Sourcing

- ✅ Every number has a source link or an inline citation.
- ✅ Every claim about customer outcomes references a customer or
  is bracketed as illustrative.
- ✅ Every comparative claim ("faster than X," "more secure than Y")
  has a basis cited or is removed.
- ✅ Every claim about future capability is bracketed as forward-
  looking.

### 6.2 Tone

- ✅ Sober. Numbers over adjectives.
- ✅ Specific. "Verifies p99 in 71ms over the last 30 days, sourced
  from Datadog dashboard X" is the tone — not "lightning-fast."
- ✅ Defensible. If the artifact were read aloud in a deposition, would
  every sentence hold up? If not, rewrite.

### 6.3 Forward-looking discipline

- ✅ Forward-looking statements (predictions, roadmaps, projections)
  are explicitly labeled. Examples:
  - *"We project that BATE rule-based v1 will ship by Q3 2026 (subject
    to engineering capacity and customer feedback)."*
  - *"Pricing tiers may change as we learn from initial deployments."*
- ✅ Aggressive forward-looking statements are footnoted with the
  assumption set.
- ✅ No implied guarantees of customer outcomes.

### 6.4 Materiality

- ✅ For any artifact that will appear in the data room: the
  materiality framework in `05_PUBLIC_COMPANY_READINESS.md` § 4 is
  applied. Material facts are highlighted; trivial details are
  appendixed.

### 6.5 Versioning

- ✅ External artifacts (decks, customer presentations, board updates)
  are versioned and saved. The version a recipient has is
  reproducible six months later.
- ✅ Corrections to previously-shipped artifacts are published as
  corrections, not silent re-edits.

### Gate 6 checklist

```
[ ] every number has a source link or inline citation
[ ] customer-outcome claims tied to a customer or bracketed
[ ] comparative claims have a basis or are removed
[ ] forward-looking statements explicitly bracketed
[ ] sober tone — no marketing superlatives
[ ] artifact would survive deposition reading
[ ] material facts highlighted; trivia appendixed
[ ] versioned and saved if external
```

---

## How a Reviewer uses this file

For any PR or artifact:

1. **Identify which gates apply** — refer to the routing table.
2. **For each applicable gate, walk the checklist** and write the
   confirmation in PR comments. The Reviewer's comments are the audit
   trail, not just the green check.
3. **Block** if any gate fails. Do not approve with comments — comments
   are deferrals, blocks are decisions. Approving while flagging
   issues is the worst pattern; it puts the burden on the next
   reviewer to remember.
4. **Approve** only when every applicable gate has passed.

A complete PR review for a substantial code change might include
checklists for Gates 1, 2, 4, and 6 — that's expected. The volume of
checking is proportional to the volume of risk.

---

## Calibrating the gates

These gates are calibrated to AEGIS at the FAANG / public-company bar.
Some are deliberately stricter than industry norms. The strictness is
the point: AEGIS sells trust. The product makes a single substantive
claim — *"every agent action is verifiable"* — and that claim is only
defensible if the company shipping it operates with the same
discipline.

If a gate is found to be too strict (creates more friction than it
prevents bugs), the path to relax it is an ADR, not a workaround.

If a gate is found to be too loose (a bug shipped that the gate should
have caught), the path to tighten it is also an ADR, plus the postmortem
that surfaced it.

---

## Related documents

- `00_OPERATING_SYSTEM.md` — the master.
- `02_AGENT_ROLES.md` — Reviewer role brief.
- `03_TASK_LIFECYCLE.md` — when in the lifecycle each gate is checked.
- `05_PUBLIC_COMPANY_READINESS.md` — the IPO-bar discipline that
  Gate 5 and Gate 6 instantiate.
- `CLAUDE.md` § Quality bar — the architectural source for Gate 1.
- `docs/design/00_BRAND_FOUNDATION.md` — the source for Gate 3.
- `docs/SECURITY.md` — the source for Gate 2.
- `docs/COMPLIANCE.md` — the source for Gate 5.
