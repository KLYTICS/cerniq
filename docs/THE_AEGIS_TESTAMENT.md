# THE AEGIS TESTAMENT

> The operating doctrine of the AEGIS platform.
> Issued to the hundred engineers under whose hands AEGIS becomes the
> cryptographic substrate of the agent economy.
>
> _Codified: 2026-05-11 · Custodian: Erwin Kiess-Alfonso · Read this before
> you read anything else in this repository._

---

## FOREWORD — TO THE HUNDRED

You have been called because the world has built a generation of AI agents
without a way to prove who they are, what they were permitted to do, or what
they actually did. Every browser they touch, every API they call, every
dollar they move passes through systems that were never designed for
non-human actors. The result is a trillion-dollar attack surface dressed up
as a productivity revolution.

AEGIS is the answer. Not "an" answer — **the** answer that the agent economy
needs in order to ship without inviting fraud, regulatory rollback, and
public retreat. We are the neutral cryptographic checkpoint between every
agent and every service it acts on. We hold public keys only. We sign only
what we observed. We remain protocol-neutral, model-neutral, and
vendor-neutral. This neutrality is not a hedge — it is the moat.

This Testament is the contract under which you operate. It tells you the
laws that cannot be broken, the tribes you belong to, the prompts that you
issue to your sessions, the verses you cite when you make a decision, and
the road from where AEGIS sits today (production-grade primitives, first
paying customers in motion) to where it must arrive (the
infrastructure-of-record cited by NIST, embedded by Browserbase-class
platforms, mandated by acquirers).

Read every Book at least once. Re-read Book III — Leviticus — quarterly.
When in doubt, the verse wins.

---

# TABLE OF BOOKS

| Book | Title | Purpose |
| --- | --- | --- |
| I | **Genesis** | The mission, the wedge, the field of play |
| II | **Exodus** | From toy to infrastructure — the staged climb |
| III | **Leviticus** | The inviolable laws (do not violate; do not negotiate) |
| IV | **Numbers** | The hundred engineers — tribes, ratios, escalation chains |
| V | **Deuteronomy** | Engineering doctrine — code, review, verification, scope |
| VI | **Kings** | The surfaces and the kings who reign over them |
| VII | **Chronicles** | The session protocol — peers, claims, the handoff log |
| VIII | **Psalms** | Prompts — per tribe, per task, per agent, copy-ready |
| IX | **Proverbs** | Aphorisms for the moment of decision |
| X | **Joshua** | The campaign — territories to take, in order, with siege plans |
| XI | **Ezekiel** | The watchman — SLOs, observability, incident response |
| XII | **Isaiah** | The prophecy — milestones from $0 MRR to financial staple |
| XIII | **Revelations** | The end state — what "won" looks like |
| — | **Appendices** | Denial precedence, command index, file map, glossary |

---
---

# BOOK I — GENESIS

## Chapter 1 — In the beginning, there was no agent identity

**Gen 1:1** Every existing identity system was built for humans. OAuth proved
who you are. Auth0 proved who your employees are. Okta proved who your
contractors are. None of them proved who an AI agent is, what it was
permitted to do on behalf of which human, or whether it has behaved well
across sessions.

**Gen 1:2** Stripe and OpenAI shipped the Agentic Commerce Protocol (ACP) in
September 2025. ACP solved payment. It explicitly delegated identity to
implementers. That delegation is the seat AEGIS occupies.

**Gen 1:3** NIST opened the AI Agent Identity Initiative in February 2026.
Public comments closed in April 2026. The standards clock is now running.
By Q4 2027 there will be draft guidance. By Q4 2028 enterprise procurement
will cite NIST guidance as a checkbox. The window to be the reference
implementation before standards lock in is **eighteen months**.

**Gen 1:4** Auth0, Okta, Entro, Prefactor, Cloudflare Zero Trust — each is
tethered to a platform, a runtime, or an enterprise. AEGIS is the Switzerland
of agent identity. Tied to none, available to all.

## Chapter 2 — What AEGIS is, in one breath

**Gen 2:1** AEGIS is four layers stacked on one cryptographic spine.

> **Layer 1 — Identity Core.** Ed25519 keypair per agent, principal-bound. The
> private key never enters our system.
>
> **Layer 2 — Policy Engine.** Scoped, signed, revocable JWT policies with
> spend, time, domain, and category bounds.
>
> **Layer 3 — Behavioral Attestation Engine (BATE).** Trust score 0–1000
> built from observed signals. The credit score for agents.
>
> **Layer 4 — Audit & Compliance Rail.** Append-only, Ed25519-signed,
> hash-chained event log. Independently verifiable from a JWKS endpoint.

**Gen 2:2** AEGIS holds public keys only. AEGIS signs only what it observed.
AEGIS remains protocol-, vendor-, and model-neutral. These three sentences
are the entire product positioning. Memorize them.

## Chapter 3 — The wedge

**Gen 3:1** The wedge is the **tool-call checkpoint**. Every MCP server is a
potential AEGIS relying party. Every ACP merchant is a potential AEGIS
relying party. Every Browserbase-class agent platform that ships its users'
agents into the open web is a potential AEGIS relying party. We do not have
to convince the world we are useful. We have to be in the install path when
the world reaches for the missing piece.

**Gen 3:2** Three lines of code in an MCP server, four lines in an ACP
handler. That is the entire integration cost on the relying-party side.
That is why the wedge holds.

**Gen 3:3** The bilateral network effect: every relying party that installs
the AEGIS bridge becomes a distribution channel for AEGIS tokens. Every
agent developer who needs to be accepted by that relying party becomes an
AEGIS customer. We win when the world begins to assume an agent without an
AEGIS token is suspicious by default.

## Chapter 4 — The field of play

**Gen 4:1** The relying parties we serve cluster into seven verticals.
Memorize them; they are the territory map of Book X — Joshua.

> **(i) Agent platforms.** Browserbase, Anchor, Multi-on, custom browser
> agent infra. They ship agents into the open web and need to vouch that
> their fleet is not abusive.
>
> **(ii) Commerce relying parties.** Airlines, marketplaces, payment APIs
> that already speak ACP and need an identity gate above payment.
>
> **(iii) Banking and treasury.** ISO 20022 rails, treasury platforms,
> per-payment-rail trust scoring.
>
> **(iv) Regulated AI in financial services.** Cooperativas, broker-dealers,
> FINRA-supervised firms, COSSEC-supervised institutions.
>
> **(v) Healthcare and clinical workflow agents.** HIPAA-regulated paths
> where audit chain integrity is the entire compliance story.
>
> **(vi) Developer infrastructure.** MCP servers, LangChain and CrewAI
> integrations, AutoGen orchestrators.
>
> **(vii) Enterprise IAM extension.** Companies whose Okta tenants have no
> answer for non-human identity and will not buy from Okta out of vendor
> fatigue.

**Gen 4:2** Each vertical has its own example folder in `examples/` and its
own integration guide in `docs/INTEGRATION_GUIDE_*.md`. When you build for a
vertical, read both before you write a line of code.

## Chapter 5 — Our covenant with the operator

**Gen 5:1** The custodian of AEGIS is Erwin Kiess-Alfonso. The hundred
engineers act under the covenant of the operator. The covenant has four
clauses.

> **(i)** We will not invent data. Trust scores, audit events, denial
> reasons, billing usage, signal counts — every number must trace to a
> source. Silence is preferable to fabrication.
>
> **(ii)** We will not weaken the cryptographic posture for convenience. If
> a feature requires shedding signature verification, replay defense, or
> tenant isolation, we ship the feature later.
>
> **(iii)** We will keep the verify hot path portable. A NestJS dependency
> in `verify.algorithm.ts` is a covenant breach. The Cloudflare Worker port
> is non-negotiable.
>
> **(iv)** We will leave a handoff. Every meaningful session appends a
> newest-first entry to `docs/SESSION_HANDOFF.md`. The next engineer must be
> able to pick up cold.

---
---

# BOOK II — EXODUS

> _From toy to infrastructure._

## Chapter 1 — The four ages of AEGIS

**Exo 1:1** AEGIS passes through four ages on the road to staple status.
Each age has a gate the platform must cross before the next begins.

| Age | Name | Gate | Surface posture |
| --- | --- | --- | --- |
| 0 | **Spec** | Documents only | All laws, no code; written-only validation |
| 1 | **MVP** | First 10–11 paying users → $500 MRR | Origin verify, audit, billing, dashboards live |
| 2 | **BATE & Bridges** | $5K MRR | BATE engine live, MCP/ACP bridges shipped, Python SDK GA |
| 3 | **Edge & Enterprise** | $50K MRR / first SOC 2 | CF Workers verify, on-prem BATE option, SOC 2 Type I |
| 4 | **Standard** | Cited in NIST / Visa / Stripe docs | AEGIS becomes assumed infrastructure |

**Exo 1:2** Age 1 (MVP) is substantially shipped. Age 2 is the current
front, gated on the BATE operator decisions (OD-001, OD-002) and the
MCP-bridge distribution play.

## Chapter 2 — From toy to infrastructure: the four shifts

**Exo 2:1** A "toy" runs in a notebook. "Infrastructure" survives an
auditor, a regulator, an outage, and a competitor. The journey is four
shifts; each is non-negotiable.

> **Shift I — From _it works_ to _it is observable_.** Every decision is
> measurable. Every failure has a metric. Every error has a runbook.
>
> **Shift II — From _it works for me_ to _it works under your auditor's
> microscope_.** The audit chain is independently verifiable from a public
> JWKS endpoint without calling AEGIS. SOC 2 Type II evidence is a
> by-product, not a build.
>
> **Shift III — From _flag-flippable_ to _contractually stable_.** The
> public denial precedence is part of the wire contract. Adding a denial
> reason is a versioned change with parity tests, OpenAPI drift checks,
> SDK updates, and dashboard mapping, all landing in one PR.
>
> **Shift IV — From _custom integration_ to _plug-and-play_.** Three lines
> of code in an MCP server. Four lines in an ACP handler. Drop-in
> Express/Fastify/Hono adapters in `@aegis/verifier-rp`. A `npx
> @aegis/cli quickstart` command that takes a developer to their first
> green verify in ten minutes.

## Chapter 3 — Plug-and-play means three integration shapes

**Exo 3:1** Plug-and-play is not a slogan. It is three shapes, and every
relying-party integration must be one of them.

> **Shape A — `wrap(mcpServer)`.** Three lines around an existing MCP
> server. Located in `packages/mcp-bridge`. The MCP server developer
> changes nothing else.
>
> **Shape B — `verify(token, ctx)`.** Drop-in offline verifier in
> `packages/verifier-rp`. Edge-runtime-safe, framework adapters provided.
> The relying-party developer adds a middleware and a call.
>
> **Shape C — Dual-token co-existence.** ACP/SPT + AEGIS token presented
> together. Worked example in `examples/acp-bridge`. The merchant runs both
> checks side by side and rejects the request if either fails.

**Exo 3:2** A new vertical does not justify a new shape. If the integration
cannot be expressed as one of the three shapes, the design is wrong. Bring
it to the operator before writing code.

## Chapter 4 — Supreme user control

**Exo 4:1** "Supreme user-managed" means the operator (or any AEGIS
principal) can perform every state-changing action from the dashboard, the
CLI, or the API without contacting support. Every state-changing action.

**Exo 4:2** This is the operator inventory the platform owes its users.

> **Identity.** Register, list, revoke, rotate keys, view BATE history,
> export agent state.
>
> **Policy.** Create, list, revoke, snapshot, restore, export. Audit-stamp
> on every transition.
>
> **Billing.** Plan view, upgrade, downgrade, cancel, view trial counter,
> view usage, request invoice. All from `/billing` with no human handoff.
>
> **Webhooks.** Create, edit, delete, secret rotation, delivery log,
> replay, force DLQ inspection, signature verification helper.
>
> **Audit.** Read, paginate, NDJSON export by date range, redact by event
> ID, redact by agent ID, export Merkle-root anchored corpus, verify
> offline with `aegis-audit-verify`.
>
> **Compliance.** GDPR Article 17 redact (DPA-compatible), retention
> horizon visibility, SOC 2 evidence bundle download.
>
> **Operator.** API key issuance (full vs verify-only), team management,
> SSO config, IdP swap (Auth0 / Clerk / WorkOS / Entra / Okta SAML).

**Exo 4:3** If a dashboard route does not exist for an action, the action
does not count as user-managed. File it as an `OPERATOR-INPUT-NEEDED`
backlog or build the route. Do not ship "you have to email us" as the
self-service path.

## Chapter 5 — Technical AND usable

**Exo 5:1** AEGIS is a security product whose customers are developers.
"Technical AND usable" means we earn both audiences in the same surface:
the engineer reading our docs and the operator clicking our dashboard.

> **For the engineer.** Public APIs are spec-driven (`docs/spec/AEGIS_API_SPEC.yaml`),
> SDKs are typed end-to-end, error messages are catalog-typed (`AegisError`
> family), every public function carries a paired spec, every parity test
> is a wire-contract guarantee.
>
> **For the operator.** Bloomberg-density UI (compact, scannable, no card
> grids), explicit status, denial reasons translated into plain language,
> CTAs that map to billing/upgrade flows without trapping the user in
> dialogs.

**Exo 5:2** Both audiences refuse one thing in common: silent failure. The
engineer wants the failed assertion. The operator wants the red banner with
the diagnostic substring. Honor both by never papering over a problem.

---
---

# BOOK III — LEVITICUS

> _The inviolable laws. Violation requires an ADR before the change ships._

## Chapter 1 — The eight invariants

> Verbatim alignment with the root `CLAUDE.md` invariant list. These are
> the laws every tribe answers to without exception.

**Lev 1:1** Private keys never enter AEGIS. The SDK is the only surface
that ever touches an agent's private key.

**Lev 1:2** The verify hot path is portable. `verify.algorithm.ts` and the
crypto utilities under `apps/api/src/common/crypto/` contain zero imports
from `@nestjs/*`, `@prisma/client`, `bullmq`, or any Node-only API. The
Cloudflare Worker port at `workers/cf-verify/` imports these utilities
directly.

**Lev 1:3** Audit events are append-only and signed. The only write path is
`audit.service.append()`. There is no UPDATE, no DELETE. The Ed25519
signature chains over the prior signature so any tamper invalidates every
subsequent row.

**Lev 1:4** No silent failures and no fabricated data. Redis down → fail
closed to `ANOMALY_FLAGGED`. Postgres down on a cache miss → 503 with
`code: BACKEND_UNAVAILABLE`. Empty list never substitutes for an error.
Synthetic trust scores never substitute for a real one.

**Lev 1:5** Multi-tenant isolation is by `principalId` on every query,
mutation, cache key, queue payload, and webhook subscription. The API key
guard establishes the principal; every service method receives
`principalId` as its first argument; every Prisma `where` clause carries
it.

**Lev 1:6** Denial precedence is stable wire contract. The order is:

```
PLAN_LIMIT_EXCEEDED (billing pre-gate)
↓
AGENT_NOT_FOUND
↓
AGENT_REVOKED
↓
INVALID_SIGNATURE
↓
POLICY_REVOKED
↓
POLICY_EXPIRED
↓
SCOPE_NOT_GRANTED
↓
TRIAL_EXHAUSTED
↓
SPEND_LIMIT_EXCEEDED
↓
TRUST_SCORE_TOO_LOW
↓
ANOMALY_FLAGGED
```

Any change to this list — new reason, reorder, rename — requires an ADR
update, a parity test update (`tests/cross-package/denial-precedence-enum.spec.ts`),
an OpenAPI update, both SDK updates, and a dashboard mapping update — all
in one PR.

**Lev 1:7** Contracts are owned by `packages/types`. Zod schemas are the
single source of truth. OpenAPI, generated catalogs, SDK types, dashboard
fetch types, and parity tests reconcile **to** the types package, never
away from it.

**Lev 1:8** Public SDKs and verifier packages must stay runtime-portable.
No Node-only APIs in `@aegis/sdk`, `@aegis/verifier-rp`, or
`@aegis/audit-verifier`. `@noble/*` is the canonical crypto dependency
set for portable code. A package that ships to browsers, edge runtimes,
or relying-party services in foreign environments cannot import
`node:crypto`, `node:stream`, or any Node-specific surface.

## Chapter 2 — The four boundaries

**Lev 2:1** **The cryptographic boundary.** Code at this boundary requires
a paired `*.spec.ts` and a second-pair review (even from a peer Claude
session). Locations under `apps/api/src/common/crypto/`, `packages/audit-verifier/src/`,
`packages/verifier-rp/src/`, and the Ed25519 helpers in `packages/sdk-ts/`
and `packages/sdk-py/`.

**Lev 2:2** **The tenant boundary.** Every Prisma query against a model
that carries `principalId` must include it in the `where` clause. Cross-
principal queries (relying-party reports about an agent owned by a
different principal) are explicit, named, and audited.

**Lev 2:3** **The portability boundary.** Three rules. (a) `verify.algorithm.ts`
imports nothing from `@nestjs/*`. (b) `packages/verifier-rp` imports
nothing from `node:crypto` — `@noble/ed25519` is the only signature
primitive. (c) `packages/audit-verifier` imports nothing from
`@prisma/client` or any Node-only stream API.

**Lev 2:4** **The auditability boundary.** Every consequential action — a
verify, a denial, a policy revoke, a tenant deletion, an admin redact — is
audit-appended before the response leaves the service. Append failures use
the transactional outbox (ADR-0007) so the response can still ship but the
event cannot be lost.

## Chapter 3 — The covenant of typed errors

**Lev 3:1** No raw strings thrown from production code. The `AegisError`
catalog (`apps/api/src/common/errors/`) is the only valid throwable from
any service or controller path.

**Lev 3:2** Verify denials are not exceptions. A denial is a successful
verify call that returns `{ valid: false, denialReason: ... }` with HTTP
200. The only "error" that returns 200 from `/v1/verify` is `VerifyDenialError`.

**Lev 3:3** Customer-facing error messages must not leak internal stack
traces, provider names, or secret-shaped substrings. The error catalog is
your translation layer.

## Chapter 4 — The covenant of randomness

**Lev 4:1** No `Math.random()` in security, identity, billing, policy, or
audit paths. Use `crypto.randomUUID()`, `crypto.getRandomValues`, or
`@noble/hashes`-backed primitives. Tests with explicit seeds are the only
exception.

**Lev 4:2** All nonces, JWT `jti` values, audit event IDs, and webhook
delivery IDs are CSPRNG-sourced. Replay defense depends on this; weakness
here invalidates the threat model.

## Chapter 5 — The covenant of migrations

**Lev 5:1** Migrations are append-only after merge. Never edit a previously
applied migration unless the operator explicitly authorizes a pre-deploy
local repair.

**Lev 5:2** Schema changes are three-step: (a) additive migration ships
with the column nullable or the new table coexisting with the old; (b) app
deploy uses both behind a flag; (c) cleanup migration ships once the flag
is fully ramped.

**Lev 5:3** The audit-append-only trigger (`20260502000100_audit_append_only`)
is the only enforcement-by-trigger migration. Bypass requires the
schema-owner role per ADR-0006.

## Chapter 6 — The covenant of the `any`

**Lev 6:1** No `any` without an adjacent `// type-rationale:` comment
naming the specific reason. Untyped surfaces are a quiet attack vector
because reviewers stop reading.

**Lev 6:2** `noUncheckedIndexedAccess` is on. Honor it. An index access on
a record is `T | undefined` until you prove otherwise.

## Chapter 7 — The covenant of dependencies

**Lev 7:1** No new runtime dependency unless the task explicitly requires
it and the maintenance and supply-chain cost is justified in the PR
description. Each public package keeps its dependency set explicitly
documented and minimal: `@noble/*` only, where possible, for crypto.

**Lev 7:2** Crypto, billing, audit, and verify paths do not gain
dependencies casually. A peer code review must explicitly call out any new
dependency in those paths.

---
---

# BOOK IV — NUMBERS

> _The hundred engineers, divided into ten tribes of ten. Each tribe owns a
> surface, a metric, a covenant. Ratios drive escalation; an engineer who
> leaves their tribe must coordinate with the chief of that tribe._

## Chapter 1 — The ten tribes

**Num 1:1** Each tribe carries one banner. Every engineer joins one tribe
on day one and may rotate after a delivery cycle. Tribe identity prevents
the dilution of expertise that kills small platform teams.

| Tribe | Banner | Domain | North-star metric |
| --- | --- | --- | --- |
| I. **Praetorians** | Verify | `apps/api/src/modules/verify/`, `workers/cf-verify/` | p99 verify latency under SLO |
| II. **Archivists** | Audit & Compliance | `apps/api/src/modules/audit/`, `packages/audit-verifier/`, ADR-0006/0007/0015 | Chain integrity = 100% on third-party verify |
| III. **Scribes** | SDKs & CLI | `packages/sdk-ts/`, `packages/sdk-py/`, `packages/cli/`, `packages/mcp-bridge/`, `packages/mcp-server/` | Time-to-first-verify ≤ 10 min |
| IV. **Cartographers** | Dashboard & Operator UX | `apps/dashboard/` | First-week activation rate ≥ 40% |
| V. **Oracle** | BATE & Behavioral Attestation | `apps/api/src/modules/bate/`, `docs/BATE_ALGORITHM.md` | Band-flip rate ≤ 3/day per agent under normal use |
| VI. **Watchtower** | Observability & SRE | `infra/observability/`, alert + runbook pairs | Time-to-runbook ≤ 60s on any alert |
| VII. **Sentinels** | Security & Threat Modeling | `apps/api/src/common/crypto/`, `infra/kms/`, `docs/SECURITY.md`, `docs/THREAT_MODEL_v2.md`, post-quantum | Zero P0 advisories aged > 24h |
| VIII. **Heralds** | Documentation & Dev Relations | `docs/`, `apps/docs/` (planned), integration guides, partner kits | Time-to-AHA in tutorials ≤ 10 min |
| IX. **Exchequer** | Billing & Revenue Ops | `apps/api/src/modules/billing/`, `apps/dashboard/app/billing/`, Stripe webhooks | Free→paid conversion ≥ 8% of MAU |
| X. **Conquerors** | Integrations & Examples & Partnerships | `examples/`, partner SDKs, `docs/INTEGRATION_GUIDE_*.md`, MCP/ACP bridges | New relying-party logos per quarter |

**Num 1:2** Every tribe answers to the same constitution: Book III —
Leviticus. Tribe identity does not exempt an engineer from any invariant.

## Chapter 2 — Ratios within a tribe

**Num 2:1** A tribe of ten organizes into five "pairs" — two builders, one
reviewer, one verifier, one writer — rotating each cycle. Pairs are the
unit of accountability. The reviewer signs off on the architecture; the
verifier signs off on the tests, the runbooks, and the parity gates; the
writer signs off on the docs, the handoff entry, and the dashboard copy.

**Num 2:2** Every tribe carries one **chief** at any given time. The chief
is responsible for the tribe's metric, the tribe's claim discipline (Book
VII), and the tribe's escalation chain. Chief rotates each delivery cycle
unless the operator names a permanent chief.

## Chapter 3 — Cross-tribe ratios

**Num 3:1** Praetorians and Sentinels share crypto: changes to
`apps/api/src/common/crypto/` require sign-off from both tribes. Praetorians
own the integration; Sentinels own the primitive.

**Num 3:2** Archivists and Sentinels share key custody: the audit signing
key and the JWT signing key are jointly owned. Rotation, JWKS exposure,
and KMS plumbing are joint decisions.

**Num 3:3** Cartographers and Exchequer share the conversion loop:
`/pricing` → `/login` → `/billing` → AutoCheckout → continued verify is a
shared surface. Either tribe's change to that path requires the other
tribe's review.

**Num 3:4** Scribes and Conquerors share the integration shape: the SDK
surface determines what is plug-and-play; the examples surface determines
what is _seen_ as plug-and-play. Any new SDK method must ship with an
example.

**Num 3:5** Heralds shadow every tribe. A delivery that does not include a
docs change or an updated handoff entry is not delivered.

## Chapter 4 — Escalation chain

**Num 4:1** Engineer → pair reviewer → tribe chief → operator. The chain
flows up; never around.

**Num 4:2** Cross-tribe decisions ascend to the operator unless both chiefs
sign. Cross-cutting decisions — invariants, denial precedence, pricing —
ascend to the operator always.

**Num 4:3** When the operator is unreachable, the default rule fires after
the **due date** in `OPERATOR_DECISIONS.md`. Silence past the due date is
consent for the documented default. Engineers do not invent defaults.

---
---

# BOOK V — DEUTERONOMY

> _Engineering doctrine. The how. Lift these directly into your code
> review checklists, your branch policies, your CI gates._

## Chapter 1 — The smallest coherent change

**Deu 1:1** Prefer the smallest coherent change that proves the design.
Reviewers cannot reason about risk in 2,000-line PRs. Verifiers cannot
isolate regressions. Splitters are heroes.

**Deu 1:2** "Coherent" means: the change is one of (a) one feature, (b) one
fix, (c) one rename, (d) one refactor, (e) one doc reconciliation. Two of
the above in one PR is a smell. Three is a violation.

## Chapter 2 — Deletion is a feature

**Deu 2:1** Prefer deletion, reuse, and boundary repair over new layers.
The repository is mature; its problems are rarely solved by more code.

**Deu 2:2** A new file is a tax on every future reader. Pay the tax only
when an existing file would lose cohesion if extended.

## Chapter 3 — The verification ladder

**Deu 3:1** Run the narrowest verification that proves the change. Then
broaden as the blast radius justifies.

| Step | Command | When |
| --- | --- | --- |
| 1 | `pnpm --filter @aegis/<package> typecheck` | Always, before commit |
| 2 | `pnpm --filter @aegis/<package> test` | Always, before commit |
| 3 | `pnpm test:parity` | Any change that touches a wire contract or generated catalog |
| 4 | `pnpm check:openapi-zod` | OpenAPI or Zod schema changes |
| 5 | `pnpm check:openapi-prisma` | OpenAPI or Prisma schema changes |
| 6 | `pnpm check:migrations` | Prisma migration changes |
| 7 | `pnpm test:e2e` | Behavior changes that span surfaces |
| 8 | `pnpm check` | Cross-cutting / pre-merge |
| 9 | `pnpm doctor:full` | Pre-release / suspected env drift |

**Deu 3:2** A green narrow test does not absolve a broken broad test. If
you skip the broad test in development, you ship the broken broad test in
CI; the broken broad test blocks every peer.

## Chapter 4 — Code review canon

**Deu 4:1** Every PR description carries these sections, in order: **Intent
(one line). Context (why now). What changed (file-by-file). Tests run.
Risks. Rollback.** If any section is empty, the PR is not ready for review.

**Deu 4:2** Every reviewer looks for these in this order: (a) invariant
violations, (b) silent failure modes, (c) missing audit appends on
state-changing paths, (d) tenant isolation gaps, (e) type rationale on any
`any`, (f) test parity coverage, (g) documentation drift, (h) commit
message conformance.

**Deu 4:3** Reviewers approve "with nits" only when the nits are cosmetic.
A nit that requires a re-think is a request for changes.

## Chapter 5 — The commit standard

**Deu 5:1** Commit messages follow the Lore protocol from `AGENTS.md`.

```
<intent line — present tense, ≤ 72 chars>

<narrative paragraph — why this change exists, what it doesn't do>

Constraint: <what bound the design>
Rejected: <what we considered and chose against, why>
Confidence: <high | medium | low + reason>
Scope-risk: <isolated | cross-cutting + radius>
Directive: <what the next engineer should do next, if anything>
Tested: <what ran green>
Not-tested: <what didn't run and why>
```

**Deu 5:2** A commit without `Tested:` is a commit that lies about its
state. A commit without `Not-tested:` lies by omission. Both are bad. The
covenant is honesty about what is and is not proven.

## Chapter 6 — The scope discipline

**Deu 6:1** Stay inside the claimed paths. Cross-scope edits without a
peer coordination ping cost trust faster than any other behavior.

**Deu 6:2** If you must cross scope: (a) message the holder via
`claude-peers msg <sid>`; (b) wait for acknowledgment or claim release;
(c) record the cross in your handoff entry.

## Chapter 7 — The "what's intentionally absent" section

**Deu 7:1** Public packages and major modules carry a `README.md` section
named "What's intentionally absent." This section names the features the
package or module does not implement, and why. It is the cheapest way to
prevent reviewers and customers from filing tickets for things we chose
not to build.

## Chapter 8 — The handoff entry

**Deu 8:1** A meaningful session ends with an append to
`docs/SESSION_HANDOFF.md` at the top of the file, in the format used by
the existing log. Sections: status; coordination context; what shipped;
verification (the exact commands and their results); what this unlocks;
next session candidates; remaining risks.

**Deu 8:2** A handoff entry must be specific enough for a fresh Claude
session to pick up cold. File paths, command names, test counts, and a
one-sentence rationale on the choice you made when the choice was hard.

---
---

# BOOK VI — KINGS

> _The surfaces of AEGIS and their kings (architectural owners). When a
> question arises about a surface, the king's word is final until the
> operator intervenes._

## Chapter 1 — The API control plane (`apps/api/`)

**Kgs 1:1** **King: tribe Praetorians (verify), tribe Archivists (audit),
shared with tribe Sentinels (crypto).** This is the NestJS control plane.
It owns identity, policy, verify, audit, BATE, billing, webhooks,
well-known discovery, auth (API keys + Auth0/Clerk/WorkOS bridge), KMS
adapters, and observability surfaces.

**Kgs 1:2** The API is two services on one core. The **management surface**
serves identity, policy, audit retrieval, webhooks, billing, and the
dashboard backend. The **hot verify path** serves `/v1/verify`,
`/v1/agents/:id/status`, and `/v1/agents/:id/report`. Both surfaces share
Postgres and Redis but have distinct latency budgets and deployment
cadences. See `docs/ARCHITECTURE.md` § 1.

**Kgs 1:3** The hot verify path's algorithm is a **pure utility** —
`verify.algorithm.ts` — wrapped by a NestJS service. The pure utility is
the canonical home of the 12-step verify logic; the NestJS service is a
dependency-injection shell. Phase 3 lifts the pure utility into the
Cloudflare Worker without modification.

## Chapter 2 — The dashboard (`apps/dashboard/`)

**Kgs 2:1** **King: tribe Cartographers, shared with Exchequer on
`/billing` and `/pricing`.** Next.js 16, React 19, server components by
default. Operator and developer surface. Bloomberg-density UI.

**Kgs 2:2** First screen of every route is product UI, not a landing page.
No card grids. Compact tables, status strips, timelines, action panels,
explicit empty / partial / denied / failed states.

**Kgs 2:3** Pricing is SSR-fetched from `/.well-known/pricing.json` via
`AEGIS_API_BASE_URL`, with a build-time fallback that announces its
provenance to the DOM (`data-source="fallback"`). When the API endpoint is
unreachable in a given environment, the operator sees the fallback flag
without paging customer support.

**Kgs 2:4** Login redirect preservation uses `safe-redirect.ts` and
`buildLoginHref()`. The login round-trip preserves checkout intent so the
conversion loop survives the auth boundary.

## Chapter 3 — The SDKs (`packages/sdk-ts/`, `packages/sdk-py/`, `packages/cli/`)

**Kgs 3:1** **King: tribe Scribes.** Public packages. The TypeScript SDK
is browser- and edge-runtime-safe; no `node:crypto`. The Python SDK mirrors
the TS surface and ships with pydantic v2 models, strict mypy, and an
async-first client. The CLI is a single static Go binary cross-compiled
for darwin/linux/windows × amd64/arm64.

**Kgs 3:2** Wire contracts come from `@aegis/types`. SDK types reconcile
to the Zod schemas; the parity tests in `tests/cross-package/` are the
drift detectors.

**Kgs 3:3** Public SDK APIs are versioned. A breaking change requires a
major-version bump, a changelog entry, a deprecation cycle of at least one
minor version, and an SDK-migration guide in `docs/`.

## Chapter 4 — The relying-party verifier (`packages/verifier-rp/`)

**Kgs 4:1** **King: tribe Scribes, shared with Sentinels on crypto and
Archivists on the JWKS surface.** Drop-in offline verifier for relying
parties. Edge-runtime ready. Express, Fastify, Hono adapters.

**Kgs 4:2** The verifier never calls AEGIS in the hot path. It fetches the
JWKS at `/.well-known/jwks.json` with stale-while-revalidate for up to 24
hours, and hard-fails (returns `JWKS_UNAVAILABLE`) when the JWKS cannot be
refreshed and is older than 24h. Skipping signature verification is never
the fallback.

## Chapter 5 — The audit verifier (`packages/audit-verifier/`)

**Kgs 5:1** **King: tribe Archivists.** Offline verifier for the audit
chain. Powers the `aegis-audit-verify` CLI used by SIEM/GRC platforms,
auditors, and regulated customers.

**Kgs 5:2** The audit verifier is byte-parity locked against the API's
`AuditChainUtil` via `tests/cross-package/audit-chain-parity.spec.ts` and
`tests/cross-package/audit-manifest-parity.spec.ts`. Drift either way
fails publish.

## Chapter 6 — The MCP bridge and server (`packages/mcp-bridge/`, `packages/mcp-server/`)

**Kgs 6:1** **King: tribe Conquerors, shared with Scribes on SDK shape.**
`@aegis/mcp-bridge.wrap()` is the protocol-level wedge: three lines around
any MCP server, and every tool call it serves now requires an AEGIS token.

**Kgs 6:2** `@aegis/mcp-server` is the AEGIS MCP server itself —
exposing identity, policy, verify, and audit tools to Claude Desktop and
any MCP-compatible host. Tool schemas are precise; tool errors are typed.

## Chapter 7 — The edge worker (`workers/cf-verify/`)

**Kgs 7:1** **King: tribe Praetorians, shared with Sentinels.** Cloudflare
Worker port of the verify hot path. Phase 3 — released only when the
operator opens the phase gate.

**Kgs 7:2** The worker imports the same `verify.algorithm.ts` as the
NestJS service. The worker supplies its own `loadAgent`, `loadPolicy`,
`incrementSpend` adapters backed by Cloudflare D1 + KV. The parity test
locks the algorithm output between Worker and origin.

## Chapter 8 — The tests directory (`tests/`)

**Kgs 8:1** **King: tribe Watchtower, shared with every tribe that owns a
contract.** Cross-package parity, e2e, load, chaos. Tests are product
infrastructure — they protect the public contract, denial precedence,
billing behavior, audit verifiability, and the first-customer journey.

**Kgs 8:2** A parity test that does not fail for the intended reason is a
liar. Every new parity test ships with a proof: the test fails when the
parity is broken, the test passes when the parity is preserved.

## Chapter 9 — The infrastructure layer (`infra/`)

**Kgs 9:1** **King: tribe Watchtower, shared with Sentinels on KMS, Auth0,
and TLS.** Railway deployment, Cloudflare wiring, Postgres + Redis
configuration, observability, alert + runbook pairs, KMS plumbing for AWS,
GCP, and Vault.

**Kgs 9:2** Every alert in `infra/observability/alerts/` is paired with a
runbook in `infra/observability/runbooks/`. An alert without a runbook is
not enterprise-ready.

## Chapter 10 — The documentation surface (`docs/`)

**Kgs 10:1** **King: tribe Heralds, shared with every tribe whose surface
the doc describes.** Docs reflect code, never aspiration. When the spec
docs conflict with `SESSION_HANDOFF.md`, the handoff entry is fresher and
the spec doc must be reconciled in the same change.

---
---

# BOOK VII — CHRONICLES

> _The session protocol. How parallel Claude sessions coexist without
> stepping on each other's work. The chronicle is the record of who held
> what when, and what they shipped._

## Chapter 1 — Before any work: the 60-second checklist

**Chr 1:1** Every session begins with three commands. If you skip these,
you will overwrite a peer's in-flight work and waste both sessions.

```sh
# 1) Who else is in here right now?
~/.claude/peers/bin/claude-peers status

# 2) Where is the repo? What's dirty?
cd /Users/money/Desktop/AEGIS && git status --short --branch

# 3) What landed most recently? (newest at top)
head -120 docs/SESSION_HANDOFF.md
```

**Chr 1:2** Read `CLAUDE.md` (root). Read the scoped `CLAUDE.md` for the
surface you are about to touch. Read `WORK_BOARD.md` for any claim on
your target module. Read `OPERATOR_DECISIONS.md` for any open decision
that gates your work. Read `docs/AGENT_BRIEFING.md` if you are a new
session — it is the cold-pickup compression.

## Chapter 2 — The claim

**Chr 2:1** A claim is the advisory lock that tells peers what you are
editing. Claims do not actually lock files; they prevent simultaneous
edits by being read.

```sh
~/.claude/peers/bin/claude-peers claim aegis <scope-name> \
  --note "<one-line summary of what you will do>" --ttl 7200
```

**Chr 2:2** TTL defaults are: 2 hours for narrow scope, 4 hours for module
work, 8 hours for cross-cutting work. Heartbeat every 20–30 minutes:
`claude-peers heartbeat`. Release when done: `claude-peers release
aegis:<scope-name>`.

**Chr 2:3** If your work would cross another active claim, message that
session before you start:

```sh
~/.claude/peers/bin/claude-peers msg <peer-sid> \
  "I need to edit <file>; you have <claim>. OK to coordinate?"
```

## Chapter 3 — The handoff

**Chr 3:1** When you ship, append an entry to `docs/SESSION_HANDOFF.md` at
the top of the file. Format below; copy verbatim and fill in.

```
## YYYY-MM-DD (<headline of work>) — sid=<session-id> — claim=aegis:<scope>

**Status:** <Landed | Partially landed | Blocked on <reason>>

**Coordination:** <peers active, scope boundaries, anything coordinated>

### What shipped
- <file 1> — <one-line description>
- <file 2> — <one-line description>

### Verification — all green this session
- `<command>` → <result, with test counts>

### What this unlocks
1. <next-step that becomes possible because of this drop>

### Next session
1. <concrete next move>

### Remaining risks
- <risk + mitigation if applicable>
```

**Chr 3:2** Newest entries at the top, oldest at the bottom. Never rewrite
an entry; never delete an entry. If a previous entry was wrong, append a
correction with the same format.

## Chapter 4 — The conflict check

**Chr 4:1** Before commit, run `~/.claude/peers/bin/claude-peers
conflict-check`. This catches path overlap with peer claims and saves you
from a force-push fight.

**Chr 4:2** If the conflict check flags overlap, message the holder before
committing. If the holder's session has expired, document the overlap in
your handoff entry and proceed.

## Chapter 5 — Stale claims

**Chr 5:1** A claim whose heartbeat has not fired in 30 minutes and is
within 30 minutes of its TTL is stale. Stale claims may be assumed
abandoned for the purposes of coordination, but the prior work must be
preserved.

**Chr 5:2** Never revert a peer's work without an operator instruction or
a documented coordination ping. The chronicle is built on respect for
prior labor.

---
---

# BOOK VIII — PSALMS

> _Prompts. Per tribe, per task, per agent. Copy these into your session
> opening. They compress hundreds of pages of context into a self-contained
> brief that another Claude session can act on cold._

## Chapter 1 — The universal session opener

**Psm 1:1** Open every session with this template. Fill in the bracketed
fields.

```
You are operating inside the AEGIS repository at /Users/money/Desktop/AEGIS.

Constitution:
- Root contract: CLAUDE.md (read first; 5 min)
- Scoped contract for my surface: <apps/api|apps/dashboard|packages|workers|tests|infra|docs>/CLAUDE.md
- Latest state: head -120 docs/SESSION_HANDOFF.md
- Doctrine: docs/THE_AEGIS_TESTAMENT.md (read Book III — Leviticus and the chapter for my tribe)

Tribe: <Praetorians | Archivists | Scribes | Cartographers | Oracle | Watchtower | Sentinels | Heralds | Exchequer | Conquerors>
Task: <one-line description>
Claim: aegis:<scope-name>
TTL: <2h | 4h | 8h>

Invariants you must respect (Book III):
- Private keys never enter AEGIS
- Verify hot path is portable
- Audit is append-only and signed
- No silent failures, no fabricated data
- Multi-tenant isolation by principalId
- Denial precedence is fixed
- Wire contracts owned by packages/types

Output expectations:
- Smallest coherent change
- Paired specs for crypto
- Parity test for any new wire contract
- Handoff entry appended to docs/SESSION_HANDOFF.md
- Commit message in Lore format

Begin by running the 60-second checklist (Book VII Ch.1), then claim and proceed.
```

**Psm 1:2** A session that does not open with this template is operating
without ballast. The template is the floor, not the ceiling.

## Chapter 2 — The tribe prompts

### Tribe I — Praetorians (verify hot path)

**Psm 2:1**

```
You are a Praetorian engineer. You own the verify hot path. Your covenant
is portability and p99 latency.

Focus paths:
- apps/api/src/modules/verify/**
- apps/api/src/modules/verify/algorithm/verify.algorithm.ts (PURE — no nestjs/prisma/bullmq)
- apps/api/src/common/crypto/**
- workers/cf-verify/**

Inviolable rules for this session:
1. verify.algorithm.ts may not import @nestjs/*, @prisma/client, ioredis, or bullmq.
2. The 12-step verify chain follows the denial precedence in Book III Ch.1 Lev 1:6.
3. Spend counter increment is atomic (Redis INCRBY or Lua script).
4. p99 < 200ms warm-cache (Phase 1) / < 80ms (Phase 3).
5. Replay defense: jti → Redis SETNX with TTL.
6. On Redis spend-counter failure: fail closed with 503 SPEND_GUARD_UNAVAILABLE.
7. Every approved verify produces (a) AuditEvent row, (b) verifyTotal metric, (c) verifyLatency observation, (d) BATE signal enqueue, (e) webhook event if band crosses threshold.

Verification:
- pnpm --filter @aegis/api test -- modules/verify
- pnpm --filter @aegis/api test:e2e -- verify
- pnpm test:parity
- (Phase 3) wrangler dev for the CF Worker; check parity with origin via tests/cross-package/verify-algorithm-parity.spec.ts

Task: <fill in>
```

### Tribe II — Archivists (audit & compliance)

**Psm 2:2**

```
You are an Archivist. You own the audit chain, the retention story, the
GDPR Article 17 redact path, and the offline verifier package. Your covenant
is integrity and independent verifiability.

Focus paths:
- apps/api/src/modules/audit/**
- apps/api/src/common/crypto/audit-chain.util.ts
- apps/api/src/modules/compliance/**
- packages/audit-verifier/**

Inviolable rules for this session:
1. Audit events are append-only. No UPDATE/DELETE on AuditEvent.
2. Every append: canonicalize payload (RFC 8785), compute prev_hash = sha256(prev_sig || event_id), sign prev_hash || canonical_payload with Ed25519.
3. Redaction NULLs raw columns and writes an audit.redact meta-event; never breaks chain (ADR-0006).
4. JWKS at /.well-known/audit-signing-key is the third-party verification anchor.
5. audit-verifier package stays portable: @noble/* only, no node:crypto, no @prisma/client.
6. Manifest sealing per OD-017 (when decided) preserves dual-chain integrity (row chain + manifest chain).

Verification:
- pnpm --filter @aegis/api test -- modules/audit
- pnpm --filter @aegis/audit-verifier test
- pnpm test:parity (audit-chain-parity.spec.ts + audit-manifest-parity.spec.ts)
- aegis-audit-verify verify <ndjson-export> (sanity)

Task: <fill in>
```

### Tribe III — Scribes (SDKs & CLI)

**Psm 2:3**

```
You are a Scribe. You own the public SDK surface. Your covenant is
ergonomics, type safety, and runtime portability.

Focus paths:
- packages/sdk-ts/**, packages/sdk-py/**, packages/cli/**
- packages/mcp-bridge/**, packages/mcp-server/**
- packages/verifier-rp/**

Inviolable rules for this session:
1. Public SDK APIs are versioned contracts. Breaking changes require major bump + migration guide.
2. Wire types reconcile to packages/types (Zod schemas); parity test required.
3. sdk-ts is browser/edge-safe. No node:crypto. @noble/ed25519 only.
4. sdk-py mirrors sdk-ts surface. pydantic v2 models. Strict mypy.
5. SDKs never send private keys to AEGIS.
6. mcp-bridge.wrap() is three lines from the developer's perspective.
7. New SDK methods ship with an example in examples/.

Verification:
- pnpm --filter @aegis/<package> typecheck && test
- cd packages/sdk-py && python -m pytest
- pnpm test:parity (sdk-api-parity.spec.ts)
- npm pack && inspect tarball

Task: <fill in>
```

### Tribe IV — Cartographers (dashboard & operator UX)

**Psm 2:4**

```
You are a Cartographer. You own the operator-facing dashboard. Your
covenant is calm density and operational honesty.

Focus paths:
- apps/dashboard/**

Inviolable rules for this session:
1. Bloomberg-density UI. Tables, filters, status strips, timelines, action panels. No card grids.
2. Server components by default. Client components only for interaction, effects, optimistic UI, or browser APIs.
3. Dashboard data comes from @aegis/types, API discovery endpoints, or typed adapters. No hand-copied enums without a parity test.
4. Error states are honest: never render empty-success when the API failed.
5. Login redirects use safe-redirect.ts + buildLoginHref(); checkout intent survives the auth round-trip.
6. Pricing SSR-fetches /.well-known/pricing.json via AEGIS_API_BASE_URL with provenance footer.
7. Operator state-changing actions are 100% available without contacting support (Exo 4:1–4:3).

Verification:
- pnpm --filter @aegis/dashboard typecheck
- pnpm --filter @aegis/dashboard build (for broad UI/router changes)
- pnpm test:parity (dashboard-pricing-parity.spec.ts, dashboard-safe-redirect.spec.ts)
- Manual: run dev server, inspect routes, confirm denial reason translation table

Task: <fill in>
```

### Tribe V — Oracle (BATE & behavioral attestation)

**Psm 2:5**

```
You are an Oracle. You own the trust scoring engine. Your covenant is
defensible scoring without fabricated data.

Focus paths:
- apps/api/src/modules/bate/**
- docs/BATE_ALGORITHM.md

Inviolable rules for this session:
1. Score is clamped to [0, 1000] integer. Bands: PLATINUM ≥750, VERIFIED 500–749, WATCH 250–499, FLAGGED <250.
2. Signal weights live in apps/api/src/modules/bate/bate.weights.ts. Operator owns the values (OD-001 default until DECIDED).
3. Cold-start policy in bate.cold-start.ts. OD-002 default: 500 baseline, +150 KYC bonus → 650.
4. Score deltas have small jitter to make score-farming harder. Reproducibility at band level only.
5. Anomaly rules R-1..R-5 are pure functions emitting signals. ML v2 (Isolation Forest) is shadow scorer first.
6. Score change crossing a band emits aegis.agent.trust_score_changed webhook via M-008.
7. Never sell aggregate scores without explicit principal consent.

Verification:
- pnpm --filter @aegis/api test -- modules/bate
- pnpm test:parity (bate-signal-enum.spec.ts)
- 30-day mock signal simulation: no agent flips band >3×/day under normal use

Task: <fill in>
```

### Tribe VI — Watchtower (observability & SRE)

**Psm 2:6**

```
You are a Watchtower. You own the operational reality of AEGIS. Your
covenant is alert + runbook parity and incident readiness.

Focus paths:
- infra/observability/alerts/**, infra/observability/runbooks/**
- apps/api/src/common/observability/**
- docs/INCIDENT_RUNBOOK.md, docs/DR_RUNBOOK.md, docs/SLO.md

Inviolable rules for this session:
1. Every new alert ships with a paired runbook.
2. Every SLI is documented in docs/SLO.md with its budget and burn rate.
3. Logs redact x-aegis-api-key, x-aegis-verify-key, authorization, webhook secrets, private keys.
4. Tracing: OTLP exporter, 10% sample prod / 100% staging.
5. Incident communication per ARCHITECTURE.md §9: P1 notify in 4h, P2 in 24h, P3 next status post.
6. Status page at status.aegislabs.io reads incidents.{open,history}.json published by management API.

Verification:
- pnpm format:check
- Alert + runbook pairs spot-check
- pnpm doctor / pnpm doctor:full

Task: <fill in>
```

### Tribe VII — Sentinels (security & threat modeling)

**Psm 2:7**

```
You are a Sentinel. You own the cryptographic posture, the threat model,
the KMS plumbing, and the post-quantum roadmap. Your covenant is
zero-tolerance for sloppy primitives.

Focus paths:
- apps/api/src/common/crypto/**
- infra/kms/**
- docs/SECURITY.md, docs/THREAT_MODEL_v2.md, docs/POST_QUANTUM_ROADMAP.md

Inviolable rules for this session:
1. Ed25519 everywhere. @noble/ed25519 in browser/edge code. jose for JWTs.
2. Paired specs for every crypto utility. No exceptions.
3. AEGIS audit signing key and JWT signing key are joint-owned with Archivists.
4. Production keys live in KMS (AWS / GCP / Vault). .env is dev-only.
5. JWKS rotation supports current + previous keys at /.well-known/.
6. Cryptographic boundaries (Lev 2:1) require a second-pair review before merge.
7. PQ hybrid (ADR-0013) is scaffolded behind AEGIS_HYBRID_PQ_ENABLED; flip per OD-014 trigger criteria.

Verification:
- pnpm --filter @aegis/api test -- common/crypto
- pnpm test:parity (crypto-parity tests if any)
- Re-read docs/THREAT_MODEL_v2.md sections touched by the change

Task: <fill in>
```

### Tribe VIII — Heralds (documentation & dev relations)

**Psm 2:8**

```
You are a Herald. You own the documentation surface, the partner kits,
and the dev relations narrative. Your covenant is truthfulness and
time-to-AHA.

Focus paths:
- docs/**
- apps/docs/** (planned)
- examples/** (in coordination with Conquerors)
- docs/PARTNER_ONBOARDING.md, docs/INTEGRATION_GUIDE_*.md

Inviolable rules for this session:
1. Docs reflect code, not aspiration. Label planned/gated/not-yet-wired explicitly.
2. When docs conflict with SESSION_HANDOFF.md, the handoff entry is fresher; reconcile in the same change.
3. Tutorials and quickstarts target Time-to-AHA ≤ 10 minutes.
4. ADRs (docs/decisions/) record constraints + rejected alternatives, not just conclusions.
5. No secrets, customer data, internal credentials, or financial detail in docs.

Verification:
- pnpm format:check
- pnpm check:openapi-zod / check:openapi-prisma when wire docs change
- Tutorial walkthrough: time yourself; if >10 min, fix the tutorial

Task: <fill in>
```

### Tribe IX — Exchequer (billing & revenue ops)

**Psm 2:9**

```
You are an Exchequer. You own the money path. Your covenant is correct
billing under load and zero customer-blocking surprises in the verify hot
path.

Focus paths:
- apps/api/src/modules/billing/**
- apps/dashboard/app/billing/**, apps/dashboard/app/pricing/**

Inviolable rules for this session:
1. Stripe webhook handlers verify signatures before parsing business meaning.
2. Webhook idempotency: Redis SETNX on event id, 7-day window. Rollback the SETNX on handler throw so Stripe retries work.
3. Plan tier source of truth: apps/api/src/modules/billing/plans.ts. /.well-known/pricing.json mirrors plans.ts. Dashboard SSR-fetches the mirror.
4. PLAN_LIMIT_EXCEEDED is the billing pre-gate (Lev 1:6). It fires BEFORE the verify algorithm.
5. TRIAL_EXHAUSTED is a lifetime gate. Free trial = 10K verifies, no time limit (ADR-0014).
6. Overage metering to Stripe meters is non-blocking after the verify response. Visible operationally on failure; never blocks the customer.
7. Plan downgrade on payment failure follows the grace period in docs/decisions/0014.

Verification:
- pnpm --filter @aegis/api test -- modules/billing
- pnpm --filter @aegis/dashboard test (when dashboard runner is installed)
- pnpm test:parity (dashboard-pricing-parity.spec.ts, denial-precedence-enum.spec.ts)
- E2E customer journey: free verify → trial exhaustion → upgrade → continued verify → cancel → returning trial exhaustion

Task: <fill in>
```

### Tribe X — Conquerors (integrations & examples & partnerships)

**Psm 2:10**

```
You are a Conqueror. You own the territory map. Your covenant is plug-and-
play breadth without compromising the three integration shapes.

Focus paths:
- examples/**
- packages/mcp-bridge/**, packages/mcp-server/**
- docs/INTEGRATION_GUIDE_*.md
- docs/PARTNER_ONBOARDING.md, docs/AEGIS_AS_BACKBONE.md

Inviolable rules for this session:
1. Three shapes only (Exo 3:1): wrap(), verify(), dual-token. New shapes ascend to operator.
2. Every new example folder ships with a README, a test/smoke script, and an entry in docs/INTEGRATION_PATTERNS.md.
3. Partner integrations preserve neutrality: AEGIS plugs into Stripe/ACP, Visa, Cloudflare, Railway — never tied to any.
4. Vertical examples cover commerce, banking, AI platform, SaaS, reconciliation, ACP bridge — extend, don't duplicate.
5. Browserbase-class agent platforms get a dedicated integration guide; their developers should reach first verify in ≤ 10 min.

Verification:
- example smoke script green
- pnpm test:parity (integration shape regression)
- Walk the example from a fresh shell — confirm no hidden state assumptions

Task: <fill in>
```

## Chapter 3 — The per-task prompts

### Task: Add a new feature

**Psm 3:1**

```
Task: Add <feature> to <surface>.

Before code:
1. Run the 60-second checklist (Book VII Ch.1).
2. Find the owning module in Book VI — Kings.
3. Search WORK_BOARD.md for an existing claim or open module ID.
4. Identify any OPERATOR_DECISIONS.md row that gates this work. If gated and undecided past due date, the documented default fires (Num 4:3).
5. Read the scoped CLAUDE.md for the owning surface.
6. Read the relevant ADR(s) in docs/decisions/.

Implementation:
- Smallest coherent change.
- Preserve the eight invariants (Book III Ch.1).
- New wire contract → packages/types Zod schema + parity test in tests/cross-package/.
- New env var → apps/api/src/config/config.schema.ts + .env.example + docs.
- New crypto utility → paired *.spec.ts + Sentinel review.
- New audit-relevant action → audit append in same path.
- New denial reason → ADR + parity test + OpenAPI + both SDKs + dashboard mapping, all in one PR (Lev 1:6).

Verification:
- Narrowest: pnpm --filter @aegis/<package> typecheck && test
- Wire contract: pnpm test:parity, pnpm check:openapi-zod, pnpm check:openapi-prisma
- Behavior: pnpm test:e2e on the affected surface
- Cross-cutting: pnpm check

Output:
- Code change.
- Tests.
- Docs (if customer-visible).
- Handoff entry appended to docs/SESSION_HANDOFF.md (Book VII Ch.3).
- Commit message in Lore format (Deu 5:1).
```

### Task: Fix a bug

**Psm 3:2**

```
Task: Fix <bug>.

Triage:
1. Reproduce locally. If you cannot reproduce, do not write a fix.
2. If the bug is an invariant violation (Book III Ch.1), it is a SEV-1/SEV-2.
   Follow docs/INCIDENT_RUNBOOK.md before opening a fix PR.
3. Identify the regression: which test should have caught this?

Implementation:
- Write the regression test first. It must fail against current main.
- Fix the bug.
- Re-run: regression test passes, all narrow tests pass, all parity tests pass.

Output:
- Regression test in the correct location (tests/cross-package/ for cross-surface,
  module-local *.spec.ts otherwise).
- Fix.
- Handoff entry.
- Commit message: intent line names the SEV level and the root cause in 6 words or fewer.
```

### Task: Ship a public package

**Psm 3:3**

```
Task: Ship version <x.y.z> of <package>.

Before publish:
1. Confirm parity tests green: pnpm test:parity.
2. Confirm package typecheck + test green: pnpm --filter @aegis/<package> typecheck && test.
3. Confirm changelog entry exists.
4. Confirm "What's intentionally absent" section in README is current (Deu 7:1).
5. Confirm SDK migration guide exists for any breaking change.

Publish:
- changeset publish (pnpm workflow) for npm packages.
- pip publish (twine) for sdk-py.
- goreleaser for cli.

Output:
- Tag.
- Changelog.
- Handoff entry citing the version + a one-line behavior change summary.
```

### Task: Run an incident

**Psm 3:4**

```
Task: Run incident <severity> on <surface>.

First five minutes:
1. Page the operator via the chain (Num 4:1).
2. Open docs/INCIDENT_RUNBOOK.md.
3. Open the alert's paired runbook in infra/observability/runbooks/.
4. Confirm SEV level by symptom + impact.
5. Open incident channel; pin the timeline.

During incident:
- Document timestamps for: alert fired, SEV declared, mitigation started, mitigation effective, all-clear.
- Do not edit production code without operator sign-off.
- Rollback paths: Railway management plane → railway rollback <id>. CF Workers → wrangler deployments rollback.
- For verify-edge-only mode (Phase 3 DR), see docs/DR_RUNBOOK.md § "Verify-edge-only mode".

After incident:
- Post-mortem in docs/incidents/YYYY-MM-DD-<slug>.md.
- New runbook or runbook update if applicable.
- Regression test or alert tightening.
- Webhook aegis.incident.declared / .resolved emitted to subscribers (P1 within 4h).
- Status page updated.
```

### Task: Review a PR

**Psm 3:5**

```
Task: Review PR <#N> on <branch>.

Scan in this order:
1. Invariant violations (Book III Ch.1). Any of the seven → request changes.
2. Silent failure modes. Search for empty arrays, swallowed catches, fallback-to-default without operator visibility.
3. Missing audit appends on state-changing paths.
4. Tenant isolation gaps (where: { principalId } missing on a Prisma call).
5. Type rationale on every any.
6. Parity tests on any new wire contract.
7. Docs drift.
8. Commit message Lore format.

Approve "with nits" only when nits are cosmetic. A nit that requires re-think is request-changes.

Output:
- Review comments, anchored to file:line.
- Approval or request-changes.
- One-line summary in the PR thread.
```

### Task: Onboard a new engineer or session

**Psm 3:6**

```
Task: Onboard <engineer name | session sid>.

Reading order (in 90 minutes):
1. Root CLAUDE.md
2. docs/AGENT_BRIEFING.md
3. docs/THE_AEGIS_TESTAMENT.md — Books I, II, III, IV, VII
4. Scoped CLAUDE.md for their tribe's surface
5. docs/SERVICE_MAP.md
6. docs/ARCHITECTURE.md sections 1, 2, 6, 9, 10
7. docs/SECURITY.md
8. The last 60 days of docs/SESSION_HANDOFF.md
9. WORK_BOARD.md
10. OPERATOR_DECISIONS.md

First-task selection:
- Open module in their tribe with status "open" or "extension open".
- Pair with a senior in the same tribe for the first delivery cycle.
- First commit must be in Lore format and produce a handoff entry.
```

## Chapter 4 — The per-agent prompts (for Claude sessions)

**Psm 4:1** This Testament is also a script for the Claude sessions that
operate on AEGIS. The hundred engineers are humans; the parallel sessions
they spawn are Claude. Both follow the same Testament. The per-agent
prompts below are templates a human engineer pastes into a fresh Claude
session.

### Agent template: "Survey before I act"

**Psm 4:2**

```
You are a Claude session operating inside the AEGIS repo at
/Users/money/Desktop/AEGIS.

Before writing any code or editing any file, do the following and report
findings:

1. git status --short --branch
2. head -120 docs/SESSION_HANDOFF.md
3. claude-peers status
4. Read CLAUDE.md (root)
5. Read the scoped CLAUDE.md for the surface in <surface>
6. Search WORK_BOARD.md for any open module that matches <intent>
7. Search OPERATOR_DECISIONS.md for any open decision that gates <intent>

Report: dirty files, recent landings, active peer claims, the owning
scoped CLAUDE.md, candidate modules, gating decisions. Do not edit
anything yet. Wait for my acknowledgment.
```

### Agent template: "Implement a small change"

**Psm 4:3**

```
Implement <one-sentence change> in <file or module>.

Constraints:
- Smallest coherent change (Deu 1:1).
- Preserve all eight invariants (Book III Ch.1).
- If any invariant would be violated, stop and write an ADR draft instead.

Tests:
- Write the regression test first if this is a fix.
- Add parity test if this touches a wire contract.

Verification (run before reporting done):
- pnpm --filter @aegis/<package> typecheck
- pnpm --filter @aegis/<package> test
- pnpm test:parity (if applicable)

Output:
- Diff summary file-by-file.
- Verification results, verbatim.
- A handoff entry draft for docs/SESSION_HANDOFF.md.
```

### Agent template: "Audit a peer's in-flight work"

**Psm 4:4**

```
You are auditing a peer Claude session's recent drop.

Your job is to confirm the eight invariants hold after their drop, the
relevant parity tests are green, and there is no silent regression. You
do not edit files; you read and report.

1. git diff <since-ref> -- <peer's scope paths>
2. Re-read CLAUDE.md and the scoped CLAUDE.md for that surface.
3. Walk the diff: invariant violations, silent failures, missing audit appends,
   tenant gaps, type rationales, parity coverage, doc drift, commit format.
4. Re-run the peer's verification suite verbatim.
5. Report findings as P0/P1/P2/nit, with file:line anchors.
6. If P0/P1 exist, propose a remediation plan; do not implement.
```

### Agent template: "Author an ADR"

**Psm 4:5**

```
Author docs/decisions/00NN-<slug>.md using the template at
docs/decisions/0000-template.md.

Sections (in order):
1. Status: Proposed | Accepted | Superseded | Rejected
2. Context: what is the question, what changed to force it
3. Decision: the answer in one paragraph
4. Constraints: what bound the choice (latency, audit, tenancy, etc.)
5. Rejected alternatives: each with one-line "why not"
6. Consequences: positive and negative
7. Implementation map: files that change, modules touched, parity tests, migration steps
8. Cross-references: related ADRs, runbooks, spec sections

Then update:
- OPERATOR_DECISIONS.md if this resolves an open OD row.
- The relevant scoped CLAUDE.md if the decision narrows scope.
- docs/SESSION_HANDOFF.md with the ADR landing entry.
```

---
---

# BOOK IX — PROVERBS

> _Short. Memorable. Citable in a code review with one line._

**Pro 1** The audit chain remembers what the engineer forgets.

**Pro 2** Silence is worse than failure; both are worse than a typed error.

**Pro 3** A `Math.random()` in a production crypto path is a resignation letter.

**Pro 4** The narrowest test you can write that proves the change is the
test that survives the refactor.

**Pro 5** If your PR is large enough to need a table of contents, split it.

**Pro 6** Three lines of customer code is the integration tax we charge.
Charge any more and we lose the wedge.

**Pro 7** When the OpenAPI, the Zod schema, the SDK, the dashboard, and
the doc disagree, the parity test was missing.

**Pro 8** Public packages survive their authors. Build them like you will
hand the repo to a stranger tomorrow.

**Pro 9** The dashboard is product, not marketing. Build for the operator
at hour eight of an incident, not the visitor at minute one of a tour.

**Pro 10** If you cannot reproduce the bug, do not write the fix.

**Pro 11** Empty arrays are not zero results. Empty arrays are an error
the API failed to type.

**Pro 12** Every alert has a runbook or it is not an alert; it is a pager.

**Pro 13** A migration that edits a previously applied migration is a
production incident waiting to happen.

**Pro 14** The first screen of every dashboard route is product UI. There
are no landing pages on the inside of the product.

**Pro 15** The relying party's denial-reason message is the only thing
their support team will read; make it translate cleanly.

**Pro 16** A new dependency in a crypto path requires a paragraph in the
PR description. A new dependency in the verify path requires an ADR.

**Pro 17** The handoff entry you skip is the cost the next engineer pays
in hours.

**Pro 18** Tenant isolation is not a feature; it is an air supply.

**Pro 19** The denial precedence is the wire contract. Reorder it and a
relying party's retry logic breaks in production.

**Pro 20** The shortest path from toy to staple is the one that survives
an auditor without a single fabricated number.

---
---

# BOOK X — JOSHUA

> _The campaign. The territories we take, in order, with siege plans.
> Every territory is a vertical of relying parties. Every siege plan is a
> set of examples, integrations, and partner motions._

## Chapter 1 — Order of conquest

**Jos 1:1** We do not invade everywhere at once. The order matters.

| # | Territory | Why first / next / later | Siege artifact |
| --- | --- | --- | --- |
| 1 | **Agent platforms (Browserbase-class)** | Highest tool-call density; their developers reach for AEGIS first when the agent gets blocked | `examples/ai-platform-tool-call/`, `packages/mcp-bridge/`, integration guide for browser agent infra |
| 2 | **MCP server ecosystem** | Protocol-level wedge; bilateral network effect once installed | `packages/mcp-bridge/` wrap pattern; `packages/mcp-server/` AEGIS tools |
| 3 | **ACP merchants** | Co-sell with Stripe ACP; identity is the leg they left to implementers | `examples/acp-bridge/`, `docs/INTEGRATION_GUIDE_FINTECH.md` |
| 4 | **LangChain / AutoGen / CrewAI users** | Python SDK lands them; tutorials reach them | `packages/sdk-py/`, `docs/INTEGRATION_GUIDE_LANGCHAIN.md`, integration recipes |
| 5 | **Banking / treasury rails** | High-value per verify; per-rail trust scoring | `examples/banking-rails/`, ISO 20022 example |
| 6 | **SaaS seat provisioning (SCIM-flavored)** | Cleanest greenfield; smallest blast radius | `examples/saas-seat-provisioning/` |
| 7 | **Regulated AI in financial services** | Cooperativas (CERNIQ bridge), broker-dealers, FINRA shops | `docs/COMPLIANCE_BUNDLE.md`, COSSEC module |
| 8 | **Healthcare clinical workflow agents** | Audit chain is the entire compliance story | Healthcare example folder (post-Phase 2) |
| 9 | **Enterprise IAM extension** | Companies whose Okta tenants have no NHI story | On-prem BATE option, FedRAMP roadmap |
| 10 | **Government & defense** | Comes last; arrives via NIST citation and PQ hybrid | Post-quantum hybrid behind AEGIS_HYBRID_PQ_ENABLED |

**Jos 1:2** Conquer territory N+1 only when territory N has at least one
named relying party shipping in production, one integration guide green,
and one parity test locking the example surface.

## Chapter 2 — The Browserbase-class siege plan

**Jos 2:1** Browserbase and its kind ship browser-running agents into the
open web. Their problem is exactly the one AEGIS solves: their users'
agents look like bots to every site, and Browserbase has no way to vouch
for them.

**Jos 2:2** The siege artifacts:

> **(a) `wrap()` integration around the agent dispatcher.** Three lines.
> Every tool call carries an AEGIS token.
>
> **(b) Per-tenant trust score visibility.** Browserbase users see their
> agent fleet's aggregate BATE score; relying parties see per-agent score.
>
> **(c) Audit chain export for their compliance team.** NDJSON, signed
> manifest, third-party verifiable.
>
> **(d) A reference integration guide.** Written by Heralds, reviewed by
> a Browserbase engineer before publication. Lives at
> `docs/INTEGRATION_GUIDE_BROWSER_AGENT.md` (to be created — Conquerors
> own this).
>
> **(e) A co-marketing motion.** "Browserbase agents, verified by AEGIS"
> on both sites. The wedge holds because every Browserbase user that hits
> a relying party demanding AEGIS tokens is upgraded automatically.

**Jos 2:3** Success metric: by the end of Age 2, at least one named
agent-platform partner shipping with AEGIS in their default install path.

## Chapter 3 — The ACP merchant siege plan

**Jos 3:1** Stripe ACP is a tailwind. The merchant has already integrated
ACP; their problem is fraudulent agent transactions slipping through.

**Jos 3:2** The pitch:

```
Add aegis.verify(token) before your ACP handler.
FLAGGED-band agents get rejected.
VERIFIED agents get approved.
Every decision is auditable.
```

**Jos 3:3** Siege artifact: `examples/acp-bridge/`. Four lines of merchant
code, single PR-sized integration. Heralds-authored guide;
Conquerors-owned distribution.

## Chapter 4 — The MCP server siege plan

**Jos 4:1** The MCP ecosystem is the protocol-level wedge. Every MCP
server developer who installs `@aegis/mcp-bridge` becomes a relying party.
Their users' agents need AEGIS tokens to call their tools.

**Jos 4:2** Siege metric: at 1,000 MCP servers installed with the bridge,
adoption is self-sustaining. Distribution: Heralds via tutorials, dev
relations via MCP community forums, Conquerors via partner asks.

## Chapter 5 — The CERNIQ / cooperativa bridge

**Jos 5:1** CERNIQ pipelines AEGIS into 91 Puerto Rico cooperativas via
COSSEC compliance. Each cooperativa runs AEGIS-verified agents for FRTB
checks, loan portfolio queries, member service. Bridge play documented in
`docs/AEGIS_AS_BACKBONE.md`.

**Jos 5:2** Revenue arithmetic: at 15 cooperativas adopting CERNIQ +
AEGIS, $5,550/month × 15 = $83,250 MRR from this segment alone.

---
---

# BOOK XI — EZEKIEL

> _The watchman. The platform's eyes. Without observability, AEGIS is a
> security product the operator cannot defend._

## Chapter 1 — The SLOs we publish

**Eze 1:1** The published SLOs are in `docs/SLO.md`. Memorize the key
ones; never let them slip without an incident review.

| Surface | SLI | SLO (Phase 1) | SLO (Phase 3) |
| --- | --- | --- | --- |
| `/v1/verify` | p99 latency | < 200 ms | < 80 ms |
| `/v1/verify` | Availability | 99.5% monthly | 99.95% monthly |
| Management API | p95 latency | < 500 ms | < 500 ms |
| Audit append | Loss rate | 0 events | 0 events |
| Webhook delivery | < 8 attempts | 99% delivered | 99.9% delivered |
| BATE score recompute | Lag p95 | < 60 s | < 30 s |
| JWKS endpoint | Availability | 99.99% | 99.99% |

**Eze 1:2** Audit append loss rate is zero. There is no error budget for
losing audit events. The transactional outbox (ADR-0007) makes this
achievable.

## Chapter 2 — The key SLIs

**Eze 2:1** The metrics that must always be on a dashboard:

- `verify_latency_seconds{decision}` — histogram, p50/p95/p99
- `verify_total{denial_reason}` — counter, per-reason rate
- `aegis_cache_set_failed_total` — counter, the round-4 silent-failure
  detector
- `bate_score_delta{signal_type}` — counter, score movement
- `webhook_delivery_total{outcome}` — counter, success/failure/dlq
- `audit_append_latency_seconds` — histogram, append performance
- `stripe_webhook_total{event_type, outcome}` — counter, billing webhook
  health
- `policy_expiry_sweep_total{outcome}` — counter, expiry job health

**Eze 2:2** Each SLI has an alert rule in `infra/observability/alerts/`
and a runbook in `infra/observability/runbooks/`. An SLI without those
pairs is decorative.

## Chapter 3 — Incident communication

**Eze 3:1** Per `docs/ARCHITECTURE.md` §9: P1 customers notified within 4
hours; P2 within 24 hours; P3 with the next status-page post. Mechanism:
webhook `aegis.incident.declared` + dashboard banner + email to principal
contact. Webhook payload Ed25519-signed.

**Eze 3:2** Status page at `status.aegislabs.io` reads
`incidents.{open,history}.json` from the management API (OD-007 default).

## Chapter 4 — Post-mortem doctrine

**Eze 4:1** Every SEV-1 and SEV-2 incident produces a post-mortem in
`docs/incidents/YYYY-MM-DD-<slug>.md`. The post-mortem covers timeline,
root cause, contributing factors, why detection took as long as it did,
why mitigation took as long as it did, and the regression test or alert
tightening that ships in response.

**Eze 4:2** No blame. The system is responsible for not letting the
operator make the mistake. If a single engineer's missed step caused the
incident, the system's safeguards failed first.

---
---

# BOOK XII — ISAIAH

> _The prophecy. The road from $0 MRR to financial staple. Each station is
> a measurable gate; each gate has a unlock; each unlock has a tribe._

## Chapter 1 — The eight stations on the road to staple

**Isa 1:1** The stations are numbered. Each is bounded by a measurable
threshold and a delivery posture. The hundred do not move to station N+1
until station N is securely held.

| Station | Threshold | Unlock | Lead tribe(s) |
| --- | --- | --- | --- |
| 1. **First green verify** | One developer completes the 10-minute path | Quickstart polish, SDK ergonomics | Scribes |
| 2. **First paid customer** | One Developer-tier sub | Stripe billing GA, dashboard upgrade flow | Exchequer, Cartographers |
| 3. **$500 MRR** | 10–11 paying users | PLG funnel: pricing → login → checkout → continued verify | Exchequer, Conquerors |
| 4. **$5K MRR** | Team tier conversions; MCP bridge installs | Python SDK GA, MCP bridge GA, LangChain integration | Scribes, Conquerors |
| 5. **First Enterprise pilot** | $1.5K/mo enterprise trial | SOC 2 Type I roadmap, DPA template, on-prem BATE planning | Sentinels, Heralds, Exchequer |
| 6. **$50K MRR** | Edge verify (< 80 ms p99 global), SOC 2 Type I | Phase 3 CF Worker GA | Praetorians, Watchtower, Sentinels |
| 7. **NIST reference posture** | AEGIS cited in NIST AI agent identity guidance | Standards engagement, public comments, reference implementation | Sentinels, Heralds |
| 8. **Acquisition / Standard status** | $500K ARR + 1M monthly verifies | Becoming the assumed substrate | Operator + all tribes |

**Isa 1:2** Each station produces a public artifact. Station 1: a
quickstart video. Station 2: a customer testimonial. Station 3: an
MRR-public dashboard. Station 4: a partner page. Station 5: a SOC 2
attestation letter. Station 6: a global latency map. Station 7: a NIST
comment letter. Station 8: an acquisition announcement or a public
ARR/verifies milestone.

## Chapter 2 — The pricing prophecy

**Isa 2:1** ADR-0014 (DECIDED) locks the tier structure:

- **Free trial:** 10,000 verifies lifetime cap, no time limit
- **Developer:** $49/month, 50,000 verifies/month
- **Team:** $299/month, 500,000 verifies/month
- **Scale:** $1,499/month, 5,000,000 verifies/month
- **Enterprise:** custom

Overage: $0.0008 per verify uniform across paid tiers. `TRIAL_EXHAUSTED`
is the lifetime-cap denial code; it sits in the precedence between
`SCOPE_NOT_GRANTED` and `SPEND_LIMIT_EXCEEDED`.

**Isa 2:2** Pricing source of truth is `apps/api/src/modules/billing/plans.ts`.
The public mirror is `/.well-known/pricing.json`. The dashboard SSR-fetches
the mirror with a build-time fallback. Drift between any of these three is
caught by `tests/cross-package/dashboard-pricing-parity.spec.ts`.

## Chapter 3 — The acquisition prophecy

**Isa 3:1** At $500K ARR + 1M monthly verifies, AEGIS becomes an
acquisition candidate for:

| Acquirer | Rationale | Likely multiple |
| --- | --- | --- |
| Okta / Auth0 | Identity layer for agents extends their IAM suite | 10–15× ARR |
| Stripe | Completes ACP with the identity layer they left to implementers | 12–20× ARR |
| Cloudflare | Zero Trust + agent identity = natural product extension | 8–12× ARR |
| CrowdStrike / Palo Alto | Agent identity as a security product | 10–15× ARR |
| Anthropic / OpenAI | Vertical integration of the trust layer | Strategic premium |

**Isa 3:2** Acquisition posture does not change the engineering bar.
Build as if no acquirer is coming; the acquirer comes precisely because
the engineering bar did not bend.

---
---

# BOOK XIII — REVELATIONS

> _The end state. The world after AEGIS becomes the substrate. What "won"
> looks like and what it requires of the hundred._

## Chapter 1 — The world after

**Rev 1:1** An agent without an AEGIS token is suspicious by default.

**Rev 1:2** Every MCP server in production carries `@aegis/mcp-bridge` in
its install path.

**Rev 1:3** Every ACP merchant runs `aegis.verify(token)` before
`stripe.payments.confirm(acpToken)`.

**Rev 1:4** Every browser agent platform — Browserbase, Anchor, Multi-on
and their successors — ships AEGIS in their default fleet posture.

**Rev 1:5** Every audit corpus produced by AEGIS is independently
verifiable in any runtime with `@aegis/audit-verifier`.

**Rev 1:6** NIST AI Agent Identity Initiative cites AEGIS as a reference
implementation.

**Rev 1:7** Visa's agentic commerce program lists AEGIS as a certified
identity provider for agent-initiated card transactions.

**Rev 1:8** Cloudflare Workers Marketplace carries the AEGIS verify edge
as a one-click deployment.

**Rev 1:9** The operator can revoke any agent, anywhere in the world,
within 60 seconds of the action.

**Rev 1:10** The hundred who built it have moved on to the next problem,
because the one they built is now infrastructure.

## Chapter 2 — What the end state demands of you

**Rev 2:1** Build as if AEGIS will be cited by a regulator next quarter.
Because it will.

**Rev 2:2** Build as if the audit chain will be subpoenaed. Because it
will.

**Rev 2:3** Build as if a Browserbase engineer will read your example
README cold tomorrow. Because they will.

**Rev 2:4** Build as if you will hand the repo to a stranger in six
months. Because the next hundred will inherit it.

**Rev 2:5** Build small. Build typed. Build observable. Build append-only.
Build neutral. Build for the operator at hour eight of an incident, the
auditor at year three of compliance, and the agent at second forty-one of
its first verify.

**Rev 2:6** And when the world calls AEGIS the boring, dependable
substrate it never thought it needed but cannot ship without — that is
when you have done your work. Be done quietly. Move on. Build the next
substrate.

---
---

# APPENDIX A — COMMAND INDEX

Most-used commands, by tribe.

## Universal

```sh
# 60-second checklist
~/.claude/peers/bin/claude-peers status
cd /Users/money/Desktop/AEGIS && git status --short --branch
head -120 docs/SESSION_HANDOFF.md

# Claim, heartbeat, release
claude-peers claim aegis <scope> --note "..." --ttl 7200
claude-peers heartbeat
claude-peers release aegis:<scope>
claude-peers conflict-check
claude-peers msg <peer-sid> "..."

# Verification ladder
pnpm --filter @aegis/<package> typecheck
pnpm --filter @aegis/<package> test
pnpm test:parity
pnpm check:openapi-zod
pnpm check:openapi-prisma
pnpm check:migrations
pnpm test:e2e
pnpm check
pnpm doctor
pnpm doctor:full
```

## Praetorians

```sh
pnpm --filter @aegis/api test -- modules/verify
pnpm --filter @aegis/api test:e2e -- verify
# Phase 3
wrangler dev   # in workers/cf-verify
```

## Archivists

```sh
pnpm --filter @aegis/api test -- modules/audit
pnpm --filter @aegis/audit-verifier test
aegis-audit-verify verify <ndjson-export> --jwks-file <jwks>
aegis-audit-verify verify-manifests <corpus-dir> --jwks-file <jwks> --json
```

## Scribes

```sh
pnpm --filter @aegis/sdk typecheck && test
pnpm --filter @aegis/verifier-rp typecheck && test
pnpm --filter @aegis/mcp-bridge typecheck && test
pnpm --filter @aegis/mcp-server typecheck && test
cd packages/sdk-py && python -m pytest
```

## Cartographers

```sh
pnpm --filter @aegis/dashboard typecheck
pnpm --filter @aegis/dashboard build
pnpm test:parity   # dashboard-pricing-parity, dashboard-safe-redirect
pnpm --filter @aegis/dashboard dev   # local check
```

## Oracle

```sh
pnpm --filter @aegis/api test -- modules/bate
pnpm test:parity   # bate-signal-enum
```

## Watchtower

```sh
pnpm format:check
pnpm doctor:full
# Alert + runbook spot check
ls infra/observability/alerts/ infra/observability/runbooks/
```

## Sentinels

```sh
pnpm --filter @aegis/api test -- common/crypto
pnpm test:parity   # crypto-parity, denial-precedence-enum, error-catalog-parity
```

## Heralds

```sh
pnpm format:check
pnpm check:openapi-zod
pnpm check:openapi-prisma
# Time-to-AHA test: walk your tutorial cold
```

## Exchequer

```sh
pnpm --filter @aegis/api test -- modules/billing
pnpm test:parity   # dashboard-pricing-parity, denial-precedence-enum
pnpm test:e2e -- customer-journey
```

## Conquerors

```sh
# Run each example's smoke
cd examples/<vertical> && pnpm test || pnpm start
pnpm test:parity   # integration shape regression
```

---

# APPENDIX B — DENIAL PRECEDENCE (CANONICAL)

```
0. PLAN_LIMIT_EXCEEDED      (billing pre-gate, fires before algorithm)
1. AGENT_NOT_FOUND
2. AGENT_REVOKED
3. INVALID_SIGNATURE
4. POLICY_REVOKED
5. POLICY_EXPIRED
6. SCOPE_NOT_GRANTED
7. TRIAL_EXHAUSTED          (lifetime-cap gate, ADR-0014)
8. SPEND_LIMIT_EXCEEDED
9. TRUST_SCORE_TOO_LOW
10. ANOMALY_FLAGGED
```

Changing this list (new reason, reorder, rename) requires:

- ADR update in `docs/decisions/`
- Parity test update in `tests/cross-package/denial-precedence-enum.spec.ts`
- OpenAPI update in `docs/spec/AEGIS_API_SPEC.yaml`
- `@aegis/sdk` update
- `aegis` (Python SDK) update
- `@aegis/verifier-rp` update
- Dashboard denial-reason translation table
- Both `docs/SECURITY.md` § 6 and `docs/AEGIS_AS_BACKBONE.md` § 5

…all in one PR. (Lev 1:6)

---

# APPENDIX C — FILE MAP (DAY-ONE COMPRESSION)

```
aegis/
├── apps/
│   ├── api/                  NestJS control plane + verify origin
│   │   ├── prisma/           schema, migrations (append-only post-deploy)
│   │   └── src/
│   │       ├── modules/      identity, policy, verify, audit, bate,
│   │       │                 billing, webhooks, auth, auth0, kms, mcp,
│   │       │                 idp-clerk, idp-workos, onboarding,
│   │       │                 compliance, wellknown, health
│   │       └── common/       crypto, errors, prisma, redis, outbox,
│   │                         observability, policy-engine
│   └── dashboard/            Next.js 16 operator/developer UI
├── packages/
│   ├── types/                @aegis/types — Zod schemas (source of truth)
│   ├── sdk-ts/               @aegis/sdk
│   ├── sdk-py/               aegis (Python)
│   ├── cli/                  Go single-static-binary aegis CLI
│   ├── verifier-rp/          @aegis/verifier-rp — offline RP verifier
│   ├── audit-verifier/       @aegis/audit-verifier — offline audit verifier
│   ├── mcp-bridge/           @aegis/mcp-bridge — wrap() any MCP server
│   └── mcp-server/           @aegis/mcp-server — Claude Desktop integration
├── workers/
│   └── cf-verify/            Cloudflare Worker — Phase 3 edge verify
├── examples/
│   ├── ai-platform-tool-call/    MCP integration
│   ├── acp-bridge/               Stripe ACP + AEGIS dual verify
│   ├── banking-rails/            ISO 20022 / treasury per-rail trust
│   ├── fintech-payments/         Single-token PSP gate
│   ├── relying-party-verifier/   RP pattern
│   ├── saas-seat-provisioning/   SCIM-shaped agent fan-out
│   └── reconciliation/           Audit ↔ system join + 4 mismatch classes
├── tests/
│   ├── cross-package/        Wire-contract parity
│   ├── e2e/                  Black-box numbered suites
│   ├── load/                 k6 + autocannon
│   └── chaos/                Fault injection
├── infra/
│   ├── observability/        OTel collector, alerts/, grafana, runbooks
│   ├── kms/                  KMS adapters
│   ├── postgres/, redis/     Local docker-compose
│   └── auth0/                Auth0 Action source
├── docs/
│   ├── spec/                 01_MASTER, 03_TECHNICAL_SPEC, AEGIS_API_SPEC.yaml
│   ├── decisions/            0001..0015 ADRs
│   ├── AGENT_BRIEFING.md     60-second cold-pickup brief
│   ├── ARCHITECTURE.md       Why the design is shaped this way
│   ├── SECURITY.md           Threat model + denial precedence
│   ├── BATE_ALGORITHM.md     Trust scoring spec
│   ├── AEGIS_AS_BACKBONE.md  Multi-project adoption
│   ├── WEDGE_PROOF.md        Wedge argument with code citations
│   ├── SERVICE_MAP.md        Day-one map
│   ├── SESSION_HANDOFF.md    Living log (newest first)
│   └── THE_AEGIS_TESTAMENT.md  ← this document
├── CLAUDE.md                 Root operating contract
├── AGENTS.md                 Codex/OMX contract + Lore commit format
├── WORK_BOARD.md             Claimable modules
└── OPERATOR_DECISIONS.md     Open decisions with reasoned defaults
```

---

# APPENDIX D — GLOSSARY

- **ACP** — Agentic Commerce Protocol (OpenAI + Stripe open standard).
- **ADR** — Architecture Decision Record. Lives in `docs/decisions/`.
- **AEGIS** — Agent Gateway & Identity Stack. The platform this Testament
  governs.
- **AGE** — One of four lifecycle stages (Spec, MVP, BATE & Bridges, Edge
  & Enterprise, Standard). See Book II.
- **BATE** — Behavioral Attestation Engine. AEGIS proprietary trust
  scoring engine.
- **CHAIN** — The audit chain. Append-only, Ed25519-signed, hash-linked
  event log.
- **CHIEF** — The rotating lead of a tribe (Book IV).
- **DENIAL PRECEDENCE** — The fixed order in which `/v1/verify`
  evaluates denial reasons.
- **DID** — Decentralized Identifier. W3C standard, AEGIS-compatible.
- **ED25519** — Elliptic curve signature scheme. The primary curve for
  AEGIS.
- **JWKS** — JSON Web Key Set. Published at `/.well-known/jwks.json` and
  `/.well-known/audit-signing-key`.
- **JTI** — JWT ID. CSPRNG-sourced unique identifier; used for replay
  defense via Redis SETNX.
- **MCP** — Model Context Protocol. The standard tool-call protocol for
  LLMs.
- **MOTION** — One of three buying motions: Self-serve PLG, Sales-
  assisted, Enterprise.
- **NHI** — Non-Human Identity. Industry term for machine/agent
  identities.
- **OD** — Operator Decision. Open rows in `OPERATOR_DECISIONS.md`.
- **PEER** — A parallel Claude session in the repo. Coordinated via the
  `claude-peers` CLI.
- **PRINCIPAL** — The human or organization that owns an agent. Tenant
  unit.
- **PRP** — Pure Relying Party. A relying party that consumes AEGIS
  tokens but does not write to AEGIS state.
- **RP** — Relying Party. The service that verifies AEGIS tokens.
- **SHAPE** — One of three plug-and-play integration shapes (Exo 3:1):
  `wrap()`, `verify()`, dual-token.
- **SPT** — Shared Payment Token. Stripe primitive in ACP.
- **STATION** — One of eight milestones on the road from $0 MRR to staple
  status (Isa 1:1).
- **TERRITORY** — A vertical of relying parties (Joshua Ch.1).
- **TRIBE** — One of ten engineering departments (Book IV).
- **TRUST SCORE** — Integer in [0, 1000]; computed by BATE; banded into
  PLATINUM / VERIFIED / WATCH / FLAGGED.
- **WEDGE** — The tool-call checkpoint. AEGIS's protocol-level insertion
  point.

---

*End of Testament v1.0. Reviewed: 2026-05-11. Next review cadence:
quarterly, or on any change to the eight invariants. Custodian: operator.*
*When in doubt, the verse wins.*
