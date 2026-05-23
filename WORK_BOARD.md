# OKORO — Work board

> Claimable modules for parallel Claude sessions. Read `CLAUDE.md` first.
>
> **Claim protocol**:
> 1. `~/.claude/peers/bin/claude-peers claim okoro <module-id> --note "..." --ttl 7200`
> 2. Edit this file: flip `STATUS: open` → `STATUS: claimed by <sid> @ <date>`.
> 3. When done: append handoff note to `docs/SESSION_HANDOFF.md`, release the claim.

Format: each module lists `paths` it owns. Stay inside them or coordinate
via `claude-peers msg`.

---

## ⚠️ ACTIVE RENAME · 2026-05-21 · aegis → okoro

A repo-wide rename from AEGIS to OKORO is in progress. See
`RENAME_IN_PROGRESS.md` at the repo root.

**For peer sessions:** the main worktree has substituted every text occurrence
of `aegis`/`Aegis`/`AEGIS` → `okoro`/`Okoro`/`OKORO`. File and directory
renames have NOT yet landed (operator will do them shortly). If you are in a
worktree on a different branch, your branch still has the old names until you
rebase or the operator's sweep reaches you. Do not start new long-lived work
on aegis-named files until the rename completes.

The new Prisma migration is at
`apps/api/prisma/migrations/20260521000000_rename_aegis_to_okoro/`.

---

## SPRINT S1 — Phase 1 MVP (post CERNIQ Gate 1, exempt for spec/scaffold)

### M-001 · @okoro/sdk-ts client implementation
- **STATUS**: claimed by sid=3e2203ee @ 2026-05-01 (in progress — full
  client + crypto helpers in `packages/sdk-ts/src/{index,http,crypto,
  agent,policy,types}.ts`)
- **Paths**: `packages/sdk-ts/**`
- **Goal**: Implement the public TypeScript SDK matching the API surface
  documented in `docs/spec/OKORO_API_SPEC.yaml`.
- **Acceptance**:
  - `Okoro` client class with `agents.*`, `policies.*`, `verify(...)`, and
    `agents.report(...)` methods.
  - `generateKeypair()` and `sign(privateKey, ...)` helpers using
    `@noble/ed25519` (no Node-only deps — must work in browser too).
  - Typed errors (`OkoroError`, `NotFoundError`, `RateLimitedError`, etc.).
  - Unit tests for `sign` + `verify` round trip using `vitest`.
  - `npm pack` produces a valid tarball.
- **Blocked by**: `packages/types` Zod schemas (M-002).

### M-002 · @okoro/types Zod schemas
- **STATUS**: claimed by foundation @ 2026-05-01 (this session — DONE in core, refine later)
- **Paths**: `packages/types/**`
- **Goal**: Single source of truth for API request/response shapes. Mirror
  `docs/spec/OKORO_API_SPEC.yaml`.

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
    OKORO Ed25519 key, `exp` enforced).
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
  - `append(event)` computes prev-hash + OKORO signature.
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
  - HMAC-SHA256 signature in `X-OKORO-Signature` header (Stripe-style:
    `t=<timestamp>,v1=<sig>`).
  - At-least-once delivery, idempotency-key recommended in docs.
  - DLQ visible to dashboard.

### M-009 · Auth — API key issuance + bcrypt + dual-key (full vs. verify-only)
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-01
  (`api-key.guard.ts`, `api-key.service.ts`, `auth.module.ts`,
  decorators in `common/decorators/`).
  Remaining: key issuance UI in dashboard, last-used tracking surfaced.
- **Paths**: `apps/api/src/modules/auth/**`
- **Goal**: Two API key types (`X-OKORO-API-Key` for management,
  `X-OKORO-Verify-Key` for relying-party verify-only). bcrypt-hashed,
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
  - All forms use Zod schemas from `@okoro/types`.

### M-013 · Cloudflare Worker — `/v1/verify` edge port (Phase 3)
- **STATUS**: stub claimed by sid=3e2203ee @ 2026-05-01
  (`workers/cf-verify/src/` directory created).
  See `infra/cloudflare/README.md` for the planning notes.
  · **WAIT FOR PHASE 3 GATE** ($5K MRR)
- **Paths**: `workers/cf-verify/**`
- **Goal**: Port the verify hot path to a CF Worker, KV-backed trust score
  cache, < 80 ms p99 globally.
- **Pre-req**: M-005 must keep its core logic in framework-free utilities.

### M-014 · Documentation site — docs.okorolabs.io
- **STATUS**: ✅ **FULLY SHIPPED** by sid=gifted-payne @ 2026-05-18 (Round 24 vertical slice + Round 25 max-functionality wire + Round 26 max-width extension). Remaining work is content authorship, not platform.
  Framework: **Fumadocs 14** on Next.js 16 + React 19 (no vendor lock-in; matches dashboard stack reality).
  Round 25 wired:
    - **OpenAPI auto-render**: `apps/docs/scripts/generate-api-docs.mjs` runs `fumadocs-openapi generate` pre-build and pre-dev against `docs/spec/OKORO_API_SPEC.yaml` → output under gitignored `content/docs/api/(generated)/`.
    - **Search**: Orama via `fumadocs-core/search/server` at `app/api/search/route.ts` — zero vendor, no Algolia, no Pagefind sidecar.
    - **CI gates**: `.github/workflows/docs.yml` runs typecheck, cross-package parity, lychee link-check, and a main-only `next build` gate.
    - **Deploy**: `apps/docs/vercel.json` set up for monorepo-aware Vercel build.
    - **Live components (6 total)**: prior 3 from Round 24 (`DenialPrecedence`, `PricingTable`, `SdkVersionBadges`) plus `StatusBadge` (reads `/health` from `OKORO_API_BASE_URL`), `TrustBandLegend` (imports `TRUST_BAND_THRESHOLDS`), `WebhookEventCatalog` (imports `WEBHOOK_EVENT`).
    - **Parity tests (3 total)**: prior denial-precedence test plus `docs-trust-bands-parity.spec.ts`, `docs-webhook-events-parity.spec.ts`. Build fails if any docs component drops a wire-constant import.
    - **Content backbone**: 4 persona pages (SRE, developer, security, auditor); 3 industry quickstarts (fintech-payments, ai-platform-tool-call, saas-seat-provisioning); 3 new concept pages (trust-bands, audit-chain, webhooks); 4 new API reference pages (policies, verify, audit, webhooks, billing); compliance overview.
    - **SEO + AI-crawler surface**: `app/sitemap.ts`, `app/robots.ts`, `app/llms.txt/route.ts` (llmstxt.org convention — curated index for AI consumers).
  Round 26 wired (the previously-deferred Round 25 candidates, all of them, max-width):
    - **TypeDoc → SDK reference**: `apps/docs/typedoc.json` + `apps/docs/scripts/generate-sdk-docs.mjs`. Regenerates on every `pnpm dev`/`pnpm build` via the same `predev`/`prebuild` hook pattern as the OpenAPI generator. Output under gitignored `content/docs/sdk/(generated)/typescript/`.
    - **Curated SDK landings** for the 4 non-TS public packages: `sdk/{python,cli,verifier-rp,mcp}.mdx`. All linked from the new `/docs/sdk` nav section.
    - **Lighthouse CI**: `apps/docs/lighthouserc.json` + `.github/workflows/lighthouse-docs.yml`. Strict budgets — perf ≥ 0.85, a11y ≥ 0.95, best-practices ≥ 0.9, SEO ≥ 0.95. Runs `next start` + Lighthouse on 7 representative URLs.
    - **Open Graph images** via `next/og`: `app/opengraph-image.tsx` (homepage aurora-gradient hero), `app/docs/[[...slug]]/opengraph-image.tsx` (per-page dynamic title + section + description), `app/twitter-image.tsx` (re-exports OG).
    - **`<JwksFingerprint/>`** live component: RFC 7638 thumbprints of `/.well-known/audit-signing-key`, computed in-page with `createHash('sha256')`. Embedded in auditor persona, compliance overview, and audit-chain concept.
    - **PR preview auto-comment**: `.github/workflows/docs-preview-comment.yml` posts a curated reviewer checklist on every docs PR (alongside Vercel's auto preview-URL comment). `apps/docs/.vercelignore` trims deploy bundle.
    - **QoL adds** (max-width signal): `/api/docs` structured JSON index for AI consumers (companion to `/llms.txt`); `<RunnableExample/>` MDX wrapper for StackBlitz/CodeSandbox embeds; branded 404 page; `CHANGELOG.md`; `CONTRIBUTING.md`.
    - **Bugfix**: `<SdkVersionBadges/>` displayed package directory names (`@okoro/sdk-ts`, `@okoro/cli`) instead of published names (`@okoro/sdk`, `okoro (cli)`).
  Remaining for M-014 closure (operator-only — no further code work):
    - `pnpm install` from repo root.
    - Vercel project pointed at `apps/docs/` Root Directory.
    - `docs.okorolabs.io` DNS.
    - Env on Vercel: `OKORO_API_BASE_URL`, `NEXT_PUBLIC_DOCS_URL`.
- **Paths**: `apps/docs/**`, `tests/cross-package/docs-*.spec.ts`, `.github/workflows/docs.yml`, `.github/workflows/lighthouse-docs.yml`, `.github/workflows/docs-preview-comment.yml`
- **Goal**: Live (not static) documentation — every customer-visible contract
  renders from the running platform or workspace source. Drift becomes a
  build break, not a customer ticket.

### M-015 · Python SDK
- **STATUS**: ✅ landed by sid=a9198691 @ 2026-05-01 — 24 files, 70 tests green, mypy --strict clean, ruff clean, JWT byte-equivalent to TS SDK
- **Paths**: `packages/sdk-py/**`
- **Goal**: Mirror TS SDK for Python consumers (LangChain, CrewAI, custom).
- **Delivered**: `AsyncOkoro` (primary) + `Okoro` (sync wrapper), `agents`/`policies`/`verify`/`crypto` modules, pydantic v2 models for all wire shapes, typed error hierarchy, httpx async client with retry policy, hatchling build, pyproject with ruff + mypy strict + pytest config, README with quickstart.

### M-016 · Relying-party verifier (`@okoro/verifier-rp`) — NEW
- **STATUS**: ✅ landed by sid=a9198691 @ 2026-05-01 — 34 files, 58 tests green (vitest), property tests via fast-check, tsup ESM+CJS dual build, tree-shakeable subpath exports per adapter
- **Paths**: `packages/verifier-rp/**` (new package)
- **Goal**: Drop-in TS library that lets relying parties verify OKORO tokens
  **offline** via JWKS, with a small revocation cache and adapters for
  Express / Fastify / Hono / edge runtimes. Distinct from `sdk-ts` (which is
  principal-side); this package is what merchants and downstream services ship.
- **Delivered**: `OkoroVerifier` class, JWKS client + SWR cache, replay LRU keyed on jti, revocation cache (lazy /status poll + invalidation hook), Ed25519 offline verify via `@noble/ed25519` (zero `node:crypto` — edge-runtime ready), Express/Fastify/Hono adapters, full property-test suite, `getAgentPublicKey` callback design (RP supplies; documented in README).
- **Open question for operator**: Should `REPLAY_DETECTED` collapse to `INVALID_SIGNATURE` at the wire boundary, or remain distinguishable for RP observability? Currently distinguishable — flag if you want it collapsed.

### M-017 · Root e2e test harness (`tests/e2e`) — NEW
- **STATUS**: ✅ landed by sid=a9198691 @ 2026-05-01 — 24 files (16 test + 5 support + load + chaos + configs), tsc --noEmit clean, vitest skip-with-banner verified when API down
- **Paths**: `tests/**` (new top-level dir)
- **Goal**: Black-box validation suite mirroring `~/Downloads/files (7)/okoro-test.js`
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
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF) · gated on M-007 + 30 days of signal data
- **Paths**: `apps/ml/**` (new), `apps/api/src/modules/bate/ml/**`

### M-021 · Trust score time-series storage
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
- **Paths**: `apps/api/prisma/schema.prisma` (additions),
  `apps/api/src/modules/bate/history/**`

### M-022 · Cross-principal correlation engine
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF) · privacy review required first

---

## SPRINT S3 — Edge & enterprise (post $5K MRR)

See `docs/spec/01_MASTER.md` § 7 (Phase 3) and the master backlog
`docs/spec/BACKLOG.md` Epic 12-15.

---

### M-016 · `/.well-known/audit-signing-key` — public verifier endpoint
- **STATUS**: open
- **Paths**: `apps/api/src/modules/wellknown/**` (new module)
- **Goal**: Serve the OKORO audit signing public key as a JWKS so third
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
  (`scripts/{generate-okoro-keys,verify-spec,health-check}` shipped).
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

> Charter: ADRs 0008–0013 commit OKORO to MCP backbone, Auth0 bridge,
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
  when the request carries a `DPoP:` header (or `_okoro_dpop` for MCP
  stdio), gated by `OKORO_DPOP_REQUIRED` env flag.
- **Acceptance**:
  - `BuiltinPolicyEngine.evaluate()` is the single decision call.
  - All Phase-0 verify tests still green (no behavior drift).
  - DPoP step 4.5 has its own integration test under
    `apps/api/test/verify-dpop.e2e-spec.ts`.
  - Worker portability invariant (ADR-0003) preserved — both engine and
    DPoP util are framework-free.
- **Blocked by**: peer's `okoro:bug-fix-pass` releases the verify path.

### M-020 · Auth0 module — tests + e2e + dashboard wiring
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
- **Paths**: `apps/api/src/modules/auth0/**/*.spec.ts`,
  `apps/api/test/auth0.e2e-spec.ts`, `apps/dashboard/**`
- **Goal**: complete the Auth0 module (skeleton landed 2026-05-02):
  unit tests for adapter + service, e2e via supertest with Auth0 JWKS
  mocked, dashboard switches from "no auth" to `@auth0/nextjs-auth0`,
  Action source committed to `infra/auth0/actions/okoro-audit-login.js`.
- **Acceptance**: dashboard login works against Auth0 dev tenant,
  every login produces an OKORO audit row, MFA-skipped admin logins
  are FLAGGED.
- **Reference**: ADR-0009.

### M-021 · `@okoro/mcp-server` — tests + bin + dist
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
- **Paths**: `packages/mcp-server/**`
- **Goal**: scaffold landed 2026-05-02 (`server.ts` + tools + bin).
  Add: `npm pack` validation, vitest tests for each tool's
  args→handler→Okoro-call mapping (mock SDK), README example for
  Claude Desktop config, version-pin `@modelcontextprotocol/sdk` after
  next minor release.
- **Acceptance**: `npx @okoro/mcp-server` runs against a live OKORO
  staging API and `okoro.verify` returns valid responses.
- **Reference**: ADR-0008 §1.

### M-022 · MCP control-plane wiring
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
- **Paths**: `apps/api/src/modules/mcp/mcp.service.spec.ts`,
  `apps/api/src/modules/verify/algorithm/verify.algorithm.ts` (small
  edit — coordinate with M-019),
  `apps/api/src/modules/audit/audit.service.ts` (add `relyingPartyId`
  parameter wiring)
- **Goal**: when `@okoro/mcp-bridge` calls `/v1/verify` with an
  `mcpServerId` header, stamp `AuditEvent.relyingPartyId` on the
  resulting audit row, and surface `lastSeenAt` + `recentInvocations`
  on the MCP server list endpoint.
- **Acceptance**: dashboard MCP-server list shows real activity counts.

### M-023 · `AwsKmsAdapter` (KmsAdapter implementation)
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
- **Paths**: `apps/api/src/modules/kms/aws-kms.adapter.ts` + spec
- **Goal**: implement `KmsAdapter` from
  `apps/api/src/common/crypto/crypto.bootstrap.ts` against AWS KMS Sign
  API with `EdDSA`. JWKS publishing reads `listKeys()`. Caches active
  key in-memory with `kid` invalidation on rotation.
- **Acceptance**: integration test against `localstack` (KMS) green;
  audit chain signs and verifies through KMS-backed sign.
- **Reference**: ADR-0011 §4.

### M-024 · BATE signal weights for DPoP signals
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
- **Paths**: `apps/api/src/modules/bate/bate.scorer.ts`,
  `docs/BATE_ALGORITHM.md`
- **Goal**: add two signals: `agent.no_dpop` (+15 risk) and
  `agent.dpop_replay_attempt` (+50 risk + auto-flag), wire them in the
  scorer, document in BATE_ALGORITHM.md.
- **Reference**: ADR-0010 §2.

### M-025 · Bootstrap centralization + cross-package vitest workspace
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
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
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF) · **BLOCKS M-019, M-022, M-023**
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
- **Coordinate with**: peer holding `migrations/**` (`okoro:bug-fix-pass`).

### M-027 · `okoro-cli` — operator binary
- **STATUS**: claimed by sid=a9198691 @ 2026-05-02 (sub-divided into
  M-040a..M-040h under SPRINT S3 — Adoption Surface). The umbrella ticket
  remains here for cross-reference; deliverable is the union of the
  M-040 sub-tickets.
- **Paths**: `packages/cli/**` (NEW). **Reserved for peer**: the
  `okoro audit *` namespace (peer sid=3e2203ee `enterprise-plane`
  active claim notes "audit-CLI"). `okoro audit *` is exposed via the
  kubectl-style plugin discovery mechanism — peer ships `okoro-audit`
  on PATH and it appears as `okoro audit ...` automatically. Zero
  in-binary code collision.
- **Goal**: a Go single static binary (`okoro`) — see OD-009 (locked
  default). Subcommands:
  `okoro login`, `okoro logout`, `okoro whoami`, `okoro doctor`,
  `okoro init [--industry ...]`, `okoro agents {register,list,revoke,show}`,
  `okoro policy {create,list,revoke,inspect}`, `okoro verify <token>`,
  `okoro listen --forward-to`, `okoro trigger <event>`, `okoro tail audit`,
  `okoro dash` (TUI cockpit), `okoro kms rotate <purpose>`,
  `okoro mcp install` (Claude Desktop config helper).
- **Reads**: `~/.config/okoro/config.toml` (XDG-compliant) with API key
  in OS keychain (`99designs/keyring` — Keychain.app / Secret Service /
  Credential Manager). Falls back to `OKORO_API_KEY` env var for CI.
- **Reference**: OD-009/OD-010 (locked defaults), ADR-0011 §5 (rotation),
  ADR-0008 (mcp-server install), CLAUDE.md stack reality (one curve, one
  audited library).

### M-028 · Dashboard MCP-server discovery view
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF)
- **Paths**: `apps/dashboard/app/mcp-servers/**`
- **Goal**: Bloomberg-density list of registered MCP servers with
  recent invocation counts, last-seen timestamps, denial rate. One-click
  pause/resume.
- **Reference**: ADR-0008 §4.

### M-029 · `GcpKmsAdapter`
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF) · same shape as M-023, GCP Cloud KMS asymmetric sign.

### M-030 · `VaultTransitAdapter`
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 6 — see SESSION_HANDOFF) · same shape as M-023, HashiCorp Vault transit/sign.

### M-031 · `AzureKeyVaultAdapter`
- **STATUS**: open · pending Azure Key Vault EdDSA GA.

### M-032 · `Vault*HsmAdapter` for hardware HSM
- **STATUS**: open · deferred to first sovereign customer.

### M-033 · `CedarPolicyEngine` adapter
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 7) — extension open for prod evaluator wiring (`@cedar-policy/cedar-wasm`) in `app.module.ts`.
- **Paths**: `apps/api/src/common/policy-engine/cedar.engine.ts` + spec.
- **Shipped**: full `CedarPolicyEngine` implementing `PolicyEngine`,
  `CedarEvaluatorLike` interface for runtime swap, deny-reason mapping
  to ADR-0004 enum, spend-gate post-Allow, fail-closed on missing
  artifact. 7 spec tests covering Allow/Deny/error paths.
- **Reference**: ADR-0012.

### M-034 · `OpaPolicyEngine` adapter
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 7) — extension
  open for prod evaluator wiring (`@open-policy-agent/opa-wasm` or sidecar HTTP).
- **Paths**: `apps/api/src/common/policy-engine/opa.engine.ts` + spec.
- **Shipped**: full `OpaPolicyEngine` implementing `PolicyEngine`,
  `OpaEvaluatorLike` interface for WASM-vs-sidecar swap, deny_reasons
  multi-mapping with subReason forensics, spend-gate post-Allow,
  fail-closed on missing artifact. 8 spec tests.
- **Reference**: ADR-0012.

### M-035 · PQ hybrid sign/verify utility
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 7) — utility
  + spec only. Verify-path integration **still BLOCKED ON OPERATOR**
  (OD-008 flag flip + new OD-014 trigger criteria).
- **Paths**: `apps/api/src/common/crypto/pq.util.ts` + spec.
- **Shipped**: `signHybrid` / `verifyHybrid` / `packHybrid` /
  `unpackHybrid` against `@noble/post-quantum` ml_dsa65. FIPS 204 final
  signature length (3309 bytes) honored. 9 spec tests covering tamper
  detection on each half, malformed envelope, length-prefix robustness.
- **Reference**: ADR-0013, OD-014.

### M-036 · Audit storage compression (Parquet+zstd)
- **STATUS**: **Phase 0a (apps/api kernel) + 0b (audit-verifier portable port)
  + 0c (CLI corpus walker) LANDED** @ 2026-05-11 (ADR-0015). Phase 0a =
  dep-free, schema-free, framework-free manifest kernel in
  `apps/api/src/modules/audit/compression/`. Phase 0b = portable port into
  `@okoro/audit-verifier` (zero new deps, edge-runtime safe, public stable API)
  with 21 cross-package parity tests. Phase 0c = `okoro-audit-verify
  verify-manifests <dir>` subcommand + pure `verifyManifestCorpus()` API for
  programmatic offline corpus verification (per-slice walk, signing-keys
  aggregation, typed failure reasons).
  **Combined coverage: 41 jest (apps/api) + 33 vitest (audit-verifier) + 21
  cross-package parity = 95 tests guarding manifest integrity + corpus
  workflow end-to-end.**
  **Phases 1-3 BLOCKED ON OPERATOR — see OD-017** (Parquet/zstd deps,
  S3-vs-R2-vs-GCS, `AuditEvent.seq` migration, retention sweeper boundary,
  manifest publication policy, PQ hybrid manifest signing).
- **Paths**: `apps/api/src/modules/audit/compression/**`,
  `packages/audit-verifier/src/manifest.{ts,spec.ts}`,
  `packages/audit-verifier/src/manifest-corpus.{ts,spec.ts}`,
  `packages/audit-verifier/src/cli.ts` (additive subcommand),
  `packages/audit-verifier/src/index.ts` (additive exports),
  `tests/cross-package/audit-manifest-parity.spec.ts`,
  `docs/decisions/0015-audit-storage-compression.md`,
  (Phase 1+) `scripts/audit-{compress,restore}.ts`,
  (Phase 2+) `apps/api/prisma/schema.prisma` (additive: `AuditEvent.seq`,
  `AuditCompressionManifest`, `AuditCompressionCheckpoint`).
- **Prereq for**: ADR-0013 flag flip (PQ-hybrid signed audit row size doubles
  without warm-tier compression).

### M-037 · Audit signing routed through `KmsAdapter`
- **STATUS**: open · **BLOCKED on `audit.service.ts` change** (parallel
  session may hold this hot path; coordinate before claiming).
- **Paths**: `apps/api/src/modules/audit/audit.service.ts`,
  `apps/api/src/common/crypto/audit-chain.util.ts`.
- **Goal**: replace the env-derived `auditPrivateKey` with
  `getKmsAdapter().getActiveKey('AUDIT')`. Stamp `signingKeyId` on
  every appended event. Plumbs Round-6 schema column into Round-7
  KMS adapters end-to-end.

### M-038 · OpenTelemetry tracing wiring (call from `main.ts`)
- **STATUS**: open · scaffold landed Round 7.
- **Paths**: `apps/api/src/main.ts` (small edit), `apps/api/src/common/observability/tracing.bootstrap.ts` (NEW).
- **Goal**: `await initTracing(...)` from `main.ts` BEFORE
  `NestFactory.create()`. Add manual spans on `okoro.verify.algorithm`,
  `okoro.audit.chain.append`, `okoro.kms.<provider>.<op>`,
  `okoro.policy.engine.<id>.eval`. Operator picks exporter via env.
- **Reference**: see `tracing.bootstrap.ts` docstring for span naming.

### M-039 · Policy engine prod evaluator wiring (Cedar-WASM + OPA-WASM)
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 8) — extension
  open: AppModule import of `PolicyEngineModule` + `pnpm install` of the
  WASM packages.
- **Paths**: `apps/api/src/common/policy-engine/{cedar-wasm.evaluator,opa-wasm.evaluator,policy-engine.module}.ts`.
- **Shipped**: `CedarWasmEvaluator` (cedar-wasm SDK shape +
  obligation extraction from `@okoro_deny_reason("...")` annotations +
  `compileCedarPolicy` helper). `OpaWasmEvaluator` (opa-wasm load+evaluate
  + LRU policy cache + `buildOpaArtifact` helper). `PolicyEngineModule`
  registers chosen evaluators from `OKORO_POLICY_ENGINES` env at boot.
  Lazy-load shields unit tests from WASM dep weight.
- **Reference**: ADR-0012, OD-013.

### M-040 · Clerk IdP — full e2e + dashboard swap path
- **STATUS**: open · adapter landed Round 7.
- **Paths**: `apps/api/src/modules/idp-clerk/clerk.adapter.spec.ts`
  (NEW), `apps/api/test/clerk.e2e-spec.ts` (NEW), dashboard config
  (NEW env-flag for IdP selection).
- **Goal**: spec tests with mocked Clerk JWKS, e2e via supertest,
  dashboard env switch (`OKORO_IDP_PROVIDER=auth0|clerk`).
- **Reference**: ADR-0009-A, OD-015.

### M-042 · WorkOS IdP adapter (third IdpAdapter)
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 8) — extension
  open: spec tests + e2e + dashboard env switch (similar to M-040 for Clerk).
- **Paths**: `apps/api/src/modules/idp-workos/{workos.adapter,idp-workos.module}.ts`.
- **Shipped**: `WorkOsAdapter` implementing `IdpAdapter` against
  WorkOS sealed sessions (fundamentally different shape from RS256-JWT
  Auth0/Clerk, validates the interface holds for non-JWT IdPs).
  Module wires the WorkOS SDK lazily.
- **Reference**: ADR-0009, ADR-0009-B (implicit).

### M-043 · PrincipalOnboarding (OD-012)
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 8) — extension
  open: dashboard wizard UI + service-internal hooks (agent.create,
  policy.create, verify success, kms.configure call `markStep`).
- **Paths**: `apps/api/prisma/migrations/20260502000600_principal_onboarding/migration.sql`,
  `apps/api/prisma/schema.prisma` (model + Principal back-relation),
  `apps/api/src/modules/onboarding/{onboarding.{dto,service,controller,module}}.ts`.
- **Shipped**: 7-step checklist (`hasFirstAgent`/`Policy`/`Verify`/
  `KmsConfigured`/`McpServerRegistered`/`WebhookSubscribed`/
  `PaymentMethodAdded`) with one-way ratchet + activation-funnel
  timestamps. `GET /v1/me/onboarding` + `PATCH /v1/me/onboarding/step`.
- **Reference**: OD-012.

### M-044 · CF Worker Phase 3 m2 — KV-cache edge verify
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 8). Gated by
  `OKORO_EDGE_VERIFY_ENABLED=true` env; defaults off so production stays
  on the m1 origin-passthrough path until shadow-deploy validates the
  edge decisions.
- **Paths**: `workers/cf-verify/src/{kv-cache,token,edge-verify}.ts` +
  `index.ts` integration.
- **Shipped**: KV cache adapter (agent + policy + per-day spend). Edge
  JWT decode + Ed25519 verify via WebCrypto. Edge verify path with full
  ADR-0004 denial precedence. Forward-to-origin on cache miss / spend
  ambiguity / suspended agent / DPoP-required (when wired).
- **Reference**: ADR-0003, ADR-0008, ADR-0010.

### M-045 · Industry quickstart `ai-platform-tool-call`
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 8) — peer
  also contributed `mcp-server.ts` (verifyKey/arg pattern). My
  contribution: `server.ts` (mcp-bridge wrap pattern), `okoro.ts`
  helper, `demo-agent.ts` end-to-end. Two-flavor example.
- **Paths**: `examples/ai-platform-tool-call/{src/{okoro,server,demo-agent}.ts,tsconfig.json}`.
- **Reference**: OD-011.

### M-041 · Compliance redact endpoint — e2e + dashboard surface
- **STATUS**: open · controller + service + unit spec landed Round 7.
- **Paths**: `apps/api/test/compliance-redact.e2e-spec.ts`,
  `apps/dashboard/app/audit/[id]/page.tsx` (NEW redact button on
  audit-event detail).
- **Goal**: full-stack test (POST /v1/compliance/audit/redact-event +
  GET /v1/audit-events/{id} returns nulls), dashboard "redact this
  event" button gated to FULL-scope API keys.
- **Reference**: ADR-0006, OD-016.

---

## SPRINT S3 — Adoption surface (post 2026-05-02)

> Charter: ship Stripe/PayPal-tier frictionless adoption. Operator
> directive 2026-05-02: "frictionless adoption across all industries
> for OKORO, super intuitive and easy to use, terminal functions
> world-class". Decisions locked in `OPERATOR_DECISIONS.md` OD-009..OD-012.
> All M-040* tickets owned by sid=a9198691 (claim
> `okoro:adoption-frictionless-cli`, ttl 14400). The `okoro audit *`
> CLI namespace is reserved for peer `enterprise-plane` and surfaced via
> kubectl-style plugin discovery (any `okoro-*` binary on PATH).

### M-040a · CLI core + plugin discovery
- **STATUS**: claimed by sid=a9198691 @ 2026-05-02
- **Paths**: `packages/cli/{main.go,go.mod,cmd/{root,login,logout,whoami,
  doctor,init,version,completion}.go,internal/{config,keychain,oauth,
  client,plugin,version}/**}`
- **Goal**: cobra-based CLI skeleton with kubectl-style plugin discovery
  (`okoro foo` → executes `okoro-foo` if present on PATH and not a
  built-in). Device-code OAuth login (OD-009) with OS-keychain caching.
  `okoro doctor` runs connectivity + clock-skew + JWKS-reachability +
  onboarding-state checks (the last gated on M-026 + OD-012 unblock).
- **Acceptance**:
  - `okoro --version` prints semver + commit SHA + build date.
  - `okoro login --api-key <key>` round-trips: writes config, writes
    keychain entry, `okoro whoami` returns principal email.
  - `okoro doctor` returns non-zero exit when API unreachable, prints a
    Bloomberg-density check report otherwise.
  - Plugin discovery test: drop `okoro-hello` shim on PATH, `okoro hello`
    invokes it with all remaining args forwarded.
  - `go test ./...` green; `go vet` clean; `golangci-lint` clean.

### M-040b · CLI distribution + installer infra
- **STATUS**: claimed by sid=a9198691 @ 2026-05-02
- **Paths**: `.goreleaser.yaml` (NEW root), `scripts/install/install.sh`
  (NEW), `Makefile` (additive — only the `cli-*` targets), `packages/cli/
  README.md`
- **Goal**: cross-compile darwin/linux/windows × amd64/arm64 via
  goreleaser. Publish Homebrew tap (`klytics/homebrew-okoro`), Scoop
  bucket, apt repo metadata. `curl -fsSL https://get.okoro.dev/install.sh
  | sh` installs the latest release with checksum verification. Sigstore
  signature verification optional (`OKORO_VERIFY_SIGNATURE=1`).
- **Acceptance**:
  - `goreleaser release --snapshot --clean` builds 6 binaries locally.
  - `install.sh` works against a snapshot tarball staged on a tmp
    HTTP server.
  - Homebrew formula generated; `brew install` round-trips on macOS.
  - SBOM (`cyclonedx`) emitted alongside binaries.

### M-040c · CLI agent / policy / verify subcommands
- **STATUS**: ✅ DONE @ 2026-05-02 by sid=cli-deepwire (Round 9)
- **Paths**: `packages/cli/cmd/{agents,policy,verify,events,report}.go`,
  `packages/cli/internal/client/**` (hand-rolled, not oapi-codegen — see
  rationale in `docs/SESSION_HANDOFF.md` Round 9)
- **What landed**: `agents register|show|status|revoke` with optional
  `--generate-keypair` Ed25519 local mint; `policy create|list|revoke|inspect`
  with imperative flags or `--file`; `verify` with denial-precedence
  rendering in canonical order from CLAUDE.md invariant 6 (NOT spec
  alphabetical order); `events list|tail|export` (cursor pagination,
  signal-aware Ctrl-C, streaming NDJSON); `report` (BATE signal). Every
  command has `--json` mode. httptest-backed tests across the client.
- **Spec drift logged**: `OKORO_API_SPEC.yaml` lines 572-581 list denial
  reasons alphabetically; needs to match canonical order from CLAUDE.md
  invariant 6 (next API version bump).

### M-040d · CLI listen / trigger / tail / dash (advanced surface)
- **STATUS**: 🟡 PARTIAL — `tail` shipped as `okoro events tail` in
  Round 9 (cursor-poll, no SSE needed for an append-only chain).
  `export` shipped as `okoro events export` (streaming NDJSON).
  `listen` and `trigger` still gated on the server-side webhook
  subscription endpoints (not in OpenAPI spec yet — outbox worker
  shipped but not the subscribe API). `dash` (bubbletea TUI cockpit)
  is open: combines whoami + last 10 events + last 10 verifies.
- **Paths**: `packages/cli/cmd/{listen,trigger,dash}.go`,
  `packages/cli/internal/{tunnel,tui}/**`
- **Coordinate with**: peer M-008 (webhooks delivery worker — shipped
  ✅ 2026-05-02) and the eventual subscription-management endpoints.

### M-040e · `examples/fintech-payments` quickstart
- **STATUS**: claimed by sid=a9198691 @ 2026-05-02
- **Paths**: `examples/fintech-payments/**` (NEW)
- **Goal**: Stripe-style checkout server in TypeScript (Express) where
  every authorization passes through `okoro.verify(...)` before charging.
  Includes a Faker-backed test harness, a denial-precedence walk-through
  (force each of the 9 reasons), and a one-page runbook for on-call.
- **Acceptance**: `pnpm tsx src/server.ts` boots; `make demo` walks
  through happy path + 3 denial reasons against a live OKORO instance.

### M-040f · `examples/ai-platform-tool-call` quickstart
- **STATUS**: claimed by sid=a9198691 @ 2026-05-02
- **Paths**: `examples/ai-platform-tool-call/**` (NEW)
- **Goal**: an MCP agent (Claude Desktop or generic MCP client) that
  calls `okoro.verify` via peer's `@okoro/mcp-server` (2026-05-02 drop)
  before invoking a downstream API. Demonstrates the AI-platform path
  for OKORO adoption (the natural early-adopter wedge).
- **Acceptance**: ships a working `mcp.json` snippet for Claude Desktop
  + a generic Node MCP client harness.

### M-040g · `examples/saas-seat-provisioning` quickstart
- **STATUS**: claimed by sid=a9198691 @ 2026-05-02
- **Paths**: `examples/saas-seat-provisioning/**` (NEW)
- **Goal**: SCIM-flavored agent provisioning — the SaaS pattern where an
  enterprise customer auto-provisions agent identities and per-seat
  policies via SCIM-shaped endpoints. Cleanest greenfield wedge.
- **Acceptance**: provisions 10 agents via SCIM POSTs, mints 10 policies,
  verifies 10 calls, exports an audit slice.

### M-040h · Per-persona docs landings
- **STATUS**: claimed by sid=a9198691 @ 2026-05-02
- **Paths**: `docs/personas/{developer,security,sre,auditor}.md`,
  `docs/INDUSTRY_QUICKSTARTS.md`, `docs/PLUGIN_AUTHORS.md`,
  `docs/collections/okoro.openapi.json` (symlink-shaped reference)
- **Goal**: four curated entry paths through the same canonical content.
  Each persona page ≤ 5 links + 30-sec value prop + first-action call.
  Industry quickstarts page indexes the three M-040e/f/g examples and
  documents the second-wave verticals (health, marketplace, gov, edu,
  supply-chain).
- **Acceptance**: every persona page links to a runnable artifact within
  two clicks. No dead links via `lychee` link-check.

---

## SPRINT S2 — Round 9 gap-closure (2026-05-02)

### M-046 · WASM evaluator spec tests
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 9).
- **Paths**: `apps/api/src/common/policy-engine/{cedar-wasm,opa-wasm}.evaluator.spec.ts`.
- **Shipped**: jest specs for both WASM evaluators with fake-injected
  modules. Cedar tests: artifact mapping, missing-artifact rejection,
  `okoro_deny_reason` annotation extraction, validator pass-through.
  OPA tests: load+evaluate, LRU cache hit/miss, implicit deny on empty
  result, deny_reasons + metadata propagation, non-string filtering.

### M-047 · WorkOS + Onboarding service specs
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 9).
- **Paths**: `apps/api/src/modules/idp-workos/workos.adapter.spec.ts`,
  `apps/api/src/modules/onboarding/onboarding.service.spec.ts`.
- **Shipped**: WorkOS adapter coverage of valid session, throw-on-bad,
  expired-session, Redis cache hit, missing-orgId; okoro:* role filter.
  Onboarding spec covers lazy-create on first read, completed-count +
  timestamps, markStep upsert, unknown-step rejection, one-way-ratchet
  timestamp preservation.

### M-048 · CF Worker edgeVerify spec
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 9).
- **Paths**: `workers/cf-verify/test/edge-verify.spec.ts`,
  `workers/cf-verify/test/shadow.spec.ts`.
- **Shipped**: full ADR-0004 denial-precedence sweep at the edge —
  every branch (missing token, malformed, hard-expired, agent miss,
  policy miss, AGENT_REVOKED, SUSPENDED-forwards, POLICY_REVOKED,
  POLICY_EXPIRED, INVALID_SIGNATURE, SCOPE_NOT_GRANTED, SPEND_LIMIT_EXCEEDED,
  per_request-spend-forwards, TRUST_SCORE_TOO_LOW, happy path, merchant
  domain allow-list). Shadow spec covers mode selection, divergence
  comparison ignoring timestamps, header encoding.

### M-049 · CF Worker shadow-mode
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 9).
- **Paths**: `workers/cf-verify/src/shadow.ts` + `index.ts` integration.
- **Shipped**: three-mode rollout (off/shadow/live). Shadow runs edge AND
  origin in parallel, serves origin response, emits
  `X-OKORO-Edge-Divergence: agree | diverge:<fields> | edge-forward:no-edge-decision`,
  records to optional Workers Analytics Engine binding. Operator flips
  to `live` after observing N days of high agreement (target ≥ 99.9%).

### M-050 · AppModule wiring + Onboarding backfill
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 9).
- **Paths**: `apps/api/src/app.module.ts` (added 8 module imports +
  inserted into imports array), `apps/api/src/modules/onboarding/onboarding.backfill.ts`,
  `onboarding.module.ts` (registers backfill provider),
  `apps/api/package.json` (optionalDependencies: cedar-wasm, opa-wasm,
  workos, aws-sdk client-kms, google-cloud kms).
- **Shipped**: AppModule now boots KmsModule, PolicyEngineModule (which
  registers Cedar+OPA WASM evaluators per `OKORO_POLICY_ENGINES` env),
  Auth0Module, IdpClerkModule, IdpWorkOsModule, McpModule, ComplianceModule,
  OnboardingModule. OnboardingBackfill is a periodic SQL reconciler that
  flips onboarding steps based on entity existence — zero edits to
  existing services, idempotent, self-healing.

---

## SPRINT S2 — Round 10 honest-gap closure (2026-05-02)

### M-051 · M-037 audit signing through `KmsAdapter`
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 10).
- **Paths**: `apps/api/src/common/crypto/{audit-signer.service,audit-signer.service.spec}.ts`,
  `apps/api/src/common/crypto/audit-chain.util.ts` (added `signWithSigner`),
  `apps/api/src/modules/audit/{audit.service,audit.module}.ts` (inject + use signer).
- **Shipped**: `AuditSignerService` resolves in priority order
  KMS → env keys → ephemeral dev fallback. `AuditChainUtil.signWithSigner`
  delegates the signing operation to a callback so KMS-backed signers
  participate without exposing private bytes. Audit.service stamps
  `signingKeyId` from the active KMS kid on every appended row.
- **Reference**: ADR-0011, M-037.

### M-052 · Cloud KMS production boot
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 10).
- **Paths**: `apps/api/src/modules/kms/kms.module.ts` (replaced 3 throws
  with real SDK construction; lazy-loaded cloud SDKs).
- **Shipped**: `buildAws` uses `@aws-sdk/client-kms` Decrypt for
  envelope-encrypted Ed25519 (ADR-0011 — AWS doesn't yet GA EdDSA Sign).
  `buildGcp` uses `@google-cloud/kms` `asymmetricSign` for native
  Ed25519. `buildVault` uses `fetch` against Vault transit/sign with
  X-Vault-Token. Each path reads provider-specific env (e.g.
  `OKORO_AWS_KMS_AUDIT_{KID,WRAPPED,PUB}`) and fails loud on missing values.
- **Reference**: ADR-0011 §4, M-023/M-029/M-030.

### M-053 · OnboardingBackfill scheduling + admin endpoint
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 10).
- **Paths**: `apps/api/src/modules/onboarding/{onboarding.backfill,onboarding.controller}.ts`.
- **Shipped**: `@Cron('*/5 * * * *')` decorator (lazy-loaded
  `@nestjs/schedule`), `OnModuleInit` boot pass after 30s,
  `lastReport` cache, admin endpoints `POST /v1/me/onboarding/admin/backfill`
  and `GET /v1/me/onboarding/admin/backfill/last` gated by
  `X-OKORO-Admin` header (`OKORO_ADMIN_TOKEN` env).
- **Reference**: OD-012.

### M-054 · OTel `initTracing()` in main.ts
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 10).
- **Paths**: `apps/api/src/main.ts` (call before `NestFactory.create`).
- **Shipped**: `initTracing` invoked with env-driven config
  (`OKORO_OTEL_ENABLED`, `OKORO_OTEL_SERVICE_NAME`, `OKORO_OTEL_EXPORTER`).
  Resource attrs include `deployment.environment` and optional
  `okoro.region`. SIGTERM/SIGINT handlers flush + shutdown the SDK.
- **Reference**: ADR-0011 §6, M-038.

### M-055 · BATE anomaly detector R-1..R-5
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 10).
- **Paths**: `apps/api/src/modules/bate/{bate.anomaly,bate.anomaly.spec}.ts`.
- **Shipped**: pure-function detector with 5 rules — velocity (R-1),
  geographic inconsistency (R-2), spend pattern deviation (R-3, per-currency
  CV), failed-verify spike (R-4), delegation chain depth (R-5). Tunables
  in `ANOMALY_THRESHOLDS` constant. 14 jest specs covering each rule's
  warn/crit/skip-on-small-sample paths.
- **Reference**: M-007 extension.

### M-056 · Spec-sync drift CI workflow
- **STATUS**: shipped by sid=3e2203ee @ 2026-05-02 (Round 10).
  Onion-peel regression fixed by sid=opus-4-7-feat-flush @ 2026-05-18
  on `fix/spec-sync-denial-reason-schema` (PR #26 closed, superseded
  by **PR #32 merged 2026-05-21** sha 991a288 — extractor sanity,
  empty-extraction-fails-loud, canonical `DenialReason` top-level
  schema, `PENDING_VERIFICATION` AgentStatus enum member).
- **Paths**: `.github/workflows/spec-sync.yml`.
- **Shipped**: three jobs run on PRs touching spec / types / Prisma /
  DTO / verify-algorithm paths:
  (1) OpenAPI ↔ Zod parity (calls `scripts/check-openapi-zod-parity.ts`),
  (2) OpenAPI ↔ Prisma model parity,
  (3) Denial precedence enum byte-identical across engine, verifier-rp,
  OpenAPI (ADR-0004 lock).

### M-057 · OpenAPI ↔ Zod intent-schema drift (CLOSED on main)
- **STATUS**: closed by main work (PR #32 + the intent.ts Zod schemas
  that landed alongside the spec-sync infra). Originally surfaced as
  "13 components in OpenAPI ↔ Zod" in the 2026-05-18 handoff. Confirmed
  green by parallel agent in 2026-05-21 session — see
  `docs/SESSION_HANDOFF.md` 2026-05-21 entry.
- **Paths**: `packages/types/src/intent.ts` (NEW), expanded
  `packages/types/src/schemas.ts` for AgentStatus / AuditEvent /
  AgentPolicy.
- **No new PR needed** — the agent that researched this independently
  reached the same conclusion the merge proved.

### M-058 · OpenAPI ↔ Prisma drift (CLOSED on main)
- **STATUS**: closed by main work (PR #32 — `MODEL_MAPPINGS` in
  `apps/api/scripts/check-openapi-prisma-parity.ts` got per-model
  `internalFields` expansion + OpenAPI public-side additions for
  AgentPolicy.label, AuditEvent.claimedAgentId, AuditEvent.actionHash,
  AgentStatus.pending_verification, and renames for
  decisionReason / signature). Verified green by both the local parity
  script post-merge and a parallel agent independently.
- **Paths**: `apps/api/scripts/check-openapi-prisma-parity.ts`,
  `docs/spec/OKORO_API_SPEC.yaml`.
- **No new PR needed**.

### M-059 · DenialReason top-level OpenAPI enum INTENT_MISMATCH backfill
- **STATUS**: closed by sid=opus-4-7-feat-merge @ 2026-05-21 on
  `feat/sdk-verify-gateway-hardening` (commit 377fd43). Original
  flagging in 2026-05-18 handoff "what's next" item #2.
- **Paths**: `docs/spec/OKORO_API_SPEC.yaml` (top-level
  `components.schemas.DenialReason.enum`).
- **Why this slipped past local parity**: `pnpm check:openapi-zod`
  validates the inline `VerifyResponse.denialReason` enum (which had
  INTENT_MISMATCH from main's merge); the CI bash extractor targets
  the top-level reusable `DenialReason` schema, which lagged by one
  reason. The same class of "different tools extract from different
  spots" bug as M-056 onion-peel #2 — kept in mind for future
  extractor design.

---

### M-060 · Cross-project agent orchestrator + ROI surface (umbrella)
- **STATUS**: open @ 2026-05-21 — unblocked by OD-020 (`accept defaults
  D1–D7` in ADR-0020). Umbrella for M-060a..g; each sub-module is
  independently claimable but ordering matters (60a → 60b → 60c → 60d
  → 60e + 60f + 60g land in parallel after 60d).
- **Paths**: see per-sub-module Paths below.
- **Goal**: ship OKORO as the cross-project agent orchestrator (with
  ComplianceKit as first external consumer + ROI rollup as the
  executive narrative surface) per ADR-0020.
- **Strategic invariants** (must hold across the family):
  - All 8 OKORO invariants (root CLAUDE.md) preserved — D1–D7 audited
    in ADR-0020 § Consequences.
  - "Zero OKORO changes to onboard project #3" (D6 onboarding contract).
  - "Every task ROI-tagged" — Zod-enforced at envelope validation (D7).
- **Acceptance** (family-level):
  - All sub-modules shipped + green on `pnpm check`.
  - Load gates in M-060g hold the V1 SLOs from D6.
  - ComplianceKit dogfood (M-060e) running in CK staging for ≥ 7 days
    with no orchestrator-side incidents before V1 GA flag flip.

### M-060a · `packages/types` orchestrator + ROI schemas
- **STATUS**: open @ 2026-05-21 — smallest first PR; **operator's D7a
  taxonomy refinement happens here**.
- **Paths**: `packages/types/src/orchestrator.ts` (NEW),
  `packages/types/src/orchestrator-roi.ts` (NEW),
  `packages/types/src/index.ts` (re-export),
  `docs/spec/OKORO_API_SPEC.yaml` (orchestrator section additions).
- **Goal**: Zod schemas for `TaskEnvelope`, `TaskStatus`, `RoiActivity`,
  `RoiActuals`, `AgentRef`, `HumanRef`, `ProjectManifest`. Sub-type
  literal unions (`RevenueSub`, `CostSub`, `RiskSub`, `VelocitySub`,
  `DiscoverySub`) defined per D7a defaults; operator may refine in own
  commit before module ships.
- **Acceptance**:
  - All schemas exported and consumed by stub imports in `apps/api`
    and `packages/sdk-ts` (forward-declared, no business logic yet).
  - OpenAPI parity gate (`pnpm check:openapi-zod`) green for new
    schemas.
  - Unit tests cover required-field enforcement (especially `roi`).

### M-060b · Orchestrator module (API control plane)
- **STATUS**: open @ 2026-05-21 — depends on M-060a.
- **Paths**: `apps/api/src/modules/orchestrator/**` (NEW: module,
  controller, service, dto, worker, specs),
  `apps/api/prisma/schema.prisma` (NEW: `Task`, `SlackIntegration`,
  `ProjectManifest` models; nullable `taskId` column on `AuditEvent`),
  `apps/api/prisma/migrations/<ts>_orchestrator/migration.sql` (NEW,
  additive),
  `apps/api/src/app.module.ts` (add OrchestratorModule import).
- **Goal**: NestJS module exposing `/v1/tasks` (create, list, get,
  claim, reportEvent, completeWithActuals, approve, reject). State
  machine per D3. Task event emission rides existing audit chain (D2).
  Tenant isolation via `principalId` on every query (invariant #5).
- **Acceptance**:
  - Migration immutable (`pnpm check:migrations` green).
  - OpenAPI/Prisma parity (`pnpm check:openapi-prisma`) green.
  - State-machine transitions covered by service specs.
  - Audit-chain integration tested: every state transition emits a
    signed AuditEvent with `taskId` populated; chain-verification
    spec exercises a multi-state task.
  - Approval flow off the verify hot path — no `apps/api/src/modules/
    verify/` edits in this PR (guard for invariant #2).
  - **EQR-5 paired tests** (CLAUDE.md crypto/audit/tenant mandate):
    `task.audit-chain.integrity.spec.ts`,
    `task.kms-signature.spec.ts`,
    `task.tenant-isolation.spec.ts` (cross-principalId leakage —
    explicit negative tests across N≥3 principals).
  - **Threat-model delta** appended to `docs/THREAT_MODEL.md` in the
    same PR per ADR-0020 EQR-5 (STRIDE entries for spoofing,
    tampering, repudiation, info-disclosure, DoS, EoP — each tied to
    its D-decision mitigation).
  - **Observability** (EQR-2): all 9 orchestrator metrics emitting
    correctly with `principalId` label; structured log redaction for
    `riskTier ∈ {write, admin}` payloads tested.

### M-060c · `@okoro/sdk-ts` AND `@okoro/sdk-py` `tasks.*` methods
- **STATUS**: open @ 2026-05-21 — depends on M-060b API surface.
  **Both SDKs ship in parallel** because M-060e (CK) uses Python on
  the API/agent side and TS on the web side.
- **Paths**:
  - TS: `packages/sdk-ts/src/tasks.ts` (NEW),
    `packages/sdk-ts/src/index.ts` (re-export),
    `packages/sdk-ts/test/tasks.spec.ts` (NEW).
  - Py: `packages/sdk-py/src/okoro/tasks.py` (NEW),
    `packages/sdk-py/src/okoro/__init__.py` (re-export),
    `packages/sdk-py/tests/test_tasks.py` (NEW).
- **Goal**: `client.tasks.create()`, `.claim()`, `.list()`,
  `.reportEvent()`, `.awaitApproval()`, `.completeWithActuals()` in
  both SDKs with identical contract (parity-tested). Portable per
  invariant #8 (no Node-only APIs in TS; no OS-specific deps in Py).
  First real external users are M-060e (Py for CK agents, TS for CK
  web admin).
- **Acceptance**:
  - TS: browser + Node runtime smoke tests.
  - Py: Python 3.11 + 3.12 smoke tests.
  - Round-trip spec in each language: create → claim → reportEvent →
    complete with actuals against a mock API; ROI rollup math
    verified.
  - **Cross-SDK parity test** in `tests/parity/orchestrator-sdk-parity.spec.ts`
    asserting both SDKs produce identical wire payloads for the same
    input (CLAUDE.md cross-package parity gate).
  - `npm pack` produces valid TS tarball; `python -m build` produces
    valid Py wheel.
- **Claim ergonomics**: may split into `M-060c-ts` and `M-060c-py` if
  two sessions want to parallelize; otherwise treat as one logical
  unit.

### M-060d · `packages/integrations/slack` adapter
- **STATUS**: open @ 2026-05-21 — depends on M-060b + outbox.
- **Paths**: `packages/integrations/slack/**` (NEW package),
  `apps/api/src/modules/orchestrator/integrations/slack.controller.ts`
  (NEW: interactivity callback).
- **Goal**: Inbound (OKORO→Slack) outbox subscriber posts threaded
  task lifecycle messages + approval cards. Outbound (Slack→OKORO)
  HMAC-validated interactivity callback flips `awaiting_approval` →
  `approved/rejected`. KMS-signed button payloads (D5c).
- **Acceptance**:
  - Slack HMAC verification spec'd against known-good vectors.
  - Idempotent re-delivery handled (Slack `event_id` as idem key).
  - Forged button payload rejected (KMS signature mismatch path
    tested).
  - DB-as-truth: orchestrator state correct when Slack post fails
    (chaos test).
  - **EQR-5 paired tests** (CLAUDE.md crypto/auth mandate):
    `slack.hmac.spec.ts`, `slack.kms-signature.spec.ts`,
    `slack.replay-attack.spec.ts`,
    `slack.forged-payload.spec.ts`,
    `slack.cross-principal-callback.spec.ts` (Slack user in workspace
    A cannot approve task scoped to principalId B — D5b enforcement).
  - **Security alert wiring**: `slack_callback_total{result=kms_invalid}`
    > 0/min for 5m triggers `OrchestratorSlackCallbackForgeryAttempts`
    alert per EQR-2.
  - **Audit event** `intent.approval.forgery_attempt` emitted on every
    KMS-mismatch callback (per EQR-3 mitigation row).

### M-060e · ComplianceKit consumer wiring (in CK repo)
- **STATUS**: blocked on M-060a..d shipping; tracked here for
  cross-repo visibility. **Wait** for the active CK peer session
  (`cursor/production-env-seed-alignment` branch, P1-C1 + P1-H1/H2 +
  P2-H1 + defense-in-depth work) to land before opening this.
- **Paths**: ComplianceKit repo (separate).
  - `apps/api/app/integrations/okoro_orchestrator.py` (NEW) —
    Python integration layer using `@okoro/sdk-py`.
  - `apps/api/app/agents/orchestrator.py` (MODIFIED) — add the **D8
    seam check** before any task: if threshold rule matches, route
    via OKORO; otherwise stay internal. CK's internal 10-agent
    swarm scheduling is **preserved unchanged** for sub-seam tasks
    (CK's < 45-min vault SLA is load-bearing).
  - `apps/api/app/config/okoro_manifest.json` (NEW) — D6
    `ProjectManifest` declaring CK's task kinds, capabilities, ROI
    sub-type extensions, and D8 thresholds.
  - `apps/web/app/admin/orchestrator/page.tsx` (NEW) — web admin
    tile using `@okoro/sdk-ts` for cross-project visibility.
  - `docs/adr/00NN-okoro-orchestrator-integration.md` (NEW CK ADR)
    — mirror of OKORO ADR-0020 from CK's perspective; documents
    which tasks route via OKORO vs. stay internal.
- **Goal**: first real-world dogfood. Validates D6 "zero OKORO
  changes to onboard project #3" promise (CK is project #2 in the
  test). Validates D8 additive-only interop (CK's internal orchestrator
  preserved). Produces evidence for OKORO sales narrative + ROI
  attribution for CK's GTM motion.
- **Acceptance**:
  - CK staging running ≥ 7 days against OKORO staging with no
    orchestrator-side incidents.
  - **CK's < 45-min vault SLA still holds** (load test before + after
    M-060e ships shows no regression — non-negotiable per CK
    CLAUDE.md rule #2).
  - ROI rollup populated (M-060f visible with real CK data —
    `cost_avoided` for evidence freshness, `risk_reduced` for
    compliance gaps closed, `revenue` for onboarding velocity).
  - Onboarding effort log: capture actual LOC + time, confirm
    ≤ ~50 LOC of declaration code + < 2 dev-days as D6 implies (the
    business-logic integration may exceed this; the *declarative
    onboarding* part should not).
- **Coordination**: CK has its own CLAUDE.md / WORK_BOARD / ADR
  conventions; this work in CK must follow CK's protocols (CLAUDE.md
  is canonical there; AGENTS.md is a symlink per operator's memory).

### M-060f · ROI rollup endpoint + dashboard tile
- **STATUS**: open @ 2026-05-21 — depends on M-060a + M-060b.
- **Paths**: `apps/api/src/modules/orchestrator/roi.controller.ts`
  (NEW), `apps/api/src/modules/orchestrator/roi.service.ts` (NEW),
  `apps/dashboard/app/orchestrator/roi/page.tsx` (NEW + child
  components).
- **Goal**: `GET /v1/orchestrator/roi/rollup` returns per-project /
  per-team / per-kind aggregation with the cost-model normalization
  from D7b. Dashboard tile renders the executive narrative
  (revenue-adjacent / cost-avoided / risk-reduced / velocity /
  discovery counts and totals).
- **Acceptance**:
  - principalId scoping (invariant #5) tested with multi-tenant
    fixtures.
  - Cost-model math (D7b severity ladder + hourly rate) covered by
    pure-function specs.
  - Dashboard tile renders correctly when ROI data is empty — no
    fake-data fallback (invariant #4).

### M-060g · Load gates (k6) and chaos coverage
- **STATUS**: open @ 2026-05-21 — depends on M-060b + M-060d.
- **Paths**: `tests/load/orchestrator.k6.ts` (NEW),
  `tests/chaos/orchestrator-slack-outage.spec.ts` (NEW),
  `tests/chaos/orchestrator-db-failover.spec.ts` (NEW),
  `tests/chaos/orchestrator-audit-chain-break.spec.ts` (NEW).
- **Goal**: Encode the V1 SLOs from ADR-0020 EQR-1 as automated gates
  that block the V1 GA flag flip if any regress. Chaos coverage for
  the FMEA matrix in ADR-0020 EQR-3 (Slack outage D5d, DB failover,
  audit-chain break — wake-the-house alert path).
- **Acceptance**:
  - All 8 EQR-1 SLOs measured + asserted in CI nightly with
    error-budget tracking.
  - Slack-outage chaos test: orchestrator state correct, approval
    backlog drained on recovery, alert `OrchestratorApprovalBacklog`
    fires per EQR-2 threshold.
  - DB-failover chaos test: RTO ≤ 5m, no audit-chain break, no
    orphaned task state.
  - Audit-chain-break chaos test: wake-the-house alert fires within
    60s; orchestrator halts ingestion (zero tolerance per invariant #3).

### M-060h · Operator runbook + observability dashboards
- **STATUS**: open @ 2026-05-21 — depends on M-060b shipping
  (need real metrics flowing to author dashboards).
- **Paths**: `docs/runbooks/orchestrator.md` (NEW; stub authored in
  ADR-0020 EQR-9 follow-up), `infra/observability/dashboards/orchestrator.json`
  (NEW Grafana dashboard JSON), `infra/observability/alerts/orchestrator.yml`
  (NEW Prometheus alerting rules per ADR-0020 EQR-2).
- **Goal**: Complete operational runbook with exact commands +
  expected outputs per docs/CLAUDE.md mandate. Wire all EQR-2 alerts
  to PagerDuty. Build the operator-facing Grafana dashboard for the
  SLI/SLO table.
- **Acceptance**:
  - Runbook covers all FMEA scenarios from ADR-0020 EQR-3 with
    verified commands (each command run live + output sample
    captured).
  - Bulk-approve flow rehearsed end-to-end (Slack-down scenario via
    M-060f dashboard tile) with operator sign-off.
  - All 4 EQR-2 alerts (TaskCreateErrorRateHigh, ApprovalBacklog,
    AuditChainBreak — wake-the-house, SlackCallbackForgeryAttempts —
    security) deployed + tested via synthetic injection.
  - Page-the-on-call drill performed at least once before GA.
  - DLQ replay procedure documented with exact commands
    (`pnpm -F @okoro/scripts run orchestrator:dlq:list` etc.) and
    expected output shape.
  - Feature-flag flip procedure (`OKORO_ORCHESTRATOR_ENABLED`
    off/on) documented with exact dashboard / CLI path.

---

## How to add a new module to this board

1. ID it sequentially within the active sprint section.
2. Use the same fields: STATUS / Paths / Goal / Acceptance.
3. If blocked on operator decision, mark `BLOCKED ON OPERATOR` and add the
   ask to `CLAUDE.md` § "Operator decisions still pending".
