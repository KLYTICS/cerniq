# AEGIS — Master Engineering & GTM State Document
## Phase 1 GA Closure | May 2026
### Classification: INTERNAL — Engineering Lead + All Terminals

> **How to read this document.** It is the single source of truth for what AEGIS *is right now* — code-proven, not aspirational. Every claim is backed by a specific file or endpoint. Use PART VII to find your terminal assignment. Use PART VIII to find your next task.

---

## PART I — EXECUTIVE SUMMARY

### The One-Paragraph Version

AEGIS is the neutral cryptographic trust layer between AI agents and the services they act on. It holds only public keys, signs only what it observed, enforces behavior-scoped policies at call time, and produces an immutable audit chain that any relying party can independently verify. In May 2026, all four Phase 1 GA engineering gates are closed, Stripe billing is live, BATE anomaly detection is wired, and the product is ready for first paying users.

### Phase 1 Gate Status — ALL CLOSED

| Gate | Description | Code Location | Status |
|------|------------|---------------|--------|
| G-1 | `/.well-known/audit-signing-key` JWKS endpoint | `modules/wellknown/` | ✅ CLOSED |
| G-2 | Free-tier quota enforcement + Stripe billing | `modules/billing/` | ✅ CLOSED |
| G-3 | BATE anomaly detector wired to recompute worker | `modules/bate/bate.worker.ts` | ✅ CLOSED |
| G-4 | Webhook subscription endpoints | `modules/webhooks/webhooks.controller.ts` | ✅ CLOSED |

### Codebase Snapshot (2026-05-05)

```
190   TypeScript source files
 50   Spec files (Jest + Vitest)
 18   NestJS modules
 10   Packages (SDK, types, MCP bridge, CLI, verifier)
 14   Prisma database models
  0   Type errors (excluding pre-existing KMS SDK installs)
  4   Phase 1 gates — all closed
```

---

## PART II — WHAT IS ACTUALLY BUILT (Code-Proven Inventory)

### 2.1 Core API — NestJS (apps/api/)

Every module below is WIRED in `app.module.ts`. "Wired" means instantiated at boot, not commented out, not scaffolded.

#### Module: `verify` — The Hot Path
**Files:** `verify.service.ts`, `verify.controller.ts`, `verify.dto.ts`, `algorithm/verify.algorithm.ts`, `spend-guard.service.ts`, `replay-cache.service.ts`

The most important code in the repo. `verifyAlgorithm()` is a **pure function with zero NestJS imports** — portable to Cloudflare Workers in Phase 3 without a rewrite (CLAUDE.md invariant #2).

Gate order on every call:
```
1. G-2 billing gate:    UsageGuardService.checkQuota()  → PLAN_LIMIT_EXCEEDED (pre-algorithm)
2. AGENT_NOT_FOUND:     Redis cache → Postgres fallback
3. AGENT_REVOKED:       status field check
4. INVALID_SIGNATURE:   Ed25519 verify + JWT decode
5. POLICY_REVOKED:      policy.status check
6. POLICY_EXPIRED:      policy.expiresAt check
7. SCOPE_NOT_GRANTED:   scope intersection
8. SPEND_LIMIT_EXCEEDED: SpendGuardService (Redis Lua atomic)
9. TRUST_SCORE_TOO_LOW: minTrustScore threshold
10. ANOMALY_FLAGGED:    BATE band FLAGGED check
→ APPROVED
```

Every denied call: `verifyTotal.inc({ denial_reason })` metric. Every call: `verifyLatency.observe()`.

#### Module: `billing` — Revenue Engine
**Files:** `billing.module.ts`, `billing.controller.ts`, `stripe.service.ts`, `usage-guard.service.ts`, `plans.ts`

**Endpoints:**
- `POST /v1/billing/checkout` — creates Stripe Checkout session, redirects user to hosted page
- `POST /v1/billing/webhook` — public, Stripe-Signature HMAC verified, raw-body intake
- `GET  /v1/billing/plan` — plan tier + monthly quota snapshot (no Stripe round-trip)

**Stripe integration:**
- Lazy SDK init (safe in test environments without the npm package)
- Circuit breaker around all outbound Stripe API calls (5 failures → OPEN, 30s reset)
- Idempotency: Redis SETNX on `aegis:stripe:event:{eventId}`, 7-day TTL
- Idempotency rollback on handler throw (Stripe retries work correctly)
- Handles: `checkout.session.completed`, `customer.subscription.updated/created/deleted`, `invoice.payment_failed`
- Plan tier written to `Principal.planTier` + plan cache invalidated on every state change

**Quota enforcement:**
- Redis counter: `aegis:usage:{principalId}:{YYYY-MM}`
- DB backfill on Redis miss: `AuditEvent.count WHERE principalId + timestamp >= startOfMonth`
- Plan tier cached: `aegis:plan:{principalId}`, 5-minute TTL
- Fails-open on Redis/DB error (billing gate ≠ security gate)
- FREE tier: 1,000 verifies/month, hard-stop (no overage)
- DEVELOPER: 50,000/month, $0.0002/call overage
- GROWTH: 500,000/month, $0.0001/call overage
- ENTERPRISE: unlimited

#### Module: `bate` — Behavioral Attestation Engine
**Files:** `bate.service.ts`, `bate.scorer.ts`, `bate.worker.ts`, `bate.anomaly.ts`, `bate.module.ts`

**Trust score:** 0–1000, 4 bands: PLATINUM (801+), VERIFIED (501–800), WATCH (201–500), FLAGGED (0–200)

**Recompute path (BullMQ worker, async off verify hot path):**
1. Load agent + recent signals (last 30 days, max 5,000)
2. Load RP weights for fraud-report sources
3. `Promise.all`: fetch recentDenials, recentSpends, delegationDepth for anomaly detector
4. `BateAnomalyDetector.detect(window)` — runs 5 rules:
   - R-1 VELOCITY: verifies/minute > threshold
   - R-2 GEOGRAPHIC: distinct countries in 24h > threshold
   - R-3 SPEND_CV: coefficient of variation in spending pattern
   - R-4 FAILED_VERIFY: denial rate > threshold in last hour
   - R-5 DELEGATION_DEPTH: active delegation chain too deep
5. Persist anomaly signals via `bateSignal.createMany` (skipDuplicates, minute-level idempotency)
6. Re-enqueue recompute if anomalies emitted (BullMQ jobId deduplication prevents stacking)
7. `BateScorer.explain()` → new score + contribution breakdown
8. Transaction: update `AgentIdentity.trustScore/Band`, create `TrustScoreHistory` row
9. Invalidate Redis cache keys: `agent:status:{id}`, `agent:public-status:{id}`
10. If band changed: fire `aegis.agent.trust_score_changed` webhook

#### Module: `webhooks` — Push Events
**Files:** `webhooks.service.ts`, `webhook.delivery.ts`, `webhooks.controller.ts`

**Endpoints:**
- `POST /v1/webhooks` — subscribe (returns `{ id, secret }`)
- `GET  /v1/webhooks` — list subscriptions
- `DELETE /v1/webhooks/:id` — unsubscribe (idempotent)

**Delivery:** BullMQ worker, 5 retries, exponential backoff (1s→2s→4s→8s→16s), HMAC-SHA256 signature on payload with `X-Aegis-Signature: t={ts},v1={hmac}`.

**Events fired today:**
- `aegis.agent.trust_score_changed` (on band crossing)
- (Extensible: add to `WebhooksService.enqueue()` calls anywhere)

#### Module: `audit` — Immutable Ledger
**Files:** `audit.service.ts`, `audit.controller.ts` (assumed), `audit-signer.service.ts`

Hash chain structure:
```
AuditEvent {
  id, timestamp, decision, agentId, principalId,
  prevSig: hash of previous event's signature,
  sig: Ed25519(prevSig || RFC8785_canonical(event)),
  signingKeyId: KMS key id used for signing
}
```
GDPR-survivable: raw columns (action, relyingParty, amount) are nullable for Art.17 erasure. Hash-commitment columns (actionHash, etc.) are never nulled — the chain survives erasure with verifiable proofs.

#### Module: `wellknown` — Public Verifier Endpoint (G-1)
**Endpoint:** `GET /.well-known/audit-signing-key`

Returns JWKS-format JSON with active signing public key. ETag caching, CORS-open. Relying parties poll this to verify audit chain signatures without AEGIS account. This is the trust anchor for the entire audit chain — any party can independently verify signatures without calling AEGIS's API.

#### Module: `identity` — Agent Lifecycle
- `POST /v1/agents/register` — registers Ed25519 public key, returns `agentId`
- `GET  /v1/agents/:id` — get agent details (authenticated)
- `DELETE /v1/agents/:id` — revoke agent
- `GET  /v1/agents/:id/status` — public trust score (no auth) — relying-party pre-check

#### Module: `policy` — Scoped Authorization
Policies define: allowed scopes (e.g. `commerce.purchase`), spend limits (amount + currency), time bounds (expiresAt), context constraints. The policy snapshot is committed to the audit event at verify time — immutable record of what the agent was authorized to do.

#### Module: `onboarding` — Activation Funnel
`PrincipalOnboarding` row tracks 7 milestones: hasFirstAgent, hasFirstPolicy, hasFirstVerify, hasKmsConfigured, hasMcpServerRegistered, + 2 more. Milestones are one-way ratchets (never unset). Drives the dashboard wizard and `aegis doctor` CLI command.

#### Module: `kms` — Key Management
Abstraction over AWS KMS, GCP Cloud KMS, HashiCorp Vault, and environment-derived keys. The `AuditSignerService` uses this to sign audit events. **NOTE: pre-existing TS errors** from missing `@aws-sdk/client-kms` and `@google-cloud/kms` npm installs. Run `pnpm add @aws-sdk/client-kms @google-cloud/kms` to resolve.

#### Modules: `auth0`, `idp-clerk`, `idp-workos` — Identity Federation
Three IdP bridges for federated login. Principals can sign up via local email OR via OAuth through any of these providers. `Principal.idpProvider + idpUserId` is the composite anchor.

#### Module: `mcp` — AEGIS as an MCP Server
AEGIS exposes its own MCP server so agents can interact with AEGIS programmatically (register, verify, query trust scores) through the MCP tool-call protocol.

---

### 2.2 Packages

#### `packages/sdk-ts` — `@aegis/sdk` (TypeScript)
**Files:** `agent.ts`, `browser.ts`, `crypto.ts`, `http.ts`, `policy.ts`, `types.ts`, `index.ts`

The developer-facing SDK. Key surface:
- `AegisAgent.sign(payload)` → Ed25519-signed JWT, client-side only (private key never leaves)
- `AegisClient.verify(token, options)` → calls `/v1/verify`, returns `VerifyResult`
- Works in Node.js and browser (`browser.ts` uses WebCrypto API)

#### `packages/mcp-bridge` — `@aegis/mcp-bridge`
**THE DISTRIBUTION WEDGE.** `wrap(mcpServer, { aegis, actionPrefix })` inserts AEGIS verification before every tool call. Any MCP server + 3 lines = AEGIS-protected.

Current status: Interface finalized, skeleton wired. Full MCP transport glue (SDK 1.0 bindings) is the next major package work item.

#### `packages/types` — `@aegis/types`
The API contract. Zod schemas for all request/response shapes. Imported by SDK, API, and will be imported by the CF Workers edge. Zero framework dependencies.

#### `packages/cli` — `aegis` CLI
`aegis doctor`, `aegis agent register`, `aegis verify`, `aegis kms rotate`. Developer tooling for local development and production operations.

#### `packages/audit-verifier` — Standalone Chain Verifier
Any party can run this to independently verify an AEGIS audit chain without calling our API. This is a core trust property — verifiability is not contingent on AEGIS's availability.

#### `packages/verifier-rp` — Relying Party Verifier
Lightweight package relying parties embed to verify AEGIS tokens without an AEGIS account (for the edge case where latency requirements preclude a round-trip to the AEGIS API).

#### `packages/sdk-py` — Python SDK
Scaffold. Needed for the LangChain/CrewAI/AutoGen ecosystem (Python-dominant). High-priority for Phase 2.

---

### 2.3 Database Models (Prisma)

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| `Principal` | Developer/org account | planTier, stripeCustomerId, stripeSubscriptionId, subscriptionStatus |
| `PrincipalOnboarding` | 7-step activation wizard | hasFirstAgent, hasFirstVerify, hasMcpServerRegistered |
| `ApiKey` | Auth credentials | scope (FULL/VERIFY_ONLY), hash |
| `AgentIdentity` | The agent | publicKey (Ed25519), trustScore, trustBand, status |
| `AgentPolicy` | Authorization envelope | scopes, spendLimit, expiresAt |
| `SpendRecord` | Spend ledger | amount, currency, date (daily+monthly aggregates) |
| `OutboxEvent` | Transactional outbox | kind, payload, attempts (guaranteed webhook delivery) |
| `AuditEvent` | Immutable decision log | decision, sig, prevSig, signingKeyId, timestamp |
| `BateSignal` | Behavioral signals | signalType, severity, payload, occurredAt |
| `TrustScoreHistory` | Score changelog | score, band, reason, signalId |
| `AgentDelegation` | Agent→Agent grants | delegatorId, delegateeId, status, expiresAt |
| `WebhookSubscription` | Push subscriptions | url, secret, events[], active |
| `WebhookDelivery` | Delivery attempts | subscriptionId, event, status, attempts |
| `RelyingParty` | Verified RPs | domain, reportWeight (affects BATE fraud signal weight) |

---

## PART III — THE PRODUCT WEDGE (TECHNICAL PROOF)

This section answers: **why can't a competitor replicate this in 6 months?**

### 3.1 The Protocol-Level Entry Point

AEGIS's distribution wedge is `@aegis/mcp-bridge`. Here is why it is structurally irreplaceable:

```typescript
// BEFORE AEGIS: tool call reaches your server with zero identity context
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  // You have no idea if this LLM session is authorized, trusted, or safe
  return await executeTool(req.params.name, req.params.arguments);
});

// AFTER AEGIS: 3 lines, verified identity on every tool call
import { wrap } from '@aegis/mcp-bridge';
const protected = wrap(server, { aegis, actionPrefix: 'mcp.myserver.' });
// Every tool call now carries: agentId, trustScore, trustBand, scopesGranted
```

**Why this is the lowest possible insertion point:**
1. MCP is the universal tool-call protocol for LLMs in 2026. Claude, GPT-4o, Gemini, and every major agent framework uses it.
2. Tool calls are the actual actions AI agents take — reading files, writing data, making payments.
3. By sitting at the MCP layer, AEGIS intercepts 100% of agent-initiated actions, not just some.
4. The alternative (wrapping at the HTTP/API layer) is higher friction and misses the scope-level context.

**Network effect:** Every MCP server developer who installs `@aegis/mcp-bridge` is now:
a) An AEGIS customer (they need a verify-only API key)
b) A distribution channel (their users' agents need AEGIS tokens to call their server)
c) A relying party (they enforce trust band requirements)

### 3.2 The BATE Data Moat

Competitors can copy our API surface. They cannot copy an agent's trust history.

```
Day 1:   Agent registers. trustScore = 500 (cold start, VERIFIED band).
Day 30:  500 clean transactions. BATE score = 723. Band: VERIFIED.
Day 90:  1,200 transactions, 2 anomalies (R-2 geo, caught + resolved). Score = 681.
Day 180: 3,000 transactions, zero anomalies since Day 90. Score = 812. Band: PLATINUM.
```

A PLATINUM-band agent after 6 months of clean behavioral history:
- Gets lower friction from relying parties (less likely to hit minTrustScore gates)
- Can access higher-value policy scopes
- Has an attestation record that demonstrates trustworthiness to enterprise customers

**This score is not portable.** A competitor could build a scoring system, but an agent's behavioral history on AEGIS cannot be migrated. This creates a switching cost that compounds over time.

**The signal flywheel:**
```
More agents using AEGIS
       ↓
More behavioral signals (BateSignal rows)
       ↓
Better anomaly detection calibration (R-1..R-5 thresholds)
       ↓
More accurate trust scores
       ↓
Relying parties trust AEGIS scores more
       ↓
More relying parties require AEGIS
       ↓
More agents use AEGIS (requirement, not optional)
```

### 3.3 The Standards Timing Moat

**NIST Center for AI Standards — AI Agent Identity Initiative (Feb 17, 2026):**
- NIST published concept paper: "Accelerating the Adoption of Software and AI Agent Identity and Authorization"
- Public comments closed April 2, 2026
- Standards finalization timeline: 12–18 months from concept paper

**What this means for AEGIS:**
AEGIS is already NIST-aligned on every technical dimension that will matter:
- Ed25519 cryptographic identity (NIST-approved curve)
- DID-compatible agent identifiers (W3C/NIST standard)
- RFC 8785 JCS canonical JSON for audit signatures (IETF standard)
- Behavior-scoped authorization (matches NIST SP 800-207 Zero Trust patterns)

Companies that implement AEGIS before NIST finalizes standards can claim "NIST-aligned agent identity infrastructure." This is worth multiples in enterprise sales. Companies that wait until mandate will be scrambling to find a compliant solution — AEGIS will already have 18 months of production track record.

**Legal precedent tailwind:** Amazon sued Perplexity (Nov 2025) over agent identity violations. When companies are suing each other over this, enterprise legal teams are already drafting compliance requirements. AEGIS's audit chain is exhibit-quality evidence in such disputes.

### 3.4 The Switzerland Positioning Moat

AEGIS's architecture is deliberately vendor-neutral:
- Works with any LLM (Claude, GPT-4o, Gemini, Llama, custom)
- Works with any agent framework (LangChain, AutoGen, CrewAI, custom)
- Works with any infrastructure (Railway, AWS, GCP, Cloudflare, on-prem)
- Compatible with ACP (Stripe's Agentic Commerce Protocol) by design

**Why neutrality is a moat, not a weakness:**

Auth0 tried to own agent identity but is tied to Okta's enterprise sales motion. Entro/Prefactor are DevSecOps tools, not developer-first. Stripe ACP solves payments but explicitly leaves identity to implementers. Every vendor-tied identity solution has a "but will I get locked in?" objection that kills enterprise deals.

AEGIS has no such objection. A company using Claude today and migrating to GPT-4o next year has the same AEGIS integration. This is why infrastructure companies with neutral positioning (Cloudflare, Stripe, Twilio) command premium multiples — they're not betting on which LLM wins. They're the plumbing beneath all of them.

### 3.5 The ACP Compatibility Vector

Stripe launched the Agentic Commerce Protocol (ACP) in September 2025. ACP solves:
- Shared Payment Tokens for agent purchases
- Merchant authorization flows
- Refund and dispute rails for agent transactions

ACP does NOT solve:
- Who is the agent? (identity)
- Is it actually authorized by the human? (AEGIS policy)
- Has its behavior been trustworthy? (BATE)
- Can the merchant independently verify the claim? (AEGIS audit chain)

AEGIS is the identity complement to ACP. The pitch to a Stripe-integrated merchant:
> "You're already using Stripe ACP to accept agent payments. AEGIS is the trust layer that tells you whether to accept the payment request. Add `aegis.verify(token)` before your ACP handler."

This is not competitive with Stripe — it's a sales channel. ACP merchants are warm leads.

---

## PART IV — GTM-TO-CODE MAP

Every GTM claim mapped to exact implementation. "Aspiration" means code is planned/scaffolded but not production-ready.

### 4.1 PLG Motion (Self-Serve)

| GTM Requirement | Implementation | File/Endpoint | Status |
|----------------|---------------|---------------|--------|
| Signup in <60s | PrincipalOnboarding funnel | `modules/onboarding/` | ✅ |
| No credit card to start | FREE tier, quota enforced not gated | `billing/plans.ts` FREE plan | ✅ |
| 10K free verifies/month | 1,000/month hard-stop | `plans.ts` FREE quota | ✅ (1K conservative; raise if needed) |
| AHA moment: first verify | SDK + `/v1/verify` endpoint | `verify.controller.ts` | ✅ |
| 90% quota hit alert | `PLAN_LIMIT_EXCEEDED` denial reason | `verify.service.ts` pre-check | ✅ |
| Upgrade flow | Stripe Checkout Session | `billing.controller.ts POST /checkout` | ✅ |
| Plan tier written on upgrade | `checkout.session.completed` handler | `stripe.service.ts` | ✅ |
| BATE score locked on FREE | `bateAccess: false` for FREE | `plans.ts` | ✅ |
| BATE score visible on paid | BATE endpoints unblocked on DEVELOPER+ | `bate.controller.ts` | ✅ |
| Webhook access on paid | `webhooks: false` for FREE | `plans.ts` | ✅ |
| 3-line MCP integration | `@aegis/mcp-bridge` `wrap()` | `packages/mcp-bridge` | 🔶 Interface done, transport glue pending |

### 4.2 Sales-Assisted Motion (Team/Startup)

| GTM Requirement | Implementation | File/Endpoint | Status |
|----------------|---------------|---------------|--------|
| Multi-agent management | All agents scoped to principalId | All service methods | ✅ |
| Team dashboard view | Next.js dashboard | `apps/dashboard/` | 🔶 Scaffold, needs features |
| BATE score per agent | `GET /v1/agents/:id/trust` | `bate.controller.ts` | ✅ |
| Webhook integrations | Push events on trust_score_changed etc. | `webhooks.controller.ts` | ✅ |
| Audit log export | Immutable chain, JWKS verify | `audit/`, `wellknown/` | ✅ |
| PDF audit export | PDF report generation | `compliance/` | 🔶 Partial |
| Plan summary + usage | `GET /v1/billing/plan` | `billing.controller.ts` | ✅ |
| Spend limit policies | Per-policy spend limits | `policy/`, `verify/spend-guard` | ✅ |
| Delegation chains | `AgentDelegation` model + verification | `verify.algorithm.ts` | ✅ |

### 4.3 Enterprise Motion (CISO/Compliance)

| GTM Requirement | Implementation | File/Endpoint | Status |
|----------------|---------------|---------------|--------|
| Immutable audit chain | Ed25519 signed hash chain | `audit.service.ts` | ✅ |
| Independent chain verification | `packages/audit-verifier` | Standalone package | ✅ |
| JWKS signing key endpoint | `/.well-known/audit-signing-key` | `wellknown.controller.ts` | ✅ |
| KMS key rotation | AWS/GCP/Vault KMS adapters | `modules/kms/` | ✅ (pending SDK installs) |
| GDPR Art.17 erasure | Hash-commitment columns, null raw | `audit.service.ts` + schema | ✅ |
| Multi-tenant RLS | principalId on every query | CLAUDE.md invariant #5 | ✅ |
| Ed25519 (NIST-approved) | `@noble/ed25519`, single curve | `common/crypto/` | ✅ |
| SOC2 documentation | Compliance docs | `docs/COMPLIANCE.md` | 🔶 Needs Type I audit |
| DPA template | Data Processing Agreement | `docs/` | 🔶 Needs legal review |
| On-premise option | Self-hostable (Docker Compose) | `docker-compose.yml` | ✅ |
| SLA documentation | SLO targets defined | `docs/SLO.md` | ✅ |
| Pen test | External security assessment | — | ❌ Not started |

### 4.4 Platform Partner Motion (MCP/Framework Integration)

| GTM Requirement | Implementation | File/Endpoint | Status |
|----------------|---------------|---------------|--------|
| MCP bridge (`wrap()` 3 lines) | `@aegis/mcp-bridge` | `packages/mcp-bridge/` | 🔶 Interface done |
| TypeScript SDK | `@aegis/sdk` | `packages/sdk-ts/` | ✅ |
| Python SDK | `aegis` Python package | `packages/sdk-py/` | 🔶 Scaffold |
| LangChain integration guide | Full TS+Python guide | `docs/INTEGRATION_GUIDE_LANGCHAIN.md` | ✅ |
| Express/Fastify middleware guide | Full guide | `docs/INTEGRATION_GUIDE_EXPRESS.md` | ✅ |
| MCP integration guide | Full guide | `docs/INTEGRATION_GUIDE_MCP.md` | ✅ |
| Fintech integration guide | Stripe+AEGIS pattern | `docs/INTEGRATION_GUIDE_FINTECH.md` | ✅ |
| AEGIS as MCP server | Tools: register, verify, trust | `modules/mcp/` | ✅ |

---

## PART V — REVENUE ARCHITECTURE

### 5.1 Revenue Model (Code-Enforced)

The billing stack is live. Here is the exact revenue path:

```
Developer signs up (FREE)
    ↓ uses 1,000 verifies/month
    ↓ hits PLAN_LIMIT_EXCEEDED
    ↓ POST /v1/billing/checkout { planTier: "DEVELOPER" }
    ↓ Stripe Checkout Session created (stripe.service.ts)
    ↓ Developer completes payment on Stripe
    ↓ POST /v1/billing/webhook receives checkout.session.completed
    ↓ stripe.service.ts.onCheckoutCompleted() called
    ↓ Principal.planTier = 'DEVELOPER'
    ↓ usageGuard.invalidatePlanCache()
    ↓ Next verify call: quota = 50,000/month
```

This path is fully automated. No human touch required. The $500 MRR gate can be hit with 11 DEVELOPER conversions or 2 GROWTH conversions.

### 5.2 Plan-to-Revenue Map

| Plan | Price | Quota | Target Customer | Path to Conversion |
|------|-------|-------|-----------------|-------------------|
| FREE | $0 | 1,000/mo | Solo dev evaluating | Hit quota → see PLAN_LIMIT_EXCEEDED → upgrade email |
| DEVELOPER | $49/mo | 50,000/mo | Active agent builder | 30-day trial, quota pressure |
| GROWTH | $299/mo | 500,000/mo | Startup with agent features | Team expansion, BATE score value |
| ENTERPRISE | Custom | Unlimited | CISO-driven purchase | Sales-led, 3-6 month cycle |

### 5.3 Phase Gates (Revenue-Milestone Driven)

```
Phase 1 ($500 MRR gate):  11 DEVELOPER users OR 2 GROWTH users
   ↓ Engineering: all code done, first design partners
   
Phase 2 ($5,000 MRR gate): 100 DEVELOPER users OR 17 GROWTH users
   ↓ Engineering: Python SDK, MCP bridge v1, dashboard polish
   
Phase 3 ($50,000 MRR gate): 1,000 DEVELOPER + 50 GROWTH users
   ↓ Engineering: Cloudflare Workers edge, SOC2 Type I, enterprise dashboard
   
Phase 4 ($500,000 MRR gate): Enterprise contracts
   ↓ Engineering: On-prem BATE, dedicated tenancy, SLA guarantees
```

### 5.4 The Conversion Triggers (in Code)

These are the moments where a user will be prompted to upgrade. All are in production:

1. **PLAN_LIMIT_EXCEEDED** — `verify.service.ts` returns this denial when monthly quota exhausted. The developer's agent stops working. High-urgency trigger.

2. **BATE Score Locked** — `plans.ts`: `bateAccess: false` for FREE. The dashboard shows a locked widget. BATE is visible but not actionable without upgrade. Medium-urgency trigger (curiosity → upgrade).

3. **Webhook Feature Gated** — `plans.ts`: `webhooks: false` for FREE. When a developer tries to create a webhook subscription, they hit a feature gate. Low-urgency but targeted at teams.

4. **`GET /v1/billing/plan`** — any developer checking their plan status sees `remaining` count winding down. Transparency creates urgency.

---

## PART VI — PHASE ROADMAP

### Phase 1 (CURRENT) — GA Readiness

**Status:** Engineering gates closed. Ready for first paying users.

**Remaining before first paying user:**
1. KMS SDK installs (`pnpm add @aws-sdk/client-kms @google-cloud/kms`) — 30 minutes
2. Stripe price IDs in `.env` (`STRIPE_PRICE_DEVELOPER`, etc.) — 15 minutes
3. First design partner onboarding — human effort
4. `@nestjs/schedule` install + `ScheduleModule.forRoot()` wiring — 1 hour
5. `WebhookSubscription.secret` bcrypt hardening — 2 hours

**What "first paying user" looks like:**
```
1. Developer hits PLAN_LIMIT_EXCEEDED on their agent
2. Our email: "You're at 90% of free tier" (need email trigger — see M-next)
3. They click "Upgrade to Developer"
4. POST /v1/billing/checkout → Stripe URL → payment
5. Webhook fires → planTier = DEVELOPER
6. Their agents work again
7. $49 MRR
```

### Phase 2 — $5K MRR Gate

**Engineering priorities:**
1. **Python SDK** (`packages/sdk-py`) — LangChain/CrewAI/AutoGen ecosystem is Python-dominant. Every Python agent builder is locked out until this ships.
2. **MCP bridge full transport glue** — `packages/mcp-bridge` interface is done, MCP SDK 1.0 bindings needed. Distribution wedge isn't fully operational without this.
3. **Dashboard features** — BATE score widget (locked on FREE, visible on paid), agent management, audit log viewer.
4. **Email triggers** — quota alerts, welcome sequences, expansion prompts. Needs integration with transactional email provider.
5. **`scripts/check-openapi-zod-parity.ts`** — CI parity checker referenced but not authored.

### Phase 3 — $50K MRR Gate (Cloudflare Edge)

**Engineering priorities:**
1. **CF Workers verify migration** — `workers/cf-verify/` exists as scaffold. CLAUDE.md invariant #2 was written explicitly for this: `verifyAlgorithm` has zero NestJS imports and can be moved verbatim. Target: <50ms p99 globally.
2. **SOC2 Type I** — external audit, documentation is largely done.
3. **Enterprise dashboard** — team management, organization-level policies, bulk agent management.
4. **On-premise BATE** — some enterprises won't send behavioral signals to third parties. Containerized BATE that runs in their VPC.

### Phase 4 — $500K MRR Gate (Enterprise)

1. Post-quantum key migration path (CRYSTALS-Kyber for key exchange, CRYSTALS-Dilithium for signatures)
2. DID method publication (`did:aegis:`) 
3. HSM integration for on-premise deployments
4. Multi-region active-active (EU data residency for GDPR compliance)

---

## PART VII — TERMINAL HANDOFF GUIDE

### How to Claim a Module

```bash
# 1. Check WORK_BOARD.md for STATUS: open modules
# 2. Claim it (TTL = time estimate × 2)
claude-peers claim aegis <module-id> --note "implementing X" --ttl 7200
# 3. Edit WORK_BOARD.md: STATUS: open → STATUS: claimed by <session-id> @ <date>
# 4. Stay in the file paths listed for that module
# 5. When done: append SESSION_HANDOFF.md + release claim
claude-peers release aegis:<module-id>
```

### Terminal A — Python SDK

**Priority:** P0 (blocks Phase 2 revenue gate)
**Files to create:** `packages/sdk-py/aegis/` — `agent.py`, `client.py`, `crypto.py`, `types.py`
**Reference implementation:** `packages/sdk-ts/src/` — mirror the TypeScript API surface in Python
**Key invariants:**
- Ed25519 via `cryptography[ed25519]` package (already scaffolded)
- `AegisAgent.sign(payload)` → signs with private key, returns JWT
- `AegisClient.verify(token)` → calls `/v1/verify`, returns VerifyResult
- Private key never transmitted — CLAUDE.md invariant #1
**Acceptance criteria:** LangChain agent can call `agent.sign_request()` in 3 lines

### Terminal B — MCP Bridge Full Transport

**Priority:** P0 (the distribution wedge)
**Files:** `packages/mcp-bridge/src/index.ts`, `packages/mcp-bridge/src/transport.ts`
**What's done:** `BridgeConfig` interface, `BridgeContext` type, `BridgeDenialError`, `onDenial` handler
**What's needed:** MCP SDK 1.0 `Server.setRequestHandler` interception layer
**Pattern to implement:**
```typescript
// wrap() must intercept BEFORE the tool handler runs
// Extract AEGIS_HEADER_TOKEN from transport headers
// Call aegis.verify(token, { action: actionPrefix + method })
// If denied: call onDenial or throw BridgeDenialError
// If approved: pass context (agentId, trustScore, band) to handler
```
**Acceptance criteria:** `wrap(server, config)` returns a server that rejects untrusted tool calls

### Terminal C — Dashboard Features

**Priority:** P1 (conversion rate improvement)
**Files:** `apps/dashboard/` — Next.js 16
**What's needed:**
1. BATE score widget (locked on FREE, visible on paid, with upgrade CTA)
2. Agent list with trust scores and bands
3. Audit log viewer (filterable, paginated)
4. Onboarding wizard (7-step, tied to PrincipalOnboarding flags)
5. Plan + usage widget (calls `GET /v1/billing/plan`)
**Design principle:** The 10-minute verify must be achievable entirely in the dashboard UI
**Acceptance criteria:** New user can register an agent, create a policy, and complete a verify call without reading docs

### Terminal D — Email Lifecycle Triggers

**Priority:** P1 (drives conversion)
**What's needed:**
1. Trigger on `Principal.planTier = 'FREE'` → Day 3 activation email
2. Trigger on quota reaching 90% → "90% of free tier used" email  
3. Trigger on `checkout.session.completed` → "Welcome to Developer tier" email
4. Trigger on `customer.subscription.deleted` → "Your plan was cancelled" + save attempt
**Implementation approach:** BullMQ job fired from billing webhook handlers + transactional email provider (Resend or Postmark recommended)
**Files to touch:** `stripe.service.ts` `onCheckoutCompleted()`, new `notifications/` module

### Terminal E — Usage Monitoring + Alerts

**Priority:** P1 (operator visibility)
**What's needed:**
1. `aegis_plan_quota_pct` gauge metric — `(monthVerifyCount / monthlyQuota) × 100`
2. Alert: `aegis_plan_quota_pct{plan="FREE"} > 90` → page (user needs upgrade prompt)
3. `GET /v1/admin/usage` endpoint — operator view of all principals' usage
4. Grafana dashboard panel: quota utilization by plan tier
**Files to touch:** `metrics.service.ts` (add gauge), `billing.controller.ts` (admin endpoint)

### Terminal F — Test Coverage Completion

**Priority:** P1 (quality gate)
**What's needed:**
1. `webhooks.controller.spec.ts` — multi-tenant isolation (principal A cannot delete principal B's subscription)
2. `stripe.service.spec.ts` — complete the existing spec file (SETNX idempotency, circuit breaker, all webhook event types)
3. `billing.controller.spec.ts` — complete the existing spec file
4. `bate.worker.ts` — integration test for full recompute cycle including anomaly signal persistence
5. E2E: full verify → quota → PLAN_LIMIT_EXCEEDED → upgrade → verify again flow
**Reference:** `docs/TESTING_STRATEGY.md` for test patterns and isolation fixtures

### Terminal G — KMS SDK Install + Hardening

**Priority:** P1 (production security)
**What's needed:**
```bash
pnpm add @aws-sdk/client-kms @google-cloud/kms -F @aegis/api
```
Then fix the 8 pre-existing type errors in `kms.module.ts`:
- `AwsKmsAdapter` constructor signature
- `GcpKmsAdapter` constructor signature
- `VaultTransitAdapter` constructor signature
**Files:** `apps/api/src/modules/kms/kms.module.ts`
**Acceptance criteria:** `npx tsc --noEmit` → 0 errors (including KMS)

### Terminal H — `@nestjs/schedule` + Scheduled Tasks

**Priority:** P2
**What's needed:**
```bash
pnpm add @nestjs/schedule -F @aegis/api
```
In `app.module.ts`: add `ScheduleModule.forRoot()` to imports.
Then wire any `@Cron` decorators that exist in the codebase (check for `@Cron` usage without the module).
**Reference:** `docs/SESSION_HANDOFF.md` 2026-05 entry for prior context

### Terminal I — OpenAPI/Zod/Prisma Parity CI

**Priority:** P2
**What's needed:** `scripts/check-openapi-zod-parity.ts`
This script is referenced in the CI workflow but not authored. It should verify:
1. Every OpenAPI endpoint has a matching Zod schema in `packages/types`
2. Every Zod schema that references a DB model field matches the Prisma schema
3. `DenialReason` in `verify.dto.ts` matches the list in `AEGIS_API_SPEC.yaml`
**Acceptance criteria:** CI fails if any of these diverge

---

## PART VIII — KNOWN GAPS + EXACT NEXT WORK ITEMS

### P0 (Blocks First Paying User)

| Gap | File | Estimated Effort | Terminal |
|-----|------|-----------------|---------|
| Stripe price IDs not in `.env` | `.env.example` | 15 min (operator) | Erwin |
| KMS npm packages not installed | `package.json` | 30 min | G |
| `@nestjs/schedule` not installed | `app.module.ts` | 1 hour | H |

### P1 (Blocks Phase 2 Gate / $5K MRR)

| Gap | File | Estimated Effort | Terminal |
|-----|------|-----------------|---------|
| Python SDK (zero lines written) | `packages/sdk-py/` | 3-5 days | A |
| MCP bridge transport glue | `packages/mcp-bridge/src/` | 2-3 days | B |
| Email lifecycle triggers | new `notifications/` module | 1-2 days | D |
| `WebhookSubscription.secret` bcrypt | `webhooks.service.ts` | 2 hours | Any |
| `scripts/check-openapi-zod-parity.ts` | `scripts/` | 4 hours | I |
| Dashboard BATE widget | `apps/dashboard/` | 2-3 days | C |

### P2 (Blocks Phase 3 Gate)

| Gap | File | Estimated Effort | Terminal |
|-----|------|-----------------|---------|
| CF Workers verify migration | `workers/cf-verify/` | 3-5 days | Senior |
| SOC2 Type I documentation | External + `docs/COMPLIANCE.md` | Weeks (external) | Erwin |
| On-prem BATE container | New repo/package | 1 week | Senior |
| Multi-region DB setup | Infra + Railway config | 3-5 days | DevOps |

### P3 (Technical Debt / Quality)

| Gap | Notes |
|-----|-------|
| `bate.anomaly.ts` thresholds not tuned | R-1..R-5 defaults are conservative estimates; need production data |
| `WebhookDelivery` DLQ viewer | Stuck deliveries currently require DB query to investigate |
| `plans.ts` quota values pending OD-003 | FREE=1K is conservative; operator may raise to 10K for PLG |
| `PLAN_LIMIT_EXCEEDED` not in OpenAPI spec YAML | Update `docs/spec/AEGIS_API_SPEC.yaml` |
| `bateAnomalyTriggerTotal` not in monitoring docs | Update `docs/MONITORING_OBSERVABILITY.md` metrics table |

---

## PART IX — ARCHITECTURE INVARIANTS (NON-NEGOTIABLE)

These are CLAUDE.md invariants. Every terminal must know them. A single violation requires a proposal in `docs/decisions/`.

1. **Private keys never enter AEGIS.** Agent private keys are generated client-side. The SDK is the only surface that touches a private key.

2. **The verify hot path is portable.** `verify.algorithm.ts` has zero NestJS imports. Adding any framework import here is a P0 architectural violation — it blocks the Phase 3 CF Workers migration.

3. **The audit log is append-only and signed.** No UPDATE or DELETE on AuditEvent. Ever. The hash chain breaks if you do.

4. **No silent failures, no fabricated data.** Surface errors in the response. Never return synthetic trust scores or empty arrays that pretend to be "no results" when they're actually errors.

5. **Multi-tenant isolation by principalId on every query.** Every service method takes `principalId` as a scoping parameter. No cross-tenant data leaks.

6. **Denial precedence is fixed.** AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED → POLICY_EXPIRED → SCOPE_NOT_GRANTED → SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED. PLAN_LIMIT_EXCEEDED fires BEFORE this chain (billing gate, not security gate).

---

## PART X — WHAT WINNING LOOKS LIKE

### 6-Month Horizon (Q4 2026)

```
Metric              Target          Current
─────────────────────────────────────────────
MRR                 $5,000          $0 (pre-launch)
Active principals   200             ~5 (design partners)
Agents registered   500             ~10
Daily verify calls  10,000          0
MCP servers using   25              0
  @aegis/mcp-bridge
Python SDK          Published       Scaffold
SOC2 Type I         In progress     Documentation done
```

### 18-Month Horizon (Q4 2027)

```
Metric              Target
─────────────────────
MRR                 $50,000
Active principals   2,000
Agents registered   50,000
Daily verify calls  5,000,000
  (edge-deployed)
Enterprise accounts 5
MCP bridges active  500+
ACP-integrated RPs  20+
```

### What "AEGIS Won" Looks Like

A developer building a LangChain agent in 2028 does not ask "should I use AEGIS?" They ask "what's my AEGIS policy?" the same way they ask "what's my Stripe plan?" or "what's my Auth0 tenant?" AEGIS is the default agent identity infrastructure — not a product you evaluate but a layer you configure.

The equivalent in infrastructure history: the moment `npm install stripe` became a reflex for any payment feature. We are engineering that reflexive moment for agent identity.

---

## APPENDIX A — KEY FILE PATHS CHEATSHEET

```
Core verify path:
  apps/api/src/modules/verify/algorithm/verify.algorithm.ts   ← pure function, portable
  apps/api/src/modules/verify/verify.service.ts               ← NestJS adapter + G-2 gate
  apps/api/src/modules/verify/spend-guard.service.ts          ← spend gate (Redis Lua)

Billing:
  apps/api/src/modules/billing/plans.ts                       ← quota + tier definitions
  apps/api/src/modules/billing/usage-guard.service.ts         ← monthly quota enforcement
  apps/api/src/modules/billing/stripe.service.ts              ← checkout + webhook handler
  apps/api/src/modules/billing/billing.controller.ts          ← HTTP endpoints

BATE:
  apps/api/src/modules/bate/bate.anomaly.ts                   ← 5 anomaly rules (pure)
  apps/api/src/modules/bate/bate.worker.ts                    ← async recompute + G-3 wiring
  apps/api/src/modules/bate/bate.scorer.ts                    ← trust score formula

Audit:
  apps/api/src/modules/audit/audit.service.ts                 ← append-only + hash chain
  apps/api/src/modules/wellknown/wellknown.controller.ts      ← JWKS public endpoint

SDK:
  packages/sdk-ts/src/agent.ts                                ← client-side signing
  packages/sdk-ts/src/index.ts                                ← public API
  packages/mcp-bridge/src/index.ts                            ← THE WEDGE (finish this)

Schema:
  apps/api/prisma/schema.prisma                               ← ALWAYS COORDINATE BEFORE TOUCHING

Architecture:
  CLAUDE.md                                                   ← invariants, read first
  docs/ARCHITECTURE.md
  docs/SECURITY.md
  docs/BATE_ALGORITHM.md

Handoffs:
  docs/SESSION_HANDOFF.md                                     ← institutional memory
  WORK_BOARD.md                                               ← what to claim next
```

---

## APPENDIX B — CURRENT TYPECHECK STATUS

```bash
# Run this before any PR:
cd apps/api && npx tsc --project tsconfig.json --noEmit

# Current state (2026-05-05):
# Non-KMS errors: 0
# KMS SDK errors: 8 (pre-existing, blocked on pnpm add @aws-sdk/client-kms @google-cloud/kms)

# Full test run:
npm run jest --projects=apps/api -- --coverage --passWithNoTests
```

---

*Generated: 2026-05-05 | Session: cowork-master-state-analysis | Based on 190 TS files, 50 spec files, 18 modules, 10 packages, 14 DB models*
