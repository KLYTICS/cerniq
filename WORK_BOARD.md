# AEGIS — Work board

> Claimable modules for parallel Claude sessions. Read `CLAUDE.md` first.
>
> **Claim protocol**:
> 1. `~/.claude/peers/bin/claude-peers claim aegis <module-id> --note "..." --ttl 7200`
> 2. Edit this file: flip `STATUS: open` → `STATUS: claimed by <sid> @ <date>`.
> 3. When done: append handoff note to `docs/SESSION_HANDOFF.md`, release the claim.

Format: each module lists `paths` it owns. Stay inside them or coordinate
via `claude-peers msg`.

---

## SPRINT S1 — Phase 1 MVP (post CERNIQ Gate 1, exempt for spec/scaffold)

### M-001 · @aegis/sdk-ts client implementation
- **STATUS**: claimed by sid=3e2203ee @ 2026-05-01 (in progress — full
  client + crypto helpers in `packages/sdk-ts/src/{index,http,crypto,
  agent,policy,types}.ts`)
- **Paths**: `packages/sdk-ts/**`
- **Goal**: Implement the public TypeScript SDK matching the API surface
  documented in `docs/spec/AEGIS_API_SPEC.yaml`.
- **Acceptance**:
  - `Aegis` client class with `agents.*`, `policies.*`, `verify(...)`, and
    `agents.report(...)` methods.
  - `generateKeypair()` and `sign(privateKey, ...)` helpers using
    `@noble/ed25519` (no Node-only deps — must work in browser too).
  - Typed errors (`AegisError`, `NotFoundError`, `RateLimitedError`, etc.).
  - Unit tests for `sign` + `verify` round trip using `vitest`.
  - `npm pack` produces a valid tarball.
- **Blocked by**: `packages/types` Zod schemas (M-002).

### M-002 · @aegis/types Zod schemas
- **STATUS**: claimed by foundation @ 2026-05-01 (this session — DONE in core, refine later)
- **Paths**: `packages/types/**`
- **Goal**: Single source of truth for API request/response shapes. Mirror
  `docs/spec/AEGIS_API_SPEC.yaml`.

### M-003 · Identity module — full CRUD + handshake
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-01 — extension open
  (controller + service + dto in `apps/api/src/modules/identity/`).
  Remaining: challenge-response handshake (verifies the keypair).
- **Paths**: `apps/api/src/modules/identity/**`,
  `apps/api/src/modules/principals/**`
- **Goal**: Register agent, get agent, revoke agent, list per principal,
  verify keypair via challenge-response handshake.
- **Acceptance**:
  - All endpoints from API spec implemented.
  - Spec compliance tested against generated OpenAPI.
  - Audit event written on register / revoke.
  - Service tests with `>90%` coverage.

### M-004 · Policy module — create / list / revoke + scope validation
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-01 — extension open
  (controller + service + dto in `apps/api/src/modules/policy/`).
  Remaining: BullMQ-scheduled expiry sweep (`policy.expiry.worker.ts`).
- **Paths**: `apps/api/src/modules/policy/**`
- **Goal**: Create scoped policy, sign as JWT (jose, EdDSA), list active,
  revoke. Validate spend limits, MCC ranges, domain allow-lists at create.
- **Acceptance**:
  - Policy create returns `signedToken` (JWT with policy claims, signed by
    AEGIS Ed25519 key, `exp` enforced).
  - Revocation sets `revokedAt`, audit event emitted.
  - Cron-style sweep (BullMQ scheduled job) marks expired policies.
  - Spend limit math verified by tests using `Decimal.js` or `bigint`.

### M-005 · Verify module — the hot path
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-01 — extension open
  (full 12-step `verify.service.ts` with `spend-guard.service.ts` +
  tests in `apps/api/src/modules/verify/`).
  Remaining for full M-005 acceptance:
    - Extract pure algorithm into `verify.algorithm.ts` (framework-free)
      so M-013 (CF Worker) can import it directly.
    - Load test in `test/load/verify.test.ts` (k6 or autocannon).
- **Paths**: `apps/api/src/modules/verify/**`
- **Goal**: Full `/v1/verify` algorithm: parse JWT → fetch agent + policy
  → verify signature → check scope → check spend (Redis-backed counter
  with Postgres backstop) → read trust score → return result.
- **Acceptance**:
  - p99 < 200 ms on a warm cache (load test in `test/load/verify.test.ts`).
  - All 9 denial reasons (`docs/SECURITY.md` § Denial Precedence) covered
    by unit tests.
  - Spend counter increment is atomic (Redis `INCRBY` with Lua fallback).
  - Cache key strategy documented in module README.

### M-006 · Audit module — write + paginated read + export
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-01 — extension open
  (controller + service + dto in `apps/api/src/modules/audit/`,
  `audit-chain.util.ts` + spec in `common/crypto/`).
  Remaining: NDJSON export endpoint, public `/.well-known/audit-signing-key`.
- **Paths**: `apps/api/src/modules/audit/**`
- **Goal**: Append-only event log with hash chain, paginated GET, NDJSON
  export endpoint for SOC2 evidence.
- **Acceptance**:
  - `append(event)` computes prev-hash + AEGIS signature.
  - GET supports cursor pagination with date range filter.
  - Export endpoint streams NDJSON with `Content-Type: application/x-ndjson`.
  - Tamper-detection unit test (mutate a record, verify chain breaks).

### M-007 · BATE engine — signal ingestion + rule-based scoring
- **STATUS**: scorer kernel shipped by sid=3e2203ee @ 2026-05-01 with
  interim weights · **STILL BLOCKED ON OPERATOR** for final weights
  (see `OPERATOR_DECISIONS.md` Decision 1) and cold-start policy
  (Decision 2).
  Shipped: `bate.scorer.ts` + spec, `bate.service.ts`, `bate.controller.ts`.
  Remaining: anomaly detector rules R-1..R-5, BullMQ signal worker,
  webhook emission on band crossing, score history persistence.
- **Paths**: `apps/api/src/modules/bate/**`
- **Goal**: Ingest signals via BullMQ, recompute trust score, persist
  history, invalidate Redis cache, emit `trust_score_changed` webhook.
- **Acceptance**:
  - Signal types from `BateSignalType` enum all handled.
  - Rule-based v1 anomaly detector (velocity, geographic, spend pattern,
    failed verify spike).
  - Score change emits webhook via M-008.
  - Worker is idempotent (idempotencyKey enforced).
- **OPERATOR INPUT NEEDED**: weights table in `docs/BATE_ALGORITHM.md`.

### M-008 · Webhooks — subscription + delivery worker
- **STATUS**: module + service stubbed by sid=3e2203ee — extension open.
  Remaining: HMAC-SHA256 signature, BullMQ delivery worker with retry +
  DLQ, dashboard view of delivery status.
- **Paths**: `apps/api/src/modules/webhooks/**`
- **Goal**: Manage subscriptions, deliver events with HMAC signature, retry
  with exponential backoff, dead-letter after N attempts.
- **Acceptance**:
  - HMAC-SHA256 signature in `X-AEGIS-Signature` header (Stripe-style:
    `t=<timestamp>,v1=<sig>`).
  - At-least-once delivery, idempotency-key recommended in docs.
  - DLQ visible to dashboard.

### M-009 · Auth — API key issuance + bcrypt + dual-key (full vs. verify-only)
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-01
  (`api-key.guard.ts`, `api-key.service.ts`, `auth.module.ts`,
  decorators in `common/decorators/`).
  Remaining: key issuance UI in dashboard, last-used tracking surfaced.
- **Paths**: `apps/api/src/modules/auth/**`
- **Goal**: Two API key types (`X-AEGIS-API-Key` for management,
  `X-AEGIS-Verify-Key` for relying-party verify-only). bcrypt-hashed,
  prefix shown in dashboard, last-used tracked.
- **Acceptance**:
  - `api-key.guard.ts` injects `principalId` into `req.principal`.
  - Verify-only key is scoped to `/v1/verify` and `/v1/agents/:id/status`.
  - Hashing cost configurable via env, defaults to 12 in prod, 4 in tests.

### M-010 · Health + readiness + Prometheus metrics
- **STATUS**: health controller shipped by sid=3e2203ee @ 2026-05-01.
  Remaining: `/ready` with DB+Redis pings, `/metrics` via `prom-client`,
  SLI registration (`verify_latency_seconds`,
  `verify_total{denial_reason}`, `bate_score_delta{signal_type}`).
- **Paths**: `apps/api/src/modules/health/**`,
  `apps/api/src/common/observability/**`
- **Goal**: `/health` (liveness, no auth, never blocks), `/ready` (auth +
  DB + Redis ping), `/metrics` (prom-client).

### M-011 · Stripe billing — Free + Developer tiers, usage metering
- **STATUS**: open
- **Paths**: `apps/api/src/modules/billing/**`
- **Goal**: Plan management, customer creation, usage record reporting for
  metered billing on overage.
- **Acceptance**:
  - Webhook handler (`/v1/billing/webhook`) verifies Stripe signature.
  - `verify` request increments per-principal counter (Redis + nightly DB
    flush).
  - Plan downgrade on payment failure (after grace period).

### M-012 · Dashboard — Next.js minimal portal
- **STATUS**: claimed by sid=3e2203ee @ 2026-05-01 (in progress — directory
  scaffold at `apps/dashboard/{app/{agents,audit,billing,policies,webhooks},
  components,lib,public}/`)
- **Paths**: `apps/dashboard/**`
- **Goal**: Login (custom or Auth.js), API key management, agent CRUD UI,
  policy CRUD, audit log viewer, trust score widget.
- **Acceptance**:
  - Bloomberg-density layout (per operator preference: `MetricStrip`,
    `DataRow`, `DataTable`, no card grids).
  - Server components by default, client components only where needed.
  - All forms use Zod schemas from `@aegis/types`.

### M-013 · Cloudflare Worker — `/v1/verify` edge port (Phase 3)
- **STATUS**: stub claimed by sid=3e2203ee @ 2026-05-01
  (`workers/cf-verify/src/` directory created).
  See `infra/cloudflare/README.md` for the planning notes.
  · **WAIT FOR PHASE 3 GATE** ($5K MRR)
- **Paths**: `workers/cf-verify/**`
- **Goal**: Port the verify hot path to a CF Worker, KV-backed trust score
  cache, < 80 ms p99 globally.
- **Pre-req**: M-005 must keep its core logic in framework-free utilities.

### M-014 · Documentation site — docs.aegislabs.io
- **STATUS**: open
- **Paths**: `apps/docs/**` (create), `docs/site-content/**`
- **Goal**: Mintlify or Docusaurus, quickstart, API reference (auto from
  OpenAPI), SDK reference (auto from TypeDoc), guides for LangChain /
  AutoGen / CrewAI integration.

### M-015 · Python SDK
- **STATUS**: ✅ landed by sid=a9198691 @ 2026-05-01 — 24 files, 70 tests green, mypy --strict clean, ruff clean, JWT byte-equivalent to TS SDK
- **Paths**: `packages/sdk-py/**`
- **Goal**: Mirror TS SDK for Python consumers (LangChain, CrewAI, custom).
- **Delivered**: `AsyncAegis` (primary) + `Aegis` (sync wrapper), `agents`/`policies`/`verify`/`crypto` modules, pydantic v2 models for all wire shapes, typed error hierarchy, httpx async client with retry policy, hatchling build, pyproject with ruff + mypy strict + pytest config, README with quickstart.

### M-016 · Relying-party verifier (`@aegis/verifier-rp`) — NEW
- **STATUS**: ✅ landed by sid=a9198691 @ 2026-05-01 — 34 files, 58 tests green (vitest), property tests via fast-check, tsup ESM+CJS dual build, tree-shakeable subpath exports per adapter
- **Paths**: `packages/verifier-rp/**` (new package)
- **Goal**: Drop-in TS library that lets relying parties verify AEGIS tokens
  **offline** via JWKS, with a small revocation cache and adapters for
  Express / Fastify / Hono / edge runtimes. Distinct from `sdk-ts` (which is
  principal-side); this package is what merchants and downstream services ship.
- **Delivered**: `AegisVerifier` class, JWKS client + SWR cache, replay LRU keyed on jti, revocation cache (lazy /status poll + invalidation hook), Ed25519 offline verify via `@noble/ed25519` (zero `node:crypto` — edge-runtime ready), Express/Fastify/Hono adapters, full property-test suite, `getAgentPublicKey` callback design (RP supplies; documented in README).
- **Open question for operator**: Should `REPLAY_DETECTED` collapse to `INVALID_SIGNATURE` at the wire boundary, or remain distinguishable for RP observability? Currently distinguishable — flag if you want it collapsed.

### M-017 · Root e2e test harness (`tests/e2e`) — NEW
- **STATUS**: ✅ landed by sid=a9198691 @ 2026-05-01 — 24 files (16 test + 5 support + load + chaos + configs), tsc --noEmit clean, vitest skip-with-banner verified when API down
- **Paths**: `tests/**` (new top-level dir)
- **Goal**: Black-box validation suite mirroring `~/Downloads/files (7)/aegis-test.js`
  ground truth, extended to v2 surface — full denial precedence, replay,
  TOCTOU spend race, multi-tenant isolation, JWKS, audit chain, webhooks.
- **Delivered**: 15 numbered test files (01_health → 15_idempotency) + property
  test on denial precedence + k6 load script (50 RPS × 60s, p99 budget) + chaos README.
  Uses `link:../packages/*` for SDK + types (no workspace modification). Soft-skips
  endpoints not yet wired; **hard-asserts** the bug-catchers (replay, TOCTOU spend race, revocation propagation, idempotency).
- **Notes**: harness becomes the regression net for every API feature peer ships from this point — soft-skip tests flip to hard-assert as endpoints land.

### M-018 · Threat model + architecture audit (γ contribution) — NEW
- **STATUS**: ✅ landed by sid=a9198691 @ 2026-05-01 — additive only, original docs untouched
- **Paths**: `docs/THREAT_MODEL_v2.md` (965 lines), `docs/ARCHITECTURE_AUDIT.md` (490 lines)
- **Goal**: Auditor-grade security analysis. Reconciles RSA-4096 vs EdDSA inconsistency in v1 threat model.
- **Delivered**:
  - **THREAT_MODEL_v2**: 13 sections, full STRIDE table (31 threats S/T/R/I/D/E), 4-party trust model, EdDSA reconciliation rationale (§4.2), audit-chain construction with RFC 8785 JCS (§4.3), three-layer replay defence (§7), atomic INCRBY/DECRBY spend mitigation with fail-closed-on-Redis-down (§8), key rotation lifecycle (§5), JWKS distribution contract (§6), v1 prototype postmortem (§11), module-to-mitigation index (Appendix B).
  - **ARCHITECTURE_AUDIT**: 22 findings — 1 Critical / 5 High / 8 Medium / 6 Low / 2 Info.
- **Top 3 fixes flagged for this sprint**:
  1. **A-001 (Critical)** — reconcile audit-chain crypto contradiction (`ARCHITECTURE.md` L172 says Ed25519, `THREAT_MODEL.md` L21/L44 says RSA-4096). Adopt v2's EdDSA decision; align v1 docs.
  2. **A-019 (High)** — redesign `AuditEvent` for redactability **before** M-006 ships. Sign over `decisionReasonHash`, not raw text, so GDPR Art 17 erasure can null PII columns without breaking the chain.
  3. **A-002 (High)** — document Redis-down behavior in verify path. Spend counters must fail-closed with 503, not silently fall back to Postgres-only — the v1 TOCTOU bug.

---

## SPRINT S2 — BATE deepening (post Phase 1 launch + $500 MRR)

### M-020 · ML anomaly detection v1 (Isolation Forest)
- **STATUS**: open · gated on M-007 + 30 days of signal data
- **Paths**: `apps/ml/**` (new), `apps/api/src/modules/bate/ml/**`

### M-021 · Trust score time-series storage
- **STATUS**: open
- **Paths**: `apps/api/prisma/schema.prisma` (additions),
  `apps/api/src/modules/bate/history/**`

### M-022 · Cross-principal correlation engine
- **STATUS**: open · privacy review required first

---

## SPRINT S3 — Edge & enterprise (post $5K MRR)

See `docs/spec/01_MASTER.md` § 7 (Phase 3) and the master backlog
`docs/spec/BACKLOG.md` Epic 12-15.

---

### M-016 · `/.well-known/audit-signing-key` — public verifier endpoint
- **STATUS**: open
- **Paths**: `apps/api/src/modules/wellknown/**` (new module)
- **Goal**: Serve the AEGIS audit signing public key as a JWKS so third
  parties can verify the audit chain offline. JWKS supports key rotation
  (current + previous keys both listed during cutover window).
- **Acceptance**:
  - GET `/.well-known/audit-signing-key` returns `application/json`
    JWKS shape: `{ keys: [{ kty: "OKP", crv: "Ed25519", x: "<b64url>",
    kid: "<id>", use: "sig" }] }`.
  - `Cache-Control: public, max-age=3600` (low-churn, safe to cache).
  - No auth required.
  - Documented at the dashboard "verify our audit log" page.

### M-017 · Operational scripts hardening
- **STATUS**: scaffolded by sid=a9198691 @ 2026-05-01 — extension open
  (`scripts/{generate-aegis-keys,verify-spec,health-check}` shipped).
  Remaining: `scripts/seed-dev.ts` (creates a dev principal + API key
  + agent + policy fixture for the dashboard's first run).

### M-018 · Apply operator decisions
- **STATUS**: open · **BLOCKED ON OPERATOR** (`OPERATOR_DECISIONS.md`)
- **Goal**: Once the operator returns the decision form, encode the
  three decisions in code:
    1. BATE weights → `apps/api/src/modules/bate/bate.scorer.ts`
       constants block.
    2. Cold-start policy → new `apps/api/src/modules/bate/bate.cold-start.ts`.
    3. Pricing tiers → new `apps/api/src/modules/billing/plans.ts`.
  And mirror each into the relevant doc (`docs/BATE_ALGORITHM.md`,
  `docs/spec/04_COMMERCIAL_STRATEGY.md`).

---

## SPRINT S2 — Enterprise backbone (post 2026-05-02)

> Charter: ADRs 0008–0013 commit AEGIS to MCP backbone, Auth0 bridge,
> DPoP replay prevention, KMS-backed key rotation, pluggable policy
> engine, and PQ hybrid scaffold. Scaffolds landed by sid=enterprise-
> backbone-arch on 2026-05-02. The modules below pick up from those
> scaffolds and complete the layer.

### M-019 · Verify path adopts PolicyEngine + DPoP step
- **STATUS**: open
- **Paths**: `apps/api/src/modules/verify/algorithm/verify.algorithm.ts`,
  `apps/api/src/modules/verify/verify.service.ts`,
  `apps/api/src/modules/verify/verify.ports.ts`
- **Goal**: refactor the hot path to (a) call `PolicyEngine.evaluate()`
  via `apps/api/src/common/policy-engine/index.ts` instead of the
  hand-coded checks (behavior preserved bit-for-bit by
  `BuiltinPolicyEngine`), (b) insert a step 4.5 that runs
  `verifyDpopProof()` from `apps/api/src/common/crypto/dpop.util.ts`
  when the request carries a `DPoP:` header (or `_aegis_dpop` for MCP
  stdio), gated by `AEGIS_DPOP_REQUIRED` env flag.
- **Acceptance**:
  - `BuiltinPolicyEngine.evaluate()` is the single decision call.
  - All Phase-0 verify tests still green (no behavior drift).
  - DPoP step 4.5 has its own integration test under
    `apps/api/test/verify-dpop.e2e-spec.ts`.
  - Worker portability invariant (ADR-0003) preserved — both engine and
    DPoP util are framework-free.
- **Blocked by**: peer's `aegis:bug-fix-pass` releases the verify path.

### M-020 · Auth0 module — tests + e2e + dashboard wiring
- **STATUS**: open
- **Paths**: `apps/api/src/modules/auth0/**/*.spec.ts`,
  `apps/api/test/auth0.e2e-spec.ts`, `apps/dashboard/**`
- **Goal**: complete the Auth0 module (skeleton landed 2026-05-02):
  unit tests for adapter + service, e2e via supertest with Auth0 JWKS
  mocked, dashboard switches from "no auth" to `@auth0/nextjs-auth0`,
  Action source committed to `infra/auth0/actions/aegis-audit-login.js`.
- **Acceptance**: dashboard login works against Auth0 dev tenant,
  every login produces an AEGIS audit row, MFA-skipped admin logins
  are FLAGGED.
- **Reference**: ADR-0009.

### M-021 · `@aegis/mcp-server` — tests + bin + dist
- **STATUS**: open
- **Paths**: `packages/mcp-server/**`
- **Goal**: scaffold landed 2026-05-02 (`server.ts` + tools + bin).
  Add: `npm pack` validation, vitest tests for each tool's
  args→handler→Aegis-call mapping (mock SDK), README example for
  Claude Desktop config, version-pin `@modelcontextprotocol/sdk` after
  next minor release.
- **Acceptance**: `npx @aegis/mcp-server` runs against a live AEGIS
  staging API and `aegis.verify` returns valid responses.
- **Reference**: ADR-0008 §1.

### M-022 · MCP control-plane wiring
- **STATUS**: open
- **Paths**: `apps/api/src/modules/mcp/mcp.service.spec.ts`,
  `apps/api/src/modules/verify/algorithm/verify.algorithm.ts` (small
  edit — coordinate with M-019),
  `apps/api/src/modules/audit/audit.service.ts` (add `relyingPartyId`
  parameter wiring)
- **Goal**: when `@aegis/mcp-bridge` calls `/v1/verify` with an
  `mcpServerId` header, stamp `AuditEvent.relyingPartyId` on the
  resulting audit row, and surface `lastSeenAt` + `recentInvocations`
  on the MCP server list endpoint.
- **Acceptance**: dashboard MCP-server list shows real activity counts.

### M-023 · `AwsKmsAdapter` (KmsAdapter implementation)
- **STATUS**: open
- **Paths**: `apps/api/src/modules/kms/aws-kms.adapter.ts` + spec
- **Goal**: implement `KmsAdapter` from
  `apps/api/src/common/crypto/crypto.bootstrap.ts` against AWS KMS Sign
  API with `EdDSA`. JWKS publishing reads `listKeys()`. Caches active
  key in-memory with `kid` invalidation on rotation.
- **Acceptance**: integration test against `localstack` (KMS) green;
  audit chain signs and verifies through KMS-backed sign.
- **Reference**: ADR-0011 §4.

### M-024 · BATE signal weights for DPoP signals
- **STATUS**: open
- **Paths**: `apps/api/src/modules/bate/bate.scorer.ts`,
  `docs/BATE_ALGORITHM.md`
- **Goal**: add two signals: `agent.no_dpop` (+15 risk) and
  `agent.dpop_replay_attempt` (+50 risk + auto-flag), wire them in the
  scorer, document in BATE_ALGORITHM.md.
- **Reference**: ADR-0010 §2.

### M-025 · Bootstrap centralization + cross-package vitest workspace
- **STATUS**: open
- **Paths**: `apps/api/src/common/crypto/{ed25519.util,jwt.util,audit-chain.util}.ts`
  (top-of-file change only), `apps/api/src/common/crypto/audit-chain.util.spec.ts`,
  `packages/sdk-ts/src/crypto.ts`, `vitest.workspace.ts` (NEW at root)
- **Goal**: replace the inline `ed.etc.sha512Sync = ...` lines with
  `import './crypto.bootstrap.js';` (or equivalent in SDK). Add a
  `vitest.workspace.ts` that picks up `tests/cross-package` so the SDK↔API
  parity test runs on `pnpm vitest`.
- **Acceptance**: a single `pnpm vitest run` runs API + SDK + cross-package
  tests, including `tests/cross-package/sdk-api-jwt-parity.spec.ts`.

### M-026 · Schema migration: signingKeyId, RelyingPartyKind, audit metadata
- **STATUS**: open · **BLOCKS M-019, M-022, M-023**
- **Paths**: `apps/api/prisma/schema.prisma`,
  `apps/api/prisma/migrations/<next>/migration.sql`
- **Goal**: schema additions consolidated:
  1. `AuditEvent.signingKeyId String` (default `'kid-genesis-v1'`).
  2. `AuditEvent.policyEngineId String?` + `engineMetadata Json?`.
  3. `AuditEvent.relyingPartyId String?` + FK to `RelyingParty`.
  4. `AgentPolicy.signedTokenKeyId String?`.
  5. New enum `RelyingPartyKind = HTTP_API | MCP_SERVER | OTHER`.
  6. New `Principal.policyEngine String @default("builtin")`.
  7. New `Principal.idpProvider String?` + `idpOrganizationId String?`
     + `idpDomain String?` (Auth0 binding).
- **Acceptance**: migration applies cleanly, backfill logic for
  pre-existing rows correct, peer's `seed-dev.ts` updated.
- **Coordinate with**: peer holding `migrations/**` (`aegis:bug-fix-pass`).

### M-027 · `aegis-cli` — operator binary
- **STATUS**: open
- **Paths**: `packages/cli/**` (NEW)
- **Goal**: a Go or Node CLI (`aegis`) that does:
  `aegis bootstrap`, `aegis agents create/list/revoke`, `aegis policies …`,
  `aegis kms rotate <purpose>`, `aegis audit verify`. Reads
  `~/.aegis/credentials.json`. Self-installs an `aegis-mcp` config in
  Claude Desktop (`aegis mcp install`).
- **Reference**: ADR-0011 §5 (rotation), ADR-0008 (mcp-server install).

### M-028 · Dashboard MCP-server discovery view
- **STATUS**: open
- **Paths**: `apps/dashboard/app/mcp-servers/**`
- **Goal**: Bloomberg-density list of registered MCP servers with
  recent invocation counts, last-seen timestamps, denial rate. One-click
  pause/resume.
- **Reference**: ADR-0008 §4.

### M-029 · `GcpKmsAdapter`
- **STATUS**: open · same shape as M-023, GCP Cloud KMS asymmetric sign.

### M-030 · `VaultTransitAdapter`
- **STATUS**: open · same shape as M-023, HashiCorp Vault transit/sign.

### M-031 · `AzureKeyVaultAdapter`
- **STATUS**: open · pending Azure Key Vault EdDSA GA.

### M-032 · `Vault*HsmAdapter` for hardware HSM
- **STATUS**: open · deferred to first sovereign customer.

### M-033 · `CedarPolicyEngine` adapter
- **STATUS**: open
- **Paths**: `apps/api/src/common/policy-engine/cedar.engine.ts` + spec
- **Goal**: implement `PolicyEngine` against `@cedar-policy/cedar-wasm`.
  Compile policies at create time, evaluate at verify time. Static
  analysis errors surface as 422 at policy creation.
- **Reference**: ADR-0012.

### M-034 · `OpaPolicyEngine` adapter
- **STATUS**: open · same as M-033 against OPA Rego (sidecar HTTP first;
  embed `@open-policy-agent/opa-wasm` if hot-path latency requires).

### M-035 · PQ hybrid verify integration
- **STATUS**: open · **BLOCKED ON OPERATOR** (OD-008 flag flip)
- **Paths**: `apps/api/src/common/crypto/pq.util.ts` (NEW),
  `apps/api/src/modules/audit/audit.service.ts` (sign call)
- **Goal**: add hybrid sign/verify per ADR-0013 behind
  `AEGIS_HYBRID_PQ_ENABLED`. Tests for tamper detection on each half.
- **Reference**: ADR-0013.

### M-036 · Audit storage compression (Parquet+zstd)
- **STATUS**: open · prereq for ADR-0013 flag flip.

---

## How to add a new module to this board

1. ID it sequentially within the active sprint section.
2. Use the same fields: STATUS / Paths / Goal / Acceptance.
3. If blocked on operator decision, mark `BLOCKED ON OPERATOR` and add the
   ask to `CLAUDE.md` § "Operator decisions still pending".
