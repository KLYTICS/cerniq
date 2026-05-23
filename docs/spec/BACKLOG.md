# CERNIQ Development Backlog

## Sprint Queue — KLYTICS Internal

### Format: [PRIORITY] TASK — Owner | Estimate | Dependencies

---

## PHASE 0 — SPEC & FOUNDATION

### Department: Architecture / Product

_Owner: Erwin | Timeline: Weeks 1–4 (can begin now)_

- [P0] Draft CERNIQ_MASTER.md ✓ DONE
- [P0] OpenAPI spec v1 ✓ DONE
- [P0] This backlog ✓ DONE
- [P1] Agent identity data model finalized — Erwin | 2h | None
- [P1] Policy schema edge cases documented — Erwin | 3h | Data model
- [P1] BATE scoring algorithm whitepaper (internal) — Erwin | 4h | None
- [P1] SDK API surface TypeScript types (types-only, no impl) — Erwin | 3h | API spec
- [P2] Legal entity research: CERNIQ Labs LLC vs. sub-entity of KLYTICS — Erwin | 2h | None
- [P2] Competitive intelligence deep-dive: Prefactor, Scalekit, Entro — Erwin | 4h | None
- [P2] ACP spec read-through + integration design notes — Erwin | 3h | None
- [P3] Validate pain in 3 dev communities (HN, discord, r/LLMDevs) — Erwin | 1h | None
- [P3] Typeform willingness-to-pay survey — Erwin | 1h | None

---

## PHASE 1 — MVP BUILD

### Department: Backend Engineering

_Post CERNIQ Gate 1 | Timeline: Weeks 1–8 of build | Stack: NestJS/PostgreSQL/Redis/Railway_

### Epic 1: Core Infrastructure

- [P0] Initialize NestJS monorepo for CERNIQ API — BE | 4h | None
- [P0] Prisma schema: AgentIdentity, Principal, Policy, PolicyScope, AuditEvent — BE | 6h | Data model
- [P0] Railway deploy pipeline (CI/CD via GitHub Actions) — BE | 3h | NestJS init
- [P0] Redis connection + cache module (for trust scores) — BE | 2h | NestJS init
- [P1] Ed25519 keypair utils (libsodium-wrappers) — BE | 4h | None
- [P1] JWT token generation/parsing module (CERNIQ-signed tokens) — BE | 4h | Ed25519

### Epic 2: Identity API

- [P0] POST /v1/agents/register — BE | 6h | Prisma, Ed25519
- [P0] GET /v1/agents/:agentId — BE | 2h | Prisma
- [P0] DELETE /v1/agents/:agentId (revoke) — BE | 2h | Prisma
- [P1] GET /v1/agents/:agentId/status (public, no auth) — BE | 2h | Prisma + Redis cache
- [P1] API key authentication guard (NestJS guard) — BE | 3h | None
- [P1] Rate limiting (Throttler module, 1000 req/min per key) — BE | 2h | NestJS init
- [P2] Keypair verification handshake (sign challenge flow) — BE | 4h | Ed25519, JWT

### Epic 3: Policy Engine

- [P0] POST /v1/agents/:agentId/policies — BE | 8h | Prisma, JWT
- [P0] GET /v1/agents/:agentId/policies — BE | 2h | Prisma
- [P0] DELETE /v1/agents/:agentId/policies/:policyId (revoke) — BE | 2h | Prisma
- [P1] Policy scope validation (spend limits, domain allow-lists) — BE | 6h | Policy create
- [P1] Signed policy token generation (JWT with policy claims) — BE | 4h | JWT module
- [P2] Policy expiry cron job (mark expired, emit webhook) — BE | 3h | BullMQ

### Epic 4: Verification Engine

- [P0] POST /v1/verify — signature validation path — BE | 8h | Ed25519, Policy engine
- [P0] POST /v1/verify — policy scope check path — BE | 4h | Signature validation
- [P0] POST /v1/verify — spend limit check path — BE | 4h | Policy scope check
- [P1] Basic trust score lookup (Redis, fallback to DB) — BE | 3h | Redis
- [P1] Denial reason classification — BE | 2h | Verify endpoint
- [P2] Verify response caching (30s TTL, Vary: token) — BE | 2h | Redis
- [P2] Verify latency target: <200ms p99 (Phase 1, non-edge) — BE | ongoing | All verify

### Epic 5: Audit Log

- [P0] AuditEvent write on every verify call — BE | 4h | Prisma, Verify
- [P1] GET /v1/agents/:agentId/audit (paginated) — BE | 4h | Prisma
- [P1] Cursor-based pagination — BE | 3h | Audit GET
- [P2] CERNIQ signature over each audit record (tamper-evidence) — BE | 4h | Ed25519, Audit write

### Epic 6: Webhooks (Phase 1 minimal)

- [P2] Webhook subscription model (Prisma) — BE | 3h | Prisma
- [P2] POST endpoint for managing subscriptions — BE | 3h | Model
- [P2] BullMQ worker: deliver cerniq.agent.policy_expired events — BE | 4h | BullMQ, Webhooks
- [P3] Retry logic with exponential backoff — BE | 3h | Worker

### Epic 7: Developer Dashboard (minimal React)

- [P1] Next.js project init (or reuse CERNIQ pattern) — FE | 4h | None
- [P1] Auth: API key display + regenerate — FE | 4h | Auth0 or custom
- [P1] Agents list: register, view, revoke — FE | 8h | API
- [P1] Policies: create, view, revoke — FE | 8h | API
- [P2] Trust score display per agent — FE | 4h | API
- [P2] Audit log viewer (table, date filter) — FE | 6h | API
- [P3] Webhook management UI — FE | 4h | API

### Epic 8: Billing

- [P1] Stripe integration: Free + Developer plans — BE/FE | 8h | None
- [P1] Usage metering: count verify calls per billing period — BE | 4h | Verify endpoint
- [P2] Stripe metered billing for overages — BE | 6h | Usage metering
- [P3] Growth tier gating — BE | 4h | Plans

---

## PHASE 2 — BATE ENGINE

### Department: Data / ML Engineering

_Post $500 MRR | Timeline: Weeks 1–10 of Phase 2_

### Epic 9: Signal Ingestion

- [P0] POST /v1/agents/:agentId/report endpoint — BE | 4h | Prisma
- [P0] BATESignal model (Prisma) — BE | 2h | Prisma
- [P0] BullMQ queue: signal ingestion jobs — BE | 3h | BullMQ
- [P1] Signal deduplication (idempotency keys) — BE | 3h | BullMQ

### Epic 10: Scoring Engine

- [P0] Trust score computation service — BE/Data | 16h | Signal ingestion
- [P0] Score persistence + history (time-series in Postgres or InfluxDB) — BE | 6h | Score compute
- [P1] Redis cache invalidation on score update — BE | 2h | Redis
- [P1] Trust band assignment (PLATINUM/VERIFIED/WATCH/FLAGGED) — BE | 2h | Score compute
- [P2] Rule-based anomaly detection v1 — Data | 12h | Signal ingestion
  - Velocity anomaly (requests/min spike)
  - Geographic inconsistency
  - Spend pattern deviation
  - Failed verify spike
- [P3] ML anomaly detection v1 (Isolation Forest baseline) — Data | 20h | Rule-based

### Epic 11: Developer Signals

- [P1] Webhook: cerniq.agent.trust_score_changed — BE | 3h | Webhooks, BATE
- [P1] Webhook: cerniq.agent.anomaly_detected — BE | 3h | Webhooks, BATE
- [P2] Trust score dashboard widget (FE) — FE | 6h | BATE API
- [P2] Anomaly alert view (FE) — FE | 4h | BATE API

---

## PHASE 3 — EDGE & ENTERPRISE

### Department: Infrastructure / Enterprise

_Post $5,000 MRR | Timeline: Weeks 1–12 of Phase 3_

### Epic 12: Cloudflare Workers Edge

- [P0] Extract verify hot path to Cloudflare Worker — Infra | 12h | Phase 1 Verify
- [P0] KV store for trust score cache at edge — Infra | 4h | CF Workers
- [P0] Target: <80ms p99 globally — Infra | ongoing | CF Workers
- [P1] Durable Objects for rate limiting at edge — Infra | 6h | CF Workers
- [P1] Graceful fallback to origin if edge miss — Infra | 4h | CF Workers

### Epic 13: Delegation Chains

- [P0] AgentDelegation model (agent A delegates to B) — BE | 6h | Prisma
- [P0] Delegation token format (chain of signed claims) — BE | 8h | JWT
- [P1] POST /v1/agents/:agentId/delegate — BE | 6h | Model, JWT
- [P1] Verify handles delegation chain validation — BE | 8h | Verify endpoint
- [P2] Delegation chain depth limit (configurable, default: 3) — BE | 2h | Delegation
- [P2] Chain audit trail — BE | 4h | Audit log

### Epic 14: ACP Integration Connector

- [P0] ACP-compatible response format (policy claims mapped to ACP scopes) — BE | 6h | Verify
- [P0] SPT passthrough context (attach CERNIQ token alongside Stripe SPT) — BE | 8h | ACP spec
- [P1] ACP merchant adapter (webhook→CERNIQ report flow) — BE | 8h | Reporting, ACP
- [P2] agenticcommerce.dev listing + documentation PR — Product | 4h | None

### Epic 15: Enterprise & Compliance

- [P1] SOC2 Type I preparation (evidence collection tooling) — Infra | 20h | Audit log
- [P2] COSSEC compliance module (Puerto Rico cooperativa regulatory context) — BE | 12h | Enterprise
- [P2] Enterprise onboarding flow — FE | 8h | None
- [P3] On-premise BATE deployment option (Docker + Helm chart) — Infra | 20h | BATE engine

---

## CROSS-CUTTING CONCERNS

### Security (all phases)

- [P0] Input sanitization + SQL injection prevention (Prisma mitigates most) — BE | ongoing
- [P0] API key hashing (store bcrypt hash, never plaintext) — BE | 3h | Epic 1
- [P1] Secret scanning in CI (Gitleaks or Trufflehog) — Infra | 2h | CI
- [P1] Dependency audit workflow (npm audit, Snyk) — Infra | 2h | CI
- [P1] HTTPS-only, HSTS headers — Infra | 1h | Railway deploy
- [P2] Penetration test (self-conducted with GHOST SWARM methodology) — Security | 8h | MVP live

### Documentation

- [P1] README.md (developer quickstart, <10 min to first verify call) — Erwin | 4h | MVP
- [P1] docs.cerniq.io (Docusaurus or Mintlify) — FE | 6h | None
- [P2] SDK reference docs (auto-generated from TypeDoc) — FE | 3h | SDK
- [P2] Integration guides: LangChain, AutoGen, CrewAI — Erwin | 6h | SDK

### Testing

- [P0] Unit tests: Policy engine, BATE scoring, JWT utils — BE | 8h | Each epic
- [P0] Integration tests: Verify endpoint scenarios — BE | 8h | Verify
- [P1] Load test: 1000 concurrent verify calls (<200ms p99) — Infra | 4h | MVP
- [P2] Chaos test: Redis outage → fallback behavior — Infra | 4h | Edge

---

## SPRINT PRIORITY MATRIX

| Sprint           | Focus                                             | Exit Gate                                  |
| ---------------- | ------------------------------------------------- | ------------------------------------------ |
| S1 (weeks 1-2)   | NestJS init, Prisma schema, Ed25519, API key auth | Can register an agent and get a keypair    |
| S2 (weeks 3-4)   | Policy create/revoke, signed token generation     | Can create a scoped policy token           |
| S3 (weeks 5-6)   | Verify endpoint (all paths), audit log            | Can verify a signed agent token end-to-end |
| S4 (weeks 7-8)   | Dashboard v1, Stripe billing, public launch       | 10 signups, 1 paying customer              |
| S5 (weeks 9-12)  | BATE v1, webhooks, anomaly detection              | Trust score live and updating              |
| S6 (weeks 13-18) | Edge, delegation, ACP connector                   | <80ms global, enterprise-ready             |
