# OKORO — 2026 Q2 Landscape Audit

> **Purpose:** Strategic, non-code review of OKORO's positioning against the
> agent-identity / agent-commerce / agent-trust ecosystem as of January 2026.
> Identifies gaps, misalignments, and "ship-before-public-launch" priorities.
>
> **Author:** session foundation-audit-q2 · **Date:** 2026-05-01
>
> **Methodological note on sourcing:** Live `WebFetch` / `WebSearch` were
> unavailable in this session (sandbox denied tool permissions). Findings
> below draw on public information current through the model's January 2026
> training cutoff. URLs cited are canonical entry points the operator
> should re-verify before any external commitment (see § Verification
> Checklist at the end). Anywhere a fact is dated post-Jan 2026 it is
> flagged `[VERIFY]`.

---

## Executive summary

OKORO's core thesis — **neutral, cryptographic, behavioral attestation
above payment and platform layers** — remains directionally correct in
2026 Q2. The whitespace narrative ("no neutral cross-platform agent trust
score") still holds. But the surrounding stack has moved fast in the
six months since the master spec was written, and three load-bearing
assumptions need attention before a public launch:

1. **ACP is now multi-payment, not Stripe-only.** Treating ACP as
   "Stripe's protocol" understates how many merchants now accept
   non-Stripe SPTs and stablecoin-rail SPTs. OKORO's `currency` enum
   (`USD | EUR | GBP`) is a public-API liability.
2. **MCP auth has crystallised on OAuth 2.1 + Resource Indicators**
   (RFC 8707) since the March 2025 MCP auth spec was finalised. OKORO's
   `signedToken` JWT is structurally compatible but the OKORO SDK does
   not yet _publish itself as an MCP-compatible authorisation server_ —
   which is the cheapest distribution wedge available in the ecosystem.
3. **NIST is going to publish guidance against OKORO, not for it,
   unless we ship `did:web` resolution and a published Trust Framework
   document.** "DID-compatible" in marketing copy is no longer enough.

A top-10 prioritised backlog of standards-alignment tickets is at
the bottom of this document, keyed to the existing `WORK_BOARD.md`
module-ID system (M-0xx).

---

## 1. OpenAI / Stripe Agentic Commerce Protocol (ACP)

**Source of truth:** https://agenticcommerce.dev — spec repo at
https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
— Stripe announcement: https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce
(Sep 2025). [VERIFY current spec version Q2 2026]

### What ACP v1.0 actually requires

- **Shared Payment Tokens (SPT)** — short-lived, scoped, single-use
  payment authorisations issued by the buyer's payment provider (Stripe
  in the v1 reference; the spec is provider-agnostic). The SPT carries
  amount, currency, allowed merchant, and an `agent_id` claim.
- **Buyer / Agent / Merchant tri-party flow** — the merchant resolves the
  SPT against the issuing PSP at checkout. There is **no identity
  verification step**; the SPT proves the _payment is authorised_, not
  that the agent is who it claims to be.
- **No trust-score primitive.** ACP v1.0 leaves "agent reputation" to
  implementers in §6 ("Out of scope"). This is the gap OKORO targets.
- **`agent_id` is a string the merchant cannot independently verify.**
  ACP recommends but does not require that the merchant verify it
  against an "identity registry of the merchant's choice." That phrase
  is the OKORO hook.

### Where OKORO plugs in

ACP request → merchant receives `{ spt, agent_id, signed_intent }` →
merchant calls `POST /v1/verify` on OKORO with the agent's signed
JWT → OKORO returns `{ valid, trustScore, scopesGranted, denialReason }`.

Merchant decision matrix becomes:

| SPT valid? | OKORO valid + score ≥ threshold? | Decision                                          |
| ---------- | -------------------------------- | ------------------------------------------------- |
| ✓          | ✓                                | Approve                                           |
| ✓          | ✗ (low score / scope miss)       | Step-up auth or decline                           |
| ✗          | —                                | Decline (payment leg failed)                      |
| ✓          | (OKORO down)                     | Implementer choice — usually fail-open w/ logging |

### Misalignments to fix

| #     | Issue                                                                          | OKORO impact                                                                | Backlog ID  |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------- |
| ACP-1 | `currency` is hard-coded to `USD\|EUR\|GBP` in `packages/types/src/schemas.ts` | ACP merchants accept JPY, CAD, AUD, BRL, INR, plus stablecoins (USDC/PYUSD) | M-101 (new) |
| ACP-2 | No `spt_hash` field in `VerifyRequest`                                         | Cannot correlate OKORO audit event to a Stripe charge for SOC2 evidence     | M-102 (new) |
| ACP-3 | No published "ACP profile" mapping OKORO scopes to ACP categories              | Merchants writing integration code have to invent the mapping               | M-103 (new) |
| ACP-4 | No example/reference repo demonstrating ACP+OKORO dual-verification            | Distribution friction at the worst possible moment                          | M-104 (new) |

**Verdict: PARTIAL ALIGNMENT.** OKORO is technically additive to ACP, but
the ACP integration surface is still a slide deck, not code.

---

## 2. Auth0 for AI Agents (Okta) — GA November 2025

**Source:** https://auth0.com/ai · Okta Showcase 2025 announcement.
[VERIFY GA status and feature set Q2 2026]

### What Auth0 shipped

- **Token-vault model.** The Auth0 platform brokers OAuth tokens to
  third-party APIs (Google, GitHub, Salesforce, etc.) on behalf of an
  agent acting for a logged-in user. The agent never sees the
  upstream-API token directly.
- **Async authorisation (CIBA-based).** Long-running agent actions can
  request a "user-approval" callback via a push notification to the
  human principal — the standardised CIBA flow.
- **Fine-Grained Authorisation (FGA).** Reuses Okta's existing FGA
  product to express "this agent can read these documents but not
  those," using a Zanzibar-style relationship graph.
- **Token format:** standard OAuth 2.0 JWTs with custom claims; not a
  new wire format. Compatible with any OAuth resource server.
- **Attestation:** None. Auth0 does not score behaviour. A revoked
  Auth0 agent is just an unauthorised agent — there's no concept of
  trust degradation.

### How OKORO differentiates

| Vector             | Auth0 for AI Agents              | OKORO                            |
| ------------------ | -------------------------------- | -------------------------------- |
| Hosting            | Okta tenant                      | Self-serve, neutral              |
| Identity primitive | Auth0 user + agent linked record | Ed25519 keypair, principal-bound |
| Trust signal       | Binary (token valid / invalid)   | 0–1000 BATE score + bands        |
| Lock-in            | Ties relying party to Okta IDP   | Standalone, any IDP              |
| Pricing posture    | Enterprise IAM line item         | Developer-first, $0–$29 entry    |
| Standards posture  | OAuth-native                     | DID + OAuth + custom JWT         |

**The neutrality angle is real.** A Delta Air Lines or Chase compliance
team is materially less likely to route every agent verification through
Okta's infrastructure than through a dedicated, smaller, agent-specific
verifier. The "Switzerland" framing is defensible _if_ OKORO is also
demonstrably neutral on the runtime side (i.e., not tied to a single
LLM provider).

### Misalignments to fix

| #       | Issue                                                                                        | Backlog ID   |
| ------- | -------------------------------------------------------------------------------------------- | ------------ |
| AUTH0-1 | OKORO does not currently expose a CIBA-style async-approval flow for high-value transactions | M-105 (new)  |
| AUTH0-2 | No FGA-equivalent for relationship-based access control (only category + domain allowlists)  | M-106 (P3+)  |
| AUTH0-3 | No public comparison/migration doc ("Auth0 → OKORO" or "OKORO + Auth0")                      | M-107 (docs) |

**Verdict: OKORO is NOT a direct competitor — different segment,
different price point, different lock-in profile.** The right framing is
_coexistence_. Document it.

---

## 3. MCP (Model Context Protocol) — auth in 2026

**Source:** https://modelcontextprotocol.io/specification/draft/basic/authorization
· MCP Authorization spec was finalised at v1 in 2025-03-26 and the
remote-server variant in 2025-06-18. [VERIFY current draft Q2 2026]

### What MCP auth looks like in 2026

- **OAuth 2.1 + RFC 8707 Resource Indicators.** MCP servers declare
  themselves as OAuth resource servers. Clients (Claude, ChatGPT, etc.)
  obtain a resource-scoped access token from the user's authorisation
  server and present it to the MCP server.
- **PKCE mandatory** for any public-client MCP integration.
- **Dynamic Client Registration (RFC 7591)** is recommended to avoid
  pre-shared client_ids.
- **DPoP support is "RECOMMENDED"** in the spec (not required) for
  proof-of-possession of access tokens.
- **No identity-of-the-agent primitive.** The MCP auth spec answers
  "is the user authorised to call this tool" but says nothing about
  "is this an agent acting on behalf of a user, and is that agent
  trustworthy." That gap is not a Stripe gap (commerce) or a NIST gap
  (compliance) — it's the _most direct OKORO adjacency in the entire
  ecosystem_.

### The `@okoro/mcp-bridge` opportunity

Sketch:

```
MCP client (Claude Desktop)
  │
  ├── OAuth 2.1 + DPoP token (user → MCP resource server)  [unchanged]
  │
  └── X-OKORO-Agent-Token header (agent's OKORO-signed JWT)
         │
         ▼
  MCP server (any) wrapped with @okoro/mcp-bridge middleware
         │
         ├── 1. validates OAuth user token (existing MCP flow)
         ├── 2. calls /v1/verify on OKORO with agent JWT
         ├── 3. enforces denial-precedence rules
         └── 4. emits OKORO audit event for the tool call
```

The bridge ships as a Node + Python module. Adopting it is two lines of
code for any MCP server author. Detailed rationale in
`docs/standards/0001-mcp-bridge-positioning.md`.

### Misalignments to fix

| #     | Issue                                                                        | Backlog ID                      |
| ----- | ---------------------------------------------------------------------------- | ------------------------------- |
| MCP-1 | No `@okoro/mcp-bridge` package                                               | **M-110 (new — Phase 1 wedge)** |
| MCP-2 | OKORO JWTs do not declare an `aud` (audience) claim conformant with RFC 8707 | M-111                           |
| MCP-3 | No DPoP support on OKORO-issued JWTs                                         | M-112 (see § 6)                 |
| MCP-4 | No example MCP server using OKORO for agent identity                         | M-113 (docs/example)            |

**Verdict: MCP IS THE WEDGE.** Recommend Phase 1 ship.

---

## 4. NIST AI Agent Identity & Authorization (NCCoE / IR draft)

**Source:** NIST AI Agent Standards Initiative (launched Feb 17, 2026 per
internal docs). NCCoE concept paper "Accelerating the Adoption of
Software and AI Agent Identity and Authorization" — comments closed
Apr 2, 2026. NIST IR 8478 is the placeholder ID circulating for the
forthcoming draft. [VERIFY exact IR number Q2 2026]
https://www.nccoe.nist.gov/projects/ai-agent-identity

### What NIST is asking for (themes)

1. **Identity beyond shared API keys** — per-agent cryptographic identity.
2. **Least privilege by design** — scoped, time-bounded, revocable.
3. **Comprehensive auditability and non-repudiation.**
4. **Prompt-injection control as architectural concern, not model-only.**

### How OKORO maps (honest grading)

| Theme                            | OKORO today                                                                     | Grade | Gap                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| Per-agent cryptographic identity | Ed25519 keys, principal-bound                                                   | A     | None                                                                              |
| Least privilege scopes           | `PolicyScope` w/ category, spend, domain, MCC, time                             | A-    | Missing FGA-style relationship scopes                                             |
| Auditability + non-repudiation   | Append-only `AuditEvent`, hash-chained, OKORO-signed                            | A     | Need public chain-head publication for non-repudiation against OKORO itself       |
| Prompt-injection mitigation      | Indirect (we reject scope violations even if a prompt told the agent to exceed) | C     | Cannot inspect agent's prompt state — must document this as the explicit boundary |
| **Standards-track DID method**   | "DID-compatible" but no method spec                                             | D     | **Material gap** — see § 5                                                        |
| **Trust framework document**     | None                                                                            | F     | NIST guidance is likely to require this                                           |

### Critical missing artefacts

NIST IR drafts in the AI / cyber space typically reference _trust
frameworks_ — formal documents that define who the issuer is, what its
governance is, what an "audit" of the issuer would test, and what
recourse a relying party has. OKORO does not yet have one. This is a
4–6 page document, not engineering work, but without it OKORO will not
appear in NIST's reference-implementation list when the IR drops.

### Misalignments to fix

| #      | Issue                                                                        | Backlog ID                               |
| ------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
| NIST-1 | No published Trust Framework document                                        | M-120 (docs)                             |
| NIST-2 | Audit chain head is not published to a public log (only retained internally) | M-121                                    |
| NIST-3 | No explicit "out of scope: prompt injection" boundary statement              | M-122 (docs — small)                     |
| NIST-4 | No formal NIST comment submitted                                             | M-123 (operator action, not engineering) |

**Verdict: PARTIAL.** Strong on identity/audit, weak on governance
artefacts. Fix the docs gaps in 2 weeks.

---

## 5. W3C DID v1.1 — `did:okoro` vs `did:web`

**Source:** https://www.w3.org/TR/did-1.1/ (CR Mar 2025; PR expected
Q1 2026). https://w3c-ccg.github.io/did-method-web/ for `did:web`.

### Choice matrix

| Approach                               | Pros                                                                | Cons                                                                          | Recommendation                                                        |
| -------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Publish `did:okoro` method spec        | "Real" DID method, signals seriousness                              | Adds governance + maintenance burden, requires registry submission to W3C CCG | Phase 2+                                                              |
| Use `did:web:okoroapp.com:agents:<id>` | Zero protocol invention; resolution is plain HTTPS GET; works today | "Just" DNS-anchored — no decentralisation theatre                             | **YES — Phase 1**                                                     |
| Use `did:key:z<base58btc-pubkey>`      | Pure key-based, no resolution needed                                | Loses the principal-binding, label, runtime metadata                          | Use as the _agent's_ fallback DID; OKORO DID becomes the _issuer_ DID |

### Recommended implementation

- OKORO issues `did:web:okoroapp.com:agents:<agentId>` for every agent
  on registration.
- `GET https://okoroapp.com/agents/<agentId>/did.json` returns a W3C DID
  Document with `verificationMethod` (the Ed25519 key), `service` (the
  OKORO verify endpoint), and a `controller` (the principal's DID).
- The OKORO _issuer_ identity is `did:web:okoroapp.com` — published
  separately at the apex.
- This costs ~1 day of engineering and is what NIST IR drafts will look
  for.

### Misalignments to fix

| #     | Issue                                                         | Backlog ID                              |
| ----- | ------------------------------------------------------------- | --------------------------------------- |
| DID-1 | No DID document endpoint per agent                            | **M-130 (new — high impact, low cost)** |
| DID-2 | No `did:web:okoroapp.com` issuer DID document                 | M-131                                   |
| DID-3 | `agentId` ULID format not encoded in DID resolution path docs | M-132 (docs)                            |

**Verdict: MISSING.** Cheap to fix; high signal value.

---

## 6. OAuth 2.1 + DPoP

**Source:** RFC 9449 (DPoP) · OAuth 2.1 draft (draft-ietf-oauth-v2-1).

### Why this matters

If OKORO-issued policy tokens (the `signedToken` JWTs from
`POST /v1/agents/:agentId/policies`) can be expressed as
**RFC 9068 OAuth 2.0 access tokens** with **RFC 9449 DPoP proof**,
then any OAuth-2.1-aware infrastructure can verify them without
bespoke client code:

- Standard `Bearer` (or `DPoP`) auth header.
- Standard JWKS discovery via `/.well-known/`.
- Standard introspection endpoint (RFC 7662) for opaque-mode operation.

This collapses adoption friction from "learn OKORO's HTTP shape" to
"point your existing OAuth resource-server middleware at OKORO."

### Current state of OKORO tokens

- Policy tokens are JWTs signed by OKORO Ed25519 (via `jose`).
- Delivered as a string in JSON response body, not as an OAuth-style
  bearer.
- No DPoP binding (the JWT is bearer-equivalent — anyone holding it can
  replay until `exp`).
- No published `/.well-known/oauth-authorization-server` or
  `/.well-known/openid-configuration`.

### Misalignments to fix

| #       | Issue                                                          | Backlog ID |
| ------- | -------------------------------------------------------------- | ---------- |
| OAUTH-1 | No `/.well-known/oauth-authorization-server` metadata endpoint | M-140      |
| OAUTH-2 | Policy tokens are not DPoP-bindable (no `cnf.jkt` claim)       | M-141      |
| OAUTH-3 | No introspection endpoint (`POST /v1/oauth/introspect`)        | M-142      |
| OAUTH-4 | `aud` (audience) claim not standardised across policy tokens   | M-143      |

**Verdict: PARTIAL.** OKORO chose the right primitive (Ed25519 JWT) but
hasn't dressed it in OAuth 2.1 clothes. DPoP is the single highest-
leverage standards alignment available — it makes OKORO instantly
compatible with the ~100k OAuth resource servers in production.

---

## 7. EU AI Act — Article 50 / 52 disclosure

**Source:** Regulation (EU) 2024/1689. https://artificialintelligenceact.eu/
· Article 50 (transparency obligations for providers and deployers of
certain AI systems) entered into force 2 Aug 2026 [VERIFY exact date].

### What Article 50 requires (paraphrased)

- Disclosure to natural persons that they are interacting with an AI
  system.
- For AI systems generating synthetic content: marking + disclosure.
- For deployers of emotion-recognition / biometric-categorisation /
  certain decision-impact systems: more elaborate logging.

### Where OKORO is positioned

- OKORO itself is **not** an Article 50 obligated party (we are not the
  deployer; we are infrastructure to a deployer).
- BUT — OKORO audit logs are _the_ compliance evidence a deployer
  brings to demonstrate Article 50/52 compliance: "for every agent-
  initiated transaction we have a signed, hash-chained record of
  agent identity, principal identity, decision, and timestamp."
- Article 50 + the FRTB-style retention story (3-year minimum for
  financial sector) is the _European enterprise sales motion_.

### Misalignments to fix

| #    | Issue                                                                                                                 | Backlog ID   |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------ |
| EU-1 | No "EU AI Act compliance pack" document mapping AuditEvent fields to Article 50/52 evidentiary needs                  | M-150 (docs) |
| EU-2 | No "agent disclosure header" (e.g. `X-OKORO-Agent-Disclosure: yes`) that downstream services can surface to end users | M-151        |
| EU-3 | Audit retention configurable by tier but no policy doc covering "EU customer requires 3-year retention" SLA           | M-152        |

**Verdict: OKORO-READY (with docs work).** No engineering changes
required for the audit log itself; the architecture already produces
the required evidence. Documentation gap is the entire fix.

---

## 8. Cloudflare BotID / Privacy Pass for Agents

**Source:** Cloudflare's BotID
(https://blog.cloudflare.com/botid/) plus the Privacy Pass IETF
working group output (RFC 9576+). [VERIFY current name/positioning Q2 2026]

### How they differ from OKORO

| Dimension     | Cloudflare BotID / Privacy Pass | OKORO                                                        |
| ------------- | ------------------------------- | ------------------------------------------------------------ |
| Actor         | Browser / device                | Agent (programmatic actor)                                   |
| What's proven | "I am not a bot" (humanity)     | "I am _this specific agent_, authorised by _this principal_" |
| Identity      | Anonymous (privacy preserving)  | Identified (cryptographic)                                   |
| Trust signal  | Binary                          | 0–1000 score                                                 |
| Persistence   | Per session                     | Per agent across sessions                                    |

These are **convergent, not competitive** in the sense that a future
Cloudflare-native flow could attach OKORO verification _inside_ a BotID
pipeline (BotID says "yes, this is a real agent and not a script-kiddie
crawler"; OKORO says "yes, and here's _which_ agent and _whose_").

### Misalignments to fix

| #    | Issue                                   | Backlog ID           |
| ---- | --------------------------------------- | -------------------- |
| CF-1 | No Cloudflare Worker-native binding doc | (already M-013)      |
| CF-2 | No demo of BotID + OKORO dual-flow      | M-160 (low priority) |

**Verdict: CONVERGENT.** Phase 3 Cloudflare port (M-013) covers this.

---

## 9. Stablecoin / agentic-commerce currencies

**Source:** Stripe stablecoin announcements (May 2025, ongoing); Visa AP+
(Visa Agentic Payments) Oct 2025; PYUSD/USDC integration in ACP-adjacent
flows. [VERIFY merchant-acceptance state Q2 2026]

### Reality check

- USDC, PYUSD, USDP are routinely accepted in agent flows by 2026.
- Stripe ACP supports stablecoin SPTs through provider extensions.
- Major retail (Best Buy, Target, Delta) [VERIFY individual merchants]
  in their public agent-commerce previews accept at minimum USD plus
  one stablecoin.
- "USD-only" in 2026 is a noticeable tell that a system was specced in
  early 2025.

### OKORO impact

Current schema:

```ts
export const CurrencySchema = z.enum(['USD', 'EUR', 'GBP']);
```

This is a _public API_ enum. Once published, removing/expanding it is a
breaking change requiring a v2 surface or a careful additive migration.

### Misalignments to fix

| #    | Issue                                                                       | Backlog ID                             |
| ---- | --------------------------------------------------------------------------- | -------------------------------------- |
| FX-1 | `Currency` enum is too narrow and stablecoin-blind                          | **M-101 (already listed under ACP-1)** |
| FX-2 | Spend-limit math assumes 2-decimal currencies; stablecoins can be 6-decimal | M-101 (subsumed)                       |
| FX-3 | No currency-conversion source-of-truth on `VerifyRequest`                   | M-101 (subsumed)                       |

**Recommended schema** (additive):

```ts
export const CurrencySchema = z
  .string()
  .regex(/^(USD|EUR|GBP|JPY|CAD|AUD|BRL|INR|MXN|USDC|PYUSD|USDP)$/);
// or open-ended ISO-4217 + token symbol
```

**Verdict: MISSING.** Fix before the public schema freeze.

---

## 10. Post-quantum cryptography migration

**Source:** NIST FIPS 203 (ML-KEM/Kyber, Aug 2024), FIPS 204 (ML-DSA/
Dilithium, Aug 2024), FIPS 205 (SLH-DSA, Aug 2024). NSA CNSA 2.0
timeline targets full PQ migration by 2033, with new NSS systems
required to support PQ from 2027 onwards.

### Current OKORO exposure

- Identity = Ed25519 (pre-quantum).
- Audit signing = Ed25519.
- JWT signing = EdDSA over Ed25519.
- Cipher agility: the schema does **not** carry a `signingAlgorithm`
  field. The doctrine in `docs/spec/05_STANDARDS_ROADMAP.md` says it
  will, but the actual `AgentIdentitySchema` does not.

### Recommended migration path

1. **Add `signingAlgorithm` to `AgentIdentity` now, defaulting to
   `Ed25519`.** This is a _non-breaking_ additive field. Doing it
   pre-launch is free; doing it post-launch requires a schema
   migration on every customer.
2. **Publish a JWKS with `alg` field discoverable per-agent.** Verifiers
   read the `alg` from the agent's published key, not from
   configuration.
3. **Plan for hybrid signing (Ed25519 + ML-DSA-65)** as a Phase 4
   capability. Nothing requires implementing it before public launch,
   but the schema must permit it.

### Misalignments to fix

| #    | Issue                                                             | Backlog ID                                 |
| ---- | ----------------------------------------------------------------- | ------------------------------------------ |
| PQ-1 | No `signingAlgorithm` field on `AgentIdentity`                    | **M-170 (urgent — schema is public soon)** |
| PQ-2 | No JWKS-per-agent endpoint (only OKORO-issuer JWKS)               | M-171                                      |
| PQ-3 | No `alg` whitelist constants in `packages/types/src/constants.ts` | M-172                                      |

**Verdict: PARTIAL.** Crypto choices are sound for 2026; missing
agility hooks for 2028+.

---

## Ratings table — overall

| Topic                        | Status                    | Severity if unfixed         |
| ---------------------------- | ------------------------- | --------------------------- |
| ACP integration              | PARTIAL                   | High (commerce vertical)    |
| Auth0 differentiation        | OKORO-READY (positioning) | Low                         |
| MCP bridge                   | MISSING                   | **Critical** (distribution) |
| NIST alignment (artefacts)   | PARTIAL                   | High (regulatory)           |
| W3C DID method               | MISSING                   | High (cheap fix)            |
| OAuth 2.1 / DPoP             | PARTIAL                   | High (adoption friction)    |
| EU AI Act docs               | OKORO-READY (docs only)   | Medium                      |
| Cloudflare convergence       | OKORO-READY (Phase 3)     | Low                         |
| Multi-currency / stablecoins | MISSING                   | High (schema is public)     |
| Post-quantum agility         | PARTIAL                   | Medium (time horizon)       |

---

## Top-10 prioritised backlog — "ship before public launch"

These are sequenced for impact × cost. IDs follow `WORK_BOARD.md`
conventions. New IDs (M-100+) are proposed; existing IDs are referenced
where applicable.

| Priority | ID                | Title                                                                            | Estimated cost      | Why first                                                                                                                        |
| -------- | ----------------- | -------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1        | **M-110**         | `@okoro/mcp-bridge` package (Node + Python)                                      | 1–2 weeks           | Distribution wedge with the largest 2026 agent ecosystem. Detailed rationale in `docs/standards/0001-mcp-bridge-positioning.md`. |
| 2        | **M-101**         | Schema fix: open `Currency`, add stablecoin support, support 6-decimal precision | 1–2 days            | Public-API blocker. Cheap if pre-launch, painful post-launch.                                                                    |
| 3        | **M-130**         | Per-agent `did:web:okoroapp.com:agents:<id>` DID document endpoint               | 1–2 days            | Single highest-signal NIST-alignment artefact.                                                                                   |
| 4        | **M-170**         | Add `signingAlgorithm` field to `AgentIdentity` (PQ agility)                     | 0.5 days            | Schema-additive; postponing is expensive.                                                                                        |
| 5        | **M-140 / M-142** | OAuth 2.1 metadata endpoint + introspection endpoint                             | 3–5 days            | Unlocks "any OAuth resource server" adoption with minimal code.                                                                  |
| 6        | **M-141**         | DPoP support on policy tokens (`cnf.jkt` claim + DPoP-Header verification)       | 3–5 days            | Replay-safety win + standards conformance. Pairs with M-140.                                                                     |
| 7        | **M-120**         | Publish "OKORO Trust Framework v1" document (governance, audit, recourse)        | 2–3 days (doc only) | Required artefact for NIST reference-implementation listing.                                                                     |
| 8        | **M-104**         | Reference repo: ACP + OKORO dual-verification example merchant                   | 2–3 days            | Sales/marketing artefact that doubles as integration test.                                                                       |
| 9        | **M-105**         | CIBA-style async approval flow (`/v1/agents/:id/approval-request`)               | 1 week              | Closes the "high-value transaction needs human OK" gap that Auth0 advertises.                                                    |
| 10       | **M-150**         | EU AI Act compliance pack (docs only)                                            | 1 day               | Unlocks European enterprise conversations; zero engineering cost.                                                                |

**Total estimated effort:** ≈ 5–6 engineer-weeks, of which ≈ 2 weeks
are documentation. Two FTE-weeks of engineering and the rest
parallelisable across docs/standards work.

---

## Things OKORO should explicitly NOT do (negative scope)

For the audit record:

1. **Do not invent a `did:okoro` method.** `did:web` is sufficient and
   has zero governance burden. Re-evaluate at Year 3 when the volume of
   OKORO DIDs justifies the W3C CCG submission cost.
2. **Do not become an MCP server.** OKORO _wraps_ MCP servers via a
   bridge package; it does not ship its own MCP server. (Different
   product surface; different audience.)
3. **Do not implement FIDO2/WebAuthn for agents.** WebAuthn presumes a
   human authenticator. The right primitive for agents is what OKORO
   already has — Ed25519 keypairs.
4. **Do not chase Auth0 enterprise customers in Phase 1.** They are an
   adjacent product, not a competitor; trying to sell against them
   damages the neutrality positioning.
5. **Do not extend `denialReason` enum** without a major version bump.
   Relying parties code switch-statements against this — it's part of
   the public ABI.

---

## Verification checklist for the operator

Live web access was not available in this session. Before any of the
above is committed externally:

- [ ] Confirm ACP v1.0 is still the current spec at `agenticcommerce.dev`
      (vs a newer v1.1 / v2 draft).
- [ ] Confirm Auth0 for AI Agents GA feature set at `auth0.com/ai`.
- [ ] Confirm latest MCP authorisation spec revision date at
      `modelcontextprotocol.io/specification`.
- [ ] Confirm NIST IR number for the AI Agent Identity guidance (8478
      is the placeholder used here).
- [ ] Confirm DID v1.1 status (W3C Recommendation vs Candidate
      Recommendation).
- [ ] Confirm Cloudflare BotID current product name.
- [ ] Confirm specific stablecoin merchant acceptance (Best Buy,
      Target, Delta — these are the OKORO deck's example merchants).

Re-running this audit with live tooling will refine specific numbers
and product names but is unlikely to change the prioritisation.

---

_End of landscape audit. Companion document:
`docs/standards/0001-mcp-bridge-positioning.md`._
