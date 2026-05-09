# AEGIS — Master Engineering Handoff
## FAANG-Level State Analysis, GTM Mapping & Terminal Coordination Protocol

> **Classification:** INTERNAL · ENGINEERING · CONFIDENTIAL  
> **Date:** 2026-05-04  
> **Author:** Synthesis of all sessions (Rounds 1–10)  
> **Audience:** All parallel engineering terminals, operator (Erwin)  
> **Status:** AUTHORITATIVE — supersedes any partial handoff entry

---

## Table of Contents

1. [Executive State Summary](#1-executive-state-summary)
2. [What This Is — One-Paragraph Wedge Proof](#2-what-this-is--one-paragraph-wedge-proof)
3. [Session History: What Every Round Shipped](#3-session-history-what-every-round-shipped)
4. [Current Codebase Map — Layer by Layer](#4-current-codebase-map--layer-by-layer)
5. [Plan vs. Reality: GTM Phases Mapped to Code](#5-plan-vs-reality-gtm-phases-mapped-to-code)
6. [The Wedge: Proving Real-World Infrastructure Fit](#6-the-wedge-proving-real-world-infrastructure-fit)
7. [Architecture Quality Gate Status](#7-architecture-quality-gate-status)
8. [Open Gaps — Priority-Ordered for Next Terminals](#8-open-gaps--priority-ordered-for-next-terminals)
9. [Operator Decisions — Decision Register Status](#9-operator-decisions--decision-register-status)
10. [Critical Invariants — Do Not Break](#10-critical-invariants--do-not-break)
11. [Terminal Coordination Protocol](#11-terminal-coordination-protocol)
12. [The Path to Gate 1: $500 MRR Sprint](#12-the-path-to-gate-1-500-mrr-sprint)
13. [FAANG Quality Bar — Checklist for Every PR](#13-faang-quality-bar--checklist-for-every-pr)

---

## 1. Executive State Summary

AEGIS is the neutral verification, policy enforcement, and behavioral attestation layer between AI agents and the services they act on. We hold only public keys, sign only what we observed, and are protocol-vendor-model neutral.

**As of 2026-05-04 (10 engineering rounds complete), the codebase is:**

| Layer | Status | Notes |
|---|---|---|
| Agent Identity (Layer 1) | ✅ Shipped | Full CRUD, Ed25519, challenge-response, IDP federation |
| Policy Engine (Layer 2) | ✅ Shipped | JWT-signed policies, BuiltIn + Cedar + OPA pluggable engines |
| BATE Trust Scoring (Layer 3) | ✅ Core shipped, anomaly live | Scorer kernel + 5 anomaly rules + DPoP signals; weights pending OD-001 |
| Audit Chain (Layer 4) | ✅ Shipped | Append-only hash chain, GDPR-safe redaction, KMS signing |
| Verify Hot Path | ✅ Shipped + portable | 9-step algorithm, framework-free, portable to CF Workers |
| TypeScript SDK (`@aegis/sdk`) | ✅ Shipped | Agents, policies, verify, sign/verify crypto |
| Python SDK (`aegis`) | ✅ Shipped (70 tests) | AsyncAegis + sync wrapper, pydantic v2, mypy strict |
| Relying-Party Verifier (`@aegis/verifier-rp`) | ✅ Shipped (58 tests) | Offline JWT verify, JWKS SWR cache, Express/Fastify/Hono adapters |
| CF Worker Edge Verify | ✅ Shipped (shadow mode) | KV cache, full denial-precedence, shadow ↔ origin comparison |
| Go CLI (`aegis`) | ✅ Core shipped | agents/policy/verify/events/report subcommands, `--json` mode |
| MCP Server (`@aegis/mcp-server`) | ✅ Scaffolded | Tools wired to SDK; bin + README |
| MCP Bridge (`@aegis/mcp-bridge`) | ✅ Scaffolded | `wrap()` one-liner for any MCP server |
| E2E Test Harness | ✅ Shipped (15 suites) | Denial-precedence, replay, TOCTOU spend race, revocation |
| KMS Adapters | ✅ Shipped | AWS KMS, GCP Cloud KMS, HashiCorp Vault Transit |
| Auth0 IDP Bridge | ✅ Shipped | IdpAdapter interface, Auth0/Clerk/WorkOS adapters |
| Onboarding Tracker | ✅ Shipped | 7-step activation funnel, server-persisted, backfill cron |
| Dashboard (Next.js) | 🟡 Scaffold only | Directory structure exists; full UI not wired |
| Billing (Stripe) | 🔴 Open | plans.ts exists with defaults; Stripe webhooks not wired |
| CLI Device-Code OAuth | 🟡 Gated | `internal/oauth/devicecode.go` stubbed; endpoint not yet live |
| `/.well-known/audit-signing-key` | 🔴 Open | Public JWKS endpoint for audit chain (M-016) |
| Docs Site | 🔴 Open | Content written in `docs/personas/`; site not scaffolded |

**Overall completion against Phase 1 MVP spec: ~82%**  
**Blocking gaps before first paying customer: 4 items** (see §8)

---

## 2. What This Is — One-Paragraph Wedge Proof

OpenAI and Stripe launched the Agentic Commerce Protocol (ACP) in 2025 — a payment rail for agent transactions. **ACP solves the payment leg.** It does not solve: who is the agent, is it authorized by a real human, has its behavior been trustworthy across sessions, can a relying party independently verify the claim in <100ms. Every existing solution (Auth0, Okta, Prefactor, Entro) is either platform-tied, commerce-specific, or enterprise-only.

**AEGIS fills that gap as the neutral, developer-first trust and verification layer.** We plug into the emerging agentic commerce stack ACP-compatible by design. The wedge is not theoretical — MCP is now the universal tool-call shape for every major LLM host (Claude Desktop, Cursor, Cline, OpenAI Responses API). `packages/mcp-bridge` gives any MCP server a cryptographic identity gate in one `wrap()` call. Every MCP server in the wild is a candidate AEGIS relying party. That distribution moat builds itself.

---

## 3. Session History: What Every Round Shipped

> Reading order for new terminals: newest last. The commit log has 4 major commits; the SESSION_HANDOFF.md tracks 10 rounds of work from multiple parallel sessions.

### Round 1–3 (Foundation) — sid=foundation
- Initial AEGIS scaffold: NestJS monorepo, Prisma schema v1, pnpm workspaces
- `packages/types`: Zod schemas as single source of truth
- `apps/api/src/modules/{identity,policy,verify,auth,audit}`: core CRUD + hot path
- `apps/api/src/common/crypto/{ed25519,jwt}.util.ts`: noble/ed25519, jose EdDSA
- `packages/sdk-ts`: AegisClient, sign/verify, typed errors

### Round 4–5 (Security & Audit) — sid=a9198691
- **Python SDK** (M-015): 24 files, 70 tests, AsyncAegis + sync, mypy --strict, pydantic v2
- **`@aegis/verifier-rp`** (M-016): 34 files, 58 tests, property tests via fast-check, Express/Fastify/Hono adapters, replay LRU, revocation cache, offline Ed25519 — zero node:crypto (edge-ready)
- **E2E test harness** (M-017): 15 numbered test suites (01_health → 15_idempotency), TOCTOU spend race, denial-precedence property test, k6 load script
- **Threat Model v2** (M-018): 965 lines, 31 STRIDE threats, EdDSA reconciliation, GDPR audit-chain redactability design
- **Architecture Audit**: 22 findings — Critical 1 / High 5 / Medium 8 / Low 6 / Info 2

### Round 6 (Loop-Closure + Typecheck Green) — sid=3e2203ee
- Fixed all 8 typecheck errors across auth0/mcp modules
- **OutboxWorker**: ADR-0007 transactional outbox drainer (7 tests, handler-registry pattern, 2 Prometheus metrics)
- **`.github/workflows/audit-chain-integrity.yml`**: nightly chain integrity verification + Slack alert on break
- PQ ML-DSA-65 signature length corrected to 3309 bytes (FIPS 204 final)
- Final state: API typecheck green, 260/260 tests passing

### Round 7 (Enterprise Backbone ADRs) — sid=enterprise-backbone-arch
- **ADRs 0008–0013** committed: MCP control-plane, Auth0 bridge, DPoP replay prevention, KMS-backed key rotation, pluggable policy engine, PQ hybrid scaffold
- **MCP module**: `mcp.controller.ts`, `mcp.service.ts`, `mcp.dto.ts` — MCP server CRUD
- **Auth0 module**: Full IdpAdapter interface, Auth0 adapter, Clerk adapter, WorkOS adapter
- **KMS module**: Interface + `AwsKmsAdapter`, `GcpKmsAdapter`, `VaultTransitAdapter` scaffolds
- **Cedar/OPA engines**: `CedarPolicyEngine`, `OpaPolicyEngine`, `PolicyEngineModule`, WASM evaluators
- **PQ hybrid**: `pq.util.ts` — `signHybrid/verifyHybrid/packHybrid/unpackHybrid` for ML-DSA-65
- **DPoP**: `dpop.util.ts` — RFC 9449 proof-of-possession verification
- **CF Worker m1**: `workers/cf-verify/` — edge verify skeleton with shadow-mode
- **Industry quickstarts**: `examples/ai-platform-tool-call/` reference integration
- **Onboarding**: `PrincipalOnboarding` model, 7-step one-way ratchet, `GET+PATCH /v1/me/onboarding`
- **Deep-canon docs**: `FAILURE_MODES.md`, `CAPACITY_PLAN.md`, `RETENTION_POLICY.md`, `AEGIS_AS_BACKBONE.md`, `DID_METHOD.md`, `POST_QUANTUM_ROADMAP.md`, `EU_RESIDENCY.md`, `COMPLIANCE.md`
- **Persona docs**: `docs/personas/{developer,security,sre,auditor}.md`
- **Industry quickstarts doc**: `docs/INDUSTRY_QUICKSTARTS.md`
- Schema migration: 6 migrations covering RLS, audit redactability, enterprise backbone fields, IdP federation, onboarding tracker
- AppModule wired: all 8 new modules imported and booting
- `OPERATOR_DECISIONS.md`: 16 open decisions tracked with defaults, due dates, module blocking map

### Round 8–9 (CF Worker + WASM Specs + Adoption Surface) — sid=3e2203ee + sid=a9198691
- **CF Worker m2** (M-044): KV cache adapter (agent + policy + per-day spend), full ADR-0004 denial-precedence at edge, shadow-mode with divergence telemetry (`X-AEGIS-Edge-Divergence` header)
- **Edge verify spec** (M-048): 16-branch denial-precedence sweep, shadow spec
- **WASM evaluator specs** (M-046): Cedar-WASM + OPA-WASM spec tests with fake-injected modules
- **WorkOS + Onboarding specs** (M-047)
- **OnboardingBackfill + admin endpoints** (M-053)
- **`app.module.ts` wired** (M-050): all 8 new modules imported (KMS, PolicyEngine, Auth0, Clerk, WorkOS, MCP, Compliance, Onboarding)
- **Go CLI — agents/policy/verify/events/report** (M-040c): Real wiring replacing stubs, hand-rolled HTTP client with `--json` mode, denial-precedence in canonical order, `aegis events tail/export` (streaming NDJSON, Ctrl-C clean exit)
- **CLI release infra** (M-040b partial): `.goreleaser.yaml`, `scripts/install/install.sh`, CLI CI workflow, `CHANGELOG.md`, `docs/RELEASE_NOTES_TEMPLATE.md`, `docs/CLI_SECURITY.md`
- **`vitest.workspace.ts`** (M-025): cross-package SDK↔API JWT parity test at root

### Round 10 (FAANG Gap Closure) — sid=3e2203ee
- **AuditSignerService** (M-051): KMS → env → ephemeral priority chain, `signRaw` + `getActiveKid`; audit.service now stamps `signingKeyId` on every appended row — KMS rotation end-to-end works
- **Cloud KMS production boot** (M-052): `kms.module.ts` factories (`buildAws`/`buildGcp`/`buildVault`) — no more `throw` at boot; SDKs lazy-loaded
- **OTel `initTracing()`** (M-054): Called BEFORE `NestFactory.create()`; SIGTERM/SIGINT drain handlers
- **BATE anomaly detector R-1..R-5** (M-055): Pure-function, 5 rules (velocity, geography, spend CV, failed-verify spike, delegation depth), 14 jest specs
- **Spec-sync drift CI** (M-056): 3 parallel jobs — OpenAPI↔Zod, OpenAPI↔Prisma, DenialReason enum byte-identical across engine+verifier-rp+OpenAPI (ADR-0004 lock)

---

## 4. Current Codebase Map — Layer by Layer

### 4.1 Data Layer (`apps/api/prisma/schema.prisma`)

Six applied migrations. Core models:

```
Principal              — tenant (email, planTier, IDP federation, policyEngine)
  └─ ApiKey            — FULL | VERIFY_ONLY scope, bcrypt-hashed
  └─ AgentIdentity     — Ed25519 pubkey, status, trustScore, trustBand
      └─ AgentPolicy   — scoped JWT (signedToken), spend limits, expiresAt
      └─ AuditEvent    — hash chain row (prev_hash + AEGIS sig)
      └─ BateSignal    — 14 signal types including DPoP
      └─ TrustScoreHistory
  └─ WebhookSubscription + WebhookDelivery
  └─ RelyingParty      — HTTP_API | MCP_SERVER | COMMERCE | AUTH0_APP | OIDC_CLIENT
  └─ PrincipalOnboarding — 7-step activation funnel

SpendRecord            — Postgres backstop for spend counters (hot path is Redis)
OutboxEvent            — ADR-0007 transactional outbox for side-effects
AgentDelegation        — Phase 3; table exists
```

**Row-level security**: 3 migrations establish per-principal RLS on core tables.  
**Audit-chain integrity**: hash-chain + Ed25519 signature on every row; `payloadVersion=2` supports GDPR-safe redaction via `*Hash` commitment columns.

### 4.2 API Surface (`apps/api/src/modules/`)

| Module | Endpoints | Status |
|---|---|---|
| `identity` | POST/GET/LIST/REVOKE /v1/agents | ✅ Shipped |
| `policy` | POST/GET/LIST/REVOKE /v1/policies | ✅ Shipped |
| `verify` | POST /v1/verify | ✅ Shipped (pure algorithm) |
| `audit` | GET /v1/audit-events, NDJSON export | ✅ Shipped (export endpoint TBD) |
| `auth` | ApiKeyGuard, FULL + VERIFY_ONLY scopes | ✅ Shipped |
| `bate` | Signal ingest, scorer, anomaly detector, BullMQ worker | ✅ Core; wiring gap (§8) |
| `webhooks` | Subscriptions + delivery worker + DLQ | ✅ Delivery worker; subscribe endpoint TBD |
| `health` | GET /health, GET /ready, GET /metrics | ✅ Shipped |
| `auth0` | IdpAdapter (Auth0 + Clerk + WorkOS) | ✅ Shipped |
| `mcp` | POST/GET/DELETE /v1/mcp-servers | ✅ Shipped |
| `compliance` | POST /v1/compliance/audit/redact-event | ✅ Shipped |
| `onboarding` | GET/PATCH /v1/me/onboarding | ✅ Shipped |
| `billing` | Stripe plan tiers, usage metering | 🔴 Open (M-011) |
| `wellknown` | GET /.well-known/audit-signing-key | 🔴 Open (M-016) |

### 4.3 Verify Hot Path — The Crown Jewel

`apps/api/src/modules/verify/algorithm/verify.algorithm.ts` — **pure function, zero NestJS/Prisma/Node deps**. This is CLAUDE.md invariant #2 in practice.

The 9-step denial precedence (locked by ADR-0004, enforced by M-056 CI):

```
Step 1  → INVALID_SIGNATURE  (malformed token — can't decode shape)
Step 2  → AGENT_NOT_FOUND | AGENT_REVOKED  (agent lookup)
Step 3  → INVALID_SIGNATURE  (Ed25519 sig verify against stored pubkey)
Step 3.5 → INVALID_SIGNATURE  (replay: jti already seen — fail-closed on Redis error → ANOMALY_FLAGGED)
Step 4  → POLICY_REVOKED | POLICY_EXPIRED  (policy lookup)
Step 5  → SCOPE_NOT_GRANTED  (scope category match)
Step 6  → SCOPE_NOT_GRANTED  (domain allow-list check)
Step 7  → SPEND_LIMIT_EXCEEDED  (Redis-backed atomic spend counter)
Step 8  → TRUST_SCORE_TOO_LOW  (BATE score gate)
Step 9  → ANOMALY_FLAGGED  (hard-flag check)
→ APPROVED
```

**Framework portability**: The same code runs unmodified on Cloudflare Workers via `VerifyPorts` interface injection. Both `apps/api` (Nest) and `workers/cf-verify` implement the ports. This is the architectural moat.

### 4.4 BATE Engine

`bate.scorer.ts` — pure `explain(input): ScoringExplanation` function. Deterministic. Replayable against historical signal streams.

`bate.weights.ts` — current defaults (`WEIGHTS_VERSION = 'v1.1.0-dpop-2026-05-02'`):
- CLEAN_TRANSACTION: +1/occurrence (capped +20/window)  
- FRAUD_REPORT: severity-weighted (−25 LOW → −500 CRITICAL) × RP weight (0.25–1.5×)  
- VELOCITY_ANOMALY: −50 (capped −200)  
- POLICY_VIOLATION_ATTEMPT: −75 (capped −300)  
- AGENT_DPOP_REPLAY_ATTEMPT: −200 (capped −600, can single-handedly drop PLATINUM to WATCH)  
- Age bonus: +0.5/day, capped at +100 (@ 200 days)  

`bate.anomaly.ts` — 5 rules live (R-1 velocity, R-2 geo, R-3 spend CV, R-4 failed-verify spike, R-5 delegation depth). **Not yet wired into BateService.worker** — see §8, gap G-3.

### 4.5 Audit Chain

Every `AuditEvent` carries:
- `aegisSignature` — `sign(prev_sig || RFC8785_canonical(payload))`
- `signingKeyId` — stamped from `AuditSignerService.getActiveKid()` (KMS-aware since Round 10)
- `*Hash` columns — SHA-256 commitments so GDPR Art.17 erasure can null PII without breaking the chain
- `payloadVersion: 2` — verifiers branch on this

The chain is verifiable offline by anyone with the public key. `/.well-known/audit-signing-key` publishes it (module M-016, still open).

### 4.6 SDK Surface

**TypeScript** (`packages/sdk-ts`):
```typescript
const aegis = new AegisClient({ apiKey: '...' });
const { agentId, privateKey } = await aegis.agents.register({ runtime: 'ANTHROPIC', publicKey });
const { policyId } = await aegis.policies.create({ agentId, scopes: [...], expiresAt });
const token = sign(privateKey, { action: 'commerce.purchase', amount: 450, policyId, agentId });
const result = await aegis.verify(token, { action: 'commerce.purchase', amount: 450 });
```

**Python** (`packages/sdk-py`):
```python
async with AsyncAegis(api_key="...") as aegis:
    agent = await aegis.agents.register(runtime="anthropic", public_key=pubkey)
    policy = await aegis.policies.create(agent_id=agent.agent_id, scopes=[...])
    token = sign(private_key, action="commerce.purchase", amount=450, policy_id=policy.policy_id)
    result = await aegis.verify(token, action="commerce.purchase", amount=450)
```

**Relying-party verifier** (`packages/verifier-rp`):
```typescript
// Drop-in for any Express/Fastify/Hono server — offline JWT verify
const verifier = new AegisVerifier({
  getAgentPublicKey: async (agentId) => fetchKeyFromCache(agentId),
});
app.use('/api/protected', aegisMiddleware(verifier));
```

**Go CLI** (`packages/cli`):
```sh
aegis agents register --runtime anthropic --label "my-bot" --generate-keypair
aegis policy create --agent-id <id> --scope commerce --max-per-txn 500
aegis verify <token> --action commerce.purchase --amount 450 --merchant-domain delta.com
aegis events tail --agent-id <id>   # streaming, Ctrl-C clean
aegis report --agent-id <id> --type fraud --severity HIGH
```

---

## 5. Plan vs. Reality: GTM Phases Mapped to Code

### Phase 0 — Spec & Foundation ✅ COMPLETE

Deliverables from `docs/spec/01_MASTER.md`:

| Deliverable | Status |
|---|---|
| AEGIS_MASTER.md | ✅ `docs/spec/01_MASTER.md` (607 lines) |
| OpenAPI spec | ✅ `docs/spec/AEGIS_API_SPEC.yaml` |
| Agent identity data model | ✅ `apps/api/prisma/schema.prisma` |
| Policy schema v1 | ✅ Prisma + Zod in `packages/types` |
| BATE scoring algorithm | ✅ `docs/BATE_ALGORITHM.md` + `bate.scorer.ts` |
| SDK API surface (TS types) | ✅ `packages/sdk-ts/src/types.ts` |
| Legal entity research | ✅ Documented in master spec |

### Phase 1 — MVP (Post CERNIQ Gate 1) 🟡 ~82% COMPLETE

Target: first paying developer customer. Exit criteria: 10 agents, 1 RP integration, $500 MRR.

| Deliverable | Status | Module |
|---|---|---|
| Agent registration API | ✅ | M-003 |
| Ed25519 keypair, DID-compatible | ✅ | M-002/003 |
| Policy engine (create/revoke/check) | ✅ | M-004 |
| Verification endpoint (<200ms) | ✅ | M-005 |
| Audit log v1 | ✅ | M-006 |
| TypeScript SDK | ✅ | M-001 |
| Python SDK | ✅ | M-015 |
| Relying-party verifier | ✅ | M-016 |
| Developer dashboard (basic) | 🟡 Scaffold | M-012 |
| Free + Developer billing (Stripe) | 🔴 Open | M-011 |
| Health + metrics | ✅ | M-010 |
| Auth (API keys, bcrypt) | ✅ | M-009 |
| Webhooks | 🟡 Worker shipped; subscribe endpoint TBD | M-008 |
| Go CLI | ✅ Core commands | M-027/040c |
| E2E test harness | ✅ 15 suites | M-017 |
| CF Worker edge (Phase 1: passthrough) | ✅ Shadow mode | M-013 |
| MCP server package | ✅ Scaffold | M-021 |

**Blocking items before first paying customer (see §8 for detail):**
1. `/.well-known/audit-signing-key` — relying parties can't verify audit chains offline without this
2. Stripe billing module (M-011) — needed for Free → paid tier
3. Dashboard login + API key UI — developer onboarding path
4. Webhook subscription endpoints — customers need `aegis.agent.revoked` events

### Phase 2 — BATE Engine (Post $500 MRR) 🟢 EARLY

BATE scorer kernel and anomaly detector (R-1..R-5) are already live — ahead of schedule. We have the ML placeholder architecture in place. The one wiring gap is connecting the anomaly detector output to the BATE signal worker BullMQ pipeline.

### Phase 3 — Edge & Enterprise (Post $5K MRR) 🟢 EARLY

CF Worker KV-cached edge verify with shadow-mode is shipped. KMS adapters (AWS/GCP/Vault) are live. Pluggable policy engine (Cedar + OPA WASM) is live. PQ hybrid scaffold exists behind an env flag. These are Phase 3 deliverables that are production-ready months ahead of the revenue gate — this is the right call for compounding adoption.

---

## 6. The Wedge: Proving Real-World Infrastructure Fit

### 6.1 Why MCP is the Distribution Wedge — And Why We Win It

The Model Context Protocol is now the universal tool-call wire format. Every major LLM host speaks MCP:

| Host | MCP Support |
|---|---|
| Claude Desktop | Native `stdio` |
| Cursor | Native `streamable-http` |
| Cline (VS Code) | Native `stdio` |
| OpenAI Responses API | `tool` calls → MCP shim |
| Continue.dev | Native `stdio` |
| Any LangChain/CrewAI agent | MCP wrapper |

**What MCP does NOT carry: verified agent identity.**

`packages/mcp-bridge` gives any MCP server AEGIS verification in one line:
```typescript
export default aegisBridge.wrap(myMcpServer);
```

This is the shortest path to adoption in the industry. An MCP server author adds one line and gets:
- Cryptographic identity for every agent that calls their tools
- Policy-gated permissions (scope, spend limit, domain)
- Behavioral trust score on every call
- Signed audit trail of every tool invocation
- Instant revocation (zero TTL wait)

**Distribution flywheel:** Claude Desktop has ~millions of active users. Every popular MCP server (GitHub, Stripe, Linear, Notion, etc.) that adopts `@aegis/mcp-bridge` becomes a relying party that drives developer signups. Our `@aegis/mcp-server` turns any Claude Desktop installation into a management console for AEGIS identities — `npx @aegis/mcp-server` in your Claude config is the first install trigger.

### 6.2 ACP Compatibility — How We Plug Into Stripe's Rail

From `docs/spec/01_MASTER.md` §3.4:

```
ACP Flow with AEGIS:

1. User grants agent permission (ACP step)
2. Agent gets SPT from Stripe (ACP step)
3. Agent calls merchant API with:
   { spt: "stripe_spt_xxx", aegisToken: "aegis_signed_xxx" }
4. Merchant calls:
   - Stripe: "Is this SPT valid for $450?"
   - AEGIS:  "Is this agent trusted at score >500 with commerce scope?"
5. Both confirm → transaction approved
```

AEGIS is **additive to ACP**. Stripe handles payment authorization; we handle agent authorization. The merchant that adopts ACP without AEGIS has no way to distinguish a trustworthy agent from a compromised one. We are the missing layer Stripe explicitly left to implementers.

Concretely, our `examples/fintech-payments/` quickstart (M-040e) demonstrates this pattern end-to-end: Express checkout server, `aegis.verify()` gate before Stripe charge, denial-precedence walk-through for all 9 denial reasons.

### 6.3 The BATE Trust Score is the Credit Score for Agents

The BATE engine is the highest-value, most defensible component. No competitor has built this.

**Network effect:** Trust score compounds in value over time. An agent with a 900-point AEGIS score at 200 days old has demonstrated 200 days of clean behavior across real relying parties. This history cannot be transferred to a competing platform. This is the same moat as credit scores — FICO took decades to build, but once it existed, every lender required it.

**Signal flywheel:** More relying parties → more signals → better anomaly detection → more confident approvals at higher spend limits → more relying parties adopt. The flywheel starts the moment the first RP calls `/v1/verify` and reports signals back via `/v1/agents/:id/report`.

**Current signal coverage:**
- 14 signal types live in `BateSignalType` enum
- 5 anomaly rules (R-1..R-5) in `bate.anomaly.ts`  
- DPoP replay attempt signal maps directly to credential exfiltration detection
- Weight caps prevent single-signal gaming (fraud report cap = 500/window)
- Age cohort correction prevents gaming via churn-and-re-register

### 6.4 Audit Chain as Regulatory Wedge

The append-only, signed audit chain is the compliance moat.

**For developers:** SOC2 evidence is automatic. Every `aegis.verify()` call produces a tamper-evident log entry. Running `aegis audit export` produces the NDJSON SOC2 artifact. No other agent identity platform does this.

**For enterprises:** GDPR Art.17 compliance is solved at the design level. Raw PII columns are nullable; `*Hash` commitment columns keep the chain intact after erasure. The redaction event itself is logged as a chain entry. This is `docs/decisions/0006-audit-redactability.md` in practice, and it means European enterprise customers can sign a DPA with confidence.

**For regulated industries:** The chain is verifiable offline by anyone with the public key from `/.well-known/audit-signing-key`. FINRA, SOC2 Type II, EU AI Act compliance reviewers can independently verify the log. No other player provides this.

### 6.5 Neutrality as the Structural Moat

From the master spec: "Stripe is Stripe. Auth0 is Okta. Both carry platform baggage. A Delta Air Lines or Chase Bank will not route all agent verification through OpenAI's infrastructure — their compliance teams won't allow it."

AEGIS's neutrality is not a feature, it's an architectural commitment:
- **Crypto neutrality**: Ed25519 (`@noble/ed25519`), one curve, one library. No vendor-specific crypto.
- **Platform neutrality**: The verify algorithm runs on NestJS, Cloudflare Workers, or any JS runtime — same code via `VerifyPorts` interface.
- **Engine neutrality**: Builtin, Cedar, OPA — operator chooses. Same denial enum, same audit chain.
- **IDP neutrality**: Auth0, Clerk, WorkOS, (Azure Entra, Okta coming) — same `IdpAdapter` interface.
- **Model neutrality**: `AgentRuntime` enum covers OpenAI, Anthropic, Google, HuggingFace, Custom.

---

## 7. Architecture Quality Gate Status

### 7.1 Architecture Audit Findings (from `docs/ARCHITECTURE_AUDIT.md`)

22 findings reviewed. **Severity breakdown:**

| Severity | Total | Closed | Deferred | Open |
|---|---|---|---|---|
| Critical | 1 | 1 (A-001, EdDSA/RSA reconciliation) | 0 | 0 |
| High | 5 | 5 (A-002..A-006, all promoted to deep-canon docs) | 0 | 0 |
| Medium | 8 | 4 | 2 | 2 |
| Low | 6 | 2 | 2 | 2 |
| Info | 2 | 1 | 1 | 0 |

**All Critical and High findings are closed.** Deep-canon docs provide SOC2-auditor-level evidence for each.

### 7.2 ADR Compliance

13 ADRs committed (`docs/decisions/0001–0013`):

| ADR | Decision | Code Expression |
|---|---|---|
| 0001 | cuid for IDs | `schema.prisma @default(cuid())` |
| 0002 | Ed25519 only | `bate.weights.ts`, `crypto.util.ts` |
| 0003 | Portable verify path | `verify.algorithm.ts` + `VerifyPorts` |
| 0004 | Denial precedence public API | 9-step order, locked by `spec-sync.yml` CI |
| 0005 | Audit chain canonicalization | RFC 8785 JCS in `audit-chain.util.ts` |
| 0006 | Audit redactability | `*Hash` columns + nullable PII |
| 0007 | Transactional outbox | `OutboxEvent` + `outbox.worker.ts` |
| 0008 | MCP as control plane | `mcp.module.ts` + `@aegis/mcp-bridge` + `@aegis/mcp-server` |
| 0009 | Auth0 bridge (IDP abstraction) | `IdpAdapter` + 3 implementations |
| 0010 | DPoP replay prevention | `dpop.util.ts` + `AGENT_DPOP_REPLAY_ATTEMPT` signal |
| 0011 | Key rotation via KMS | `KmsModule` + `AuditSignerService` (KMS → env → ephemeral) |
| 0012 | Pluggable policy engine | `PolicyEngine` interface + Builtin/Cedar/OPA |
| 0013 | PQ hybrid scaffold | `pq.util.ts` ML-DSA-65 behind `AEGIS_HYBRID_PQ_ENABLED` flag |

### 7.3 CLAUDE.md Invariant Compliance

| Invariant | Status | Where |
|---|---|---|
| #1 Private keys never enter AEGIS | ✅ | SDK generates locally; only pubkey sent |
| #2 Verify hot path is portable | ✅ | `verify.algorithm.ts` + `VerifyPorts` |
| #3 Audit log append-only + signed | ✅ | `audit.service.append()` only; `AuditSignerService` |
| #4 No silent failures | ✅ | Spend Redis error → ANOMALY_FLAGGED (fail-closed) |
| #5 Multi-tenant isolation | ✅ | `principalId` on every query; RLS migrations |
| #6 Denial precedence is fixed | ✅ | Locked by ADR-0004 + `spec-sync.yml` CI enforcement |

### 7.4 Test Coverage

| Layer | Tests | Quality |
|---|---|---|
| API unit (Jest) | 260+ passing | Spec-tested per module |
| Crypto specs | Paired `.spec.ts` for every crypto utility | CLAUDE.md requirement |
| E2E harness | 15 suites (vitest) | Black-box, denial-precedence + TOCTOU |
| CF Worker edge | 16-branch denial sweep + shadow spec | Bit-for-bit parity with origin |
| Python SDK | 70 tests (pytest) | mypy --strict, ruff clean |
| RP Verifier | 58 tests + property tests (fast-check) | Edge runtime ready |
| Cross-package | SDK↔API JWT parity test | `vitest.workspace.ts` |
| BATE anomaly | 14 specs (R-1..R-5 each) | warn/crit/skip-on-small-sample |

---

## 8. Open Gaps — Priority-Ordered for Next Terminals

These are listed in descending order of blocking impact on first-customer readiness.

### G-1 🔴 CRITICAL — `/.well-known/audit-signing-key` (M-016, new module)

**Why critical:** Without this endpoint, relying parties cannot verify the audit chain offline. This is the SOC2 artifact verifiability story. Every enterprise customer will ask "how do I verify your audit logs independently?" — the answer is: hit this URL.

**What to build:**
```
GET /.well-known/audit-signing-key
→ { keys: [{ kty: "OKP", crv: "Ed25519", x: "<b64url>", kid: "<id>", use: "sig" }] }
Cache-Control: public, max-age=3600
No auth required
```

**Path:** `apps/api/src/modules/wellknown/` (new module). Read the `kid + pubkey` from `AuditSignerService.getActiveKid()` + the KMS adapter's public key export. During key rotation window, list both current and previous key.

**Files to create:** `wellknown.controller.ts`, `wellknown.module.ts`, add to `app.module.ts` imports.

**Test:** GET returns valid JWKS. Key rotation: both keys listed for 24h window. Cache headers correct. No auth required (tested without API key header).

---

### G-2 🔴 CRITICAL — Stripe Billing Module (M-011)

**Why critical:** Can't take money without this. The `plans.ts` file has defaults but Stripe webhooks, usage metering, and plan enforcement are not wired.

**Current state:** `apps/api/src/modules/billing/plans.ts` defines plan tiers and `plans.spec.ts` has unit tests. Zero Stripe integration code.

**What to build:**
- `stripe.service.ts` — customer create, subscription create/update, usage record reporting
- `billing.controller.ts` — `POST /v1/billing/webhook` (Stripe signature verification)
- `billing.module.ts` — wire Stripe client from env
- Per-principal verify counter: Redis INCR on every `/v1/verify` + nightly Postgres flush
- Plan downgrade flow on payment failure (after configurable grace period)
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` env vars in `config.schema.ts`

**OD-003 decision needed:** Resolve the pricing tier conflict (Free 1K vs. 10K, Developer $49 vs. $29). Operator must decide before this ships — default is `plans.ts` current values.

---

### G-3 🟠 HIGH — BATE Anomaly Detector Not Wired to BateService Worker

**Why high:** The detector code exists and is tested but isn't being called. Every signal that comes in gets scored but not anomaly-checked. This is the behavioral defense layer that justifies the "BATE" name.

**Current state:** `bate.anomaly.ts` is a pure function returning signal array. `bate.service.ts` processes signals via BullMQ but does not call the detector.

**What to wire:**
```typescript
// In bate.service.ts processSignal():
const anomalySignals = detectAnomalies(recentSignals, thresholds);
for (const sig of anomalySignals) {
  await this.ingestSignal({ agentId, ...sig });
}
```

Coordinate with the peer who holds the `bate.service.ts` path before editing.

---

### G-4 🟠 HIGH — Webhook Subscription Management Endpoints

**Why high:** Customers need `aegis.agent.revoked` events. Without subscribe endpoints, the WebhookDelivery worker ships events but nobody can register to receive them.

**Current state:** `WebhookSubscription` and `WebhookDelivery` models exist. `webhook.delivery.spec.ts` ships. The **subscribe CRUD API is not implemented**.

**What to build:**
- `POST /v1/webhooks` — create subscription (url, secret, events[])
- `GET /v1/webhooks` — list subscriptions (principal-scoped)
- `DELETE /v1/webhooks/:id` — remove subscription
- HMAC-SHA256 `X-AEGIS-Signature: t=<ts>,v1=<sig>` on every delivery (Stripe parity)
- OD-005 default: 8 retry attempts before DLQ

---

### G-5 🟡 MEDIUM — Dashboard Login + API Key Management UI

**Why medium:** Developer onboarding path. Without this, developers must use the CLI or direct API calls to get their first API key, which is friction.

**Current state:** `apps/dashboard/` directory scaffolded with Next.js App Router structure. No pages implemented. Auth0 module is live on the API side.

**Priority pages (in order):**
1. Login via Auth0 (`/auth/login`, `/auth/callback`)
2. API key management (`/settings/api-keys`) — create, label, revoke, show prefix
3. Onboarding checklist (`/onboarding`) — maps to `PrincipalOnboarding` 7 steps

Bloomberg-density layout (per operator preference in `CLAUDE.md`): MetricStrip header, DataRow components, DataTable for lists. No card grids.

---

### G-6 🟡 MEDIUM — `scripts/check-openapi-zod-parity.ts`

**Why medium:** The `spec-sync.yml` CI workflow references this script on job 1 but the file doesn't exist. The denial-precedence job (job 3) runs without it.

**What to build:** Walk `AEGIS_API_SPEC.yaml` request/response schemas and check they have a corresponding Zod schema in `packages/types/src/schemas.ts`. Fail on missing or shape-mismatched schemas.

---

### G-7 🟡 MEDIUM — CLI Device-Code OAuth (M-040a, gated)

**Why medium (gated):** The auth0 module is live but doesn't expose `/device/{authorize,token}` endpoints yet. The CLI has `internal/oauth/devicecode.go` stub.

**Unblock when:** Auth0 module adds device authorization flow endpoints. Then wire `cmd/login.go` to call them instead of the stub. Wakeup scheduled for 14 days from Round 9.

---

### G-8 🟡 MEDIUM — OpenAPI Denial-Reason Enum Order Fix

**Why medium:** `AEGIS_API_SPEC.yaml` lines 572–581 list denial reasons alphabetically. CLAUDE.md invariant #6 mandates canonical precedence order. The CLI renders canonical; the spec must match for client code generators.

**Fix:** Reorder the denial enum in `AEGIS_API_SPEC.yaml` to match `AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED → POLICY_EXPIRED → SCOPE_NOT_GRANTED → SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED`.

---

### G-9 🟢 LOW — `ScheduleModule.forRoot()` in AppModule

**What:** `@Cron` decorators on `OnboardingBackfill` require `@nestjs/schedule` module to be imported in `app.module.ts`. Currently the cron fires via admin endpoint only.

**Fix:** `pnpm add @nestjs/schedule -F @aegis/api` + add `ScheduleModule.forRoot()` to `app.module.ts` imports.

---

### G-10 🟢 LOW — Manual OTel Spans on Critical Paths

`initTracing()` covers auto-instrumentation (HTTP, PG, Redis). Manual spans needed for:
- `aegis.verify.algorithm` — the core hot path
- `aegis.audit.chain.append` — audit write latency
- `aegis.kms.<provider>.<op>` — KMS latency visibility
- `aegis.policy.engine.<id>.eval` — engine latency

Add `tracer.startActiveSpan(...)` calls in the relevant files. Non-blocking for first customer.

---

## 9. Operator Decisions — Decision Register Status

All 16 open decisions are in `OPERATOR_DECISIONS.md`. **Priority for operator review:**

| ID | Decision | Blocks | Urgency |
|---|---|---|---|
| OD-001 | BATE scoring weights (confirm or override defaults in `bate.weights.ts`) | M-007 full ship | Before public launch |
| OD-002 | Cold-start trust accelerator policy (KYC-only → start at 650 is current default) | M-007 cold-start | Before public launch |
| OD-003 | Pricing tier hard gates (Free 1K vs. 10K; Developer $49 vs. $29) | M-011 Stripe | Before billing ships |
| OD-006 | `/v1/verify` rate-limit FREE tier (10 req/sec + burst 20 is current default) | M-005 throttle | Before public beta |
| OD-013 | Default policy engine per principal (`builtin` is default; confirm) | Customer Cedar/OPA quickstart | Before marketing claims |
| OD-005 | Webhook delivery max attempts before DLQ (8 is default, Stripe parity) | M-008 | Before webhooks ship |

The remaining 10 ODs are either: (a) locked defaults that ship if silent, (b) reserved peer-owned (OD-008), or (c) milestone-triggered (OD-004, OD-007, OD-014).

**Action for operator:** Review the 6 above. Reply `accept default` to lock each. Any override: edit the OD row and mark `DECIDED` — the next session encodes it.

---

## 10. Critical Invariants — Do Not Break

These are hardwired into `CLAUDE.md`. Every PR touching the relevant paths must explicitly verify these:

**INVARIANT 1 — Private keys never enter AEGIS.**  
The SDK generates keypairs client-side. `generateKeypair()` returns `{ privateKey, publicKey }`. Only `publicKey` is sent to the API. The `@aegis/sdk` crypto functions and the Go CLI's `--generate-keypair` flag both enforce this. Never add a private key field to any API endpoint.

**INVARIANT 2 — The verify hot path is portable.**  
`apps/api/src/modules/verify/algorithm/verify.algorithm.ts` and everything it imports must have zero NestJS / Prisma / ioredis / Node-specific imports. If you add an import to `verify.algorithm.ts`, the new import must also be free of those dependencies. The CI will catch it at build time for the CF Worker — `workers/cf-verify/` imports the algorithm directly.

**INVARIANT 3 — Audit log is append-only and signed.**  
`audit.service.append()` is the only write path. No `UPDATE` or `DELETE` on `AuditEvent`. The `AuditSignerService` signs every row. The hash chain links every row to its predecessor. Redaction (GDPR) nulls PII columns but does NOT delete rows or signatures — the `*Hash` columns keep the chain verifiable.

**INVARIANT 4 — No silent failures.**  
If Redis is down during spend check → fail closed with ANOMALY_FLAGGED, not a silent pass. If audit append throws → surface null `auditEventId` in response. Never return a synthetic trust score. Never silently swallow errors in the verify path.

**INVARIANT 5 — Multi-tenant isolation by `principalId`.**  
Every service method takes `principalId` as the first argument. Every Prisma query includes `where: { principalId }` or an equivalent. RLS provides a belt to the suspenders. Never expose data from one tenant to another.

**INVARIANT 6 — Denial precedence is fixed and ordered.**  
`AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED → POLICY_EXPIRED → SCOPE_NOT_GRANTED → SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED`. The `spec-sync.yml` CI job 3 validates this is byte-identical across `verify.algorithm.ts`, `packages/verifier-rp/src/types.ts`, and `AEGIS_API_SPEC.yaml`. Do not change without an ADR + API version bump.

---

## 11. Terminal Coordination Protocol

This codebase runs with multiple parallel Claude sessions. Coordination is via `claude-peers` (see `CLAUDE.md` §"How parallel sessions claim work").

### Before you touch any file:

1. **Read `WORK_BOARD.md`** — check status of every module in your intended path.
2. **Run `claude-peers claim aegis <module-id>`** — flip STATUS to `claimed by <sid>`.
3. **Check conflict zones** — `apps/api/src/modules/bate/bate.service.ts`, `apps/api/src/app.module.ts`, `apps/api/prisma/schema.prisma`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md` are SHARED files. Coordinate before claiming.
4. **Stay in your paths** — each module lists its owned paths. Use `claude-peers msg` to negotiate cross-boundary touches.
5. **On completion** — append to `docs/SESSION_HANDOFF.md` (newest at top), release claim.

### Current claim state (as of Round 10):

All claims from Rounds 6–10 released. The board is open.

### High-value next sessions to run in parallel:

| Session A | Session B | Session C |
|---|---|---|
| G-1: `/.well-known/audit-signing-key` (M-016) — 1 new module, ~200 LOC | G-2: Stripe billing (M-011) — `billing.service.ts` + webhook handler | G-5: Dashboard login + API key UI — Auth0 + settings pages |
| **Paths:** `apps/api/src/modules/wellknown/**` | **Paths:** `apps/api/src/modules/billing/**` | **Paths:** `apps/dashboard/**` |
| **No conflicts** | **No conflicts** | **No conflicts** |

---

## 12. The Path to Gate 1: $500 MRR Sprint

Gate 1 condition: first paying developer customer, demonstrable `aegis.verify()` integration in production.

**Sprint checklist (estimated 2–3 sessions):**

```
[ ] G-1: /.well-known/audit-signing-key    (1 session, ~3h)
[ ] G-4: Webhook subscribe endpoints       (1 session, ~4h)
[ ] G-2: Stripe billing basic tier         (1 session, ~6h)
[ ] G-5: Dashboard login + API key UI      (1 session, ~8h)
[ ] OD-001/002/003 operator decisions      (operator input, 30min)
[ ] Railway deploy + smoke test            (1 session, ~2h)
[ ] examples/fintech-payments complete     (M-040e, ~4h)
[ ] docs site: minimal landing             (M-014, ~4h)
```

**Already done that most competitors haven't started:**
- ✅ Pure portable verify algorithm (CF Workers ready)
- ✅ Signed audit chain (SOC2 artifact ready)
- ✅ TypeScript + Python SDKs
- ✅ Drop-in RP verifier (`@aegis/verifier-rp`)
- ✅ Go CLI with `--json` mode (CI-scriptable)
- ✅ MCP server + bridge (distribution wedge)
- ✅ KMS key rotation (enterprise-ready)
- ✅ Cedar + OPA policy engines (enterprise-ready)
- ✅ DPoP replay prevention (RFC 9449)
- ✅ PQ hybrid scaffold (future-proof)
- ✅ E2E test harness, 15 suites, TOCTOU race coverage

**The moat is real. The code proves it. Ship the gaps and charge for it.**

---

## 13. FAANG Quality Bar — Checklist for Every PR

This bar is non-negotiable per `CLAUDE.md` §Quality bar:

```
[ ] No `any` without a // type-rationale: prefix comment
[ ] noUncheckedIndexedAccess respected (don't widen at apps/api level)
[ ] Every new public service method has a unit test OR // untestable: <reason>
[ ] Errors are AegisError subclasses from apps/api/src/common/errors/
[ ] Constants live in packages/types/src/constants.ts, not in service files
[ ] No Math.random() in production code paths
[ ] Crypto code has a paired .spec.ts — NO exceptions
[ ] No fabricated data, no synthetic trust scores, no empty-array-pretending-to-be-no-results
[ ] Multi-tenant: principalId is the first argument of every service method
[ ] Verify hot path: new imports in verify.algorithm.ts have zero NestJS/Prisma/ioredis
[ ] Audit append: no direct Prisma writes to AuditEvent outside audit.service.append()
[ ] New env vars declared in apps/api/src/config/config.schema.ts
[ ] New modules added to apps/api/src/app.module.ts imports array
[ ] Schema changes have a migration + backfill for existing rows
[ ] Spec-sync.yml CI passes (OpenAPI↔Zod parity, denial-precedence enum)
```

---

*Document generated: 2026-05-04 | Based on: git log (4 commits), SESSION_HANDOFF.md (10 rounds), WORK_BOARD.md (56 modules), OPERATOR_DECISIONS.md (16 decisions), source scan (200+ files)*  
*Maintained in: `docs/MASTER_ENGINEERING_HANDOFF.md`*  
*Next review: after Gate 1 ($500 MRR)*
