# AEGIS — Engineer Onboarding Guide
## Your First Day, Week, and Month

> **Welcome to AEGIS.** You're joining a team building the identity and verification layer for AI agents — the trust infrastructure that makes autonomous AI safe in production. This doc gets you from zero to shipping in 30 days.

---

## Day 0 — Before You Start

Get these from Erwin or the engineering lead:

```
[ ] GitHub access (aegislabs/aegis repo)
[ ] Railway access (production + staging)
[ ] Cloudflare access (zone + Workers)
[ ] Slack invite (#engineering, #incidents, #feedback-inbox)
[ ] PagerDuty account (if you're joining the on-call rotation)
[ ] 1Password (team vault) or equivalent secrets manager access
[ ] Linear/Jira access for sprint tracking
[ ] AWS/GCP access (if working on KMS integrations)
```

---

## Day 1 — The Foundation

### 1.1 Read These First (in order)

This is not optional. AEGIS has strong architecture invariants — knowing them before touching code saves everyone time.

```
1. CLAUDE.md                    ← the contract every session agrees to
2. docs/ARCHITECTURE.md         ← how all the pieces fit
3. docs/SECURITY.md             ← threat model, key handling, denial precedence
4. docs/spec/03_TECHNICAL_SPEC.md  ← the full technical spec
5. apps/api/prisma/schema.prisma   ← the data model is the source of truth
```

Time: ~2-3 hours. Yes, all of it. The invariants in CLAUDE.md are non-negotiable.

### 1.2 Get the Codebase Running

```bash
# Clone
git clone git@github.com:aegislabs/aegis.git
cd aegis

# Install (pnpm workspaces — do not use npm or yarn)
pnpm install

# Start local services (Postgres + Redis)
docker compose up -d

# Run migrations
pnpm prisma migrate dev

# Start the API
pnpm dev

# Verify it's working
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}
```

If anything breaks: check `DEVELOPER_QUICKSTART.md` first, then ask in #engineering.

### 1.3 Run the Full Test Suite

```bash
# Unit + integration
pnpm jest apps/api --coverage

# E2E (requires local API running)
pnpm vitest run tests/e2e/

# Multi-tenant isolation
pnpm jest apps/api/src/__multi_tenant__/

# Expected: all green. If not, don't proceed — file an issue.
```

### 1.4 Complete the Developer Quickstart

Follow `DEVELOPER_QUICKSTART.md` end-to-end as a user would. Register an agent, attach a policy, make a verify call, get a denial. This gives you the user experience before you touch the internals.

---

## Day 2-3 — Codebase Tour

### 2.1 The Critical Path

The single most important code path is `verifyAlgorithm`. Read it completely:

```bash
cat apps/api/src/modules/verify/algorithm/verify.algorithm.ts
```

This pure function implements the 9-step denial-precedence logic. It has zero framework imports — this is intentional (CLAUDE.md Invariant #2: the verify hot path must be portable to Cloudflare Workers). Every PR that touches this file requires extra scrutiny.

The 9 steps + their denial reasons:
1. Agent lookup → `AGENT_NOT_FOUND`
2. Revocation check → `AGENT_REVOKED`
3. Ed25519 signature verify → `INVALID_SIGNATURE`
3.5. JTI replay cache check → `ANOMALY_FLAGGED` (fail-closed on Redis error)
4. Policy lookup → `POLICY_REVOKED` / `POLICY_EXPIRED`
5. Scope check → `SCOPE_NOT_GRANTED`
6. Spend limit → `SPEND_LIMIT_EXCEEDED`
7. BATE trust score → `TRUST_SCORE_TOO_LOW`
8. BATE anomaly → `ANOMALY_FLAGGED`
9. Approved ✓

### 2.2 Module Map

Spend 15 minutes in each:

```
apps/api/src/modules/
  verify/           ← the product. verify.algorithm.ts + verify.service.ts
  identity/         ← agent registration, public key storage
  policy/           ← policy CRUD, policy engine (builtin/Cedar/OPA)
  audit/            ← append-only audit log, hash chain, signing
  bate/             ← trust scoring (scorer.ts), anomaly detection (anomaly.ts)
  webhooks/         ← outbox pattern, webhook delivery
  billing/          ← Stripe integration (partial — see G-2 in PRODUCTION_CHECKLIST)

apps/api/src/common/
  crypto/           ← Ed25519 sign/verify utilities — DO NOT CHANGE without security review
  prisma/           ← PrismaService wrapper
  redis/            ← RedisService wrapper
  errors/           ← AegisError subclasses (typed errors, not strings)
  guards/           ← ApiKeyGuard, AdminGuard — ALL endpoints go through these

packages/
  types/            ← Zod schemas — the API contract. All constants live here.
  sdk-ts/           ← @aegis/sdk — the public TypeScript SDK
  verifier-rp/      ← @aegis/verifier-rp — offline JWT verifier for relying parties
```

### 2.3 Understand the Data Model

Open `apps/api/prisma/schema.prisma` and trace these relationships:

```
Principal (tenant)
  └─ ApiKey (auth — bcrypt hashed)
  └─ AgentIdentity (public key, status, BATE state)
       └─ AgentPolicy (many-to-many: agent has policies)
       └─ BateSignal (behavioral signals, 14 types)
       └─ TrustScoreHistory (score timeline)
  └─ AuditEvent (append-only, signed hash chain)
  └─ RelyingParty (who's consuming verify results)
  └─ WebhookSubscription
  └─ PrincipalOnboarding (activation funnel, 7 steps)
  └─ SpendRecord (daily spend backstop in Postgres)
```

Key design decisions:
- `AgentIdentity.publicKey` is a base64-encoded Ed25519 public key (32 bytes).
- `AuditEvent` has `*Hash` columns for GDPR Art.17 erasure without breaking the chain.
- `signingKeyId` on `AuditEvent` links to which key signed this event (supports key rotation).
- `OutboxEvent` is the transactional outbox for webhooks (ADR-0007).

---

## Week 1 — Make Your First Contribution

### 3.1 Claim a Module

AEGIS uses a claim protocol for parallel sessions. Before touching code:

```bash
# 1. Open WORK_BOARD.md — find a module marked STATUS: open
# 2. Pick one appropriate to your skill level (Week 1: pick something small)
# 3. Claim it:
claude-peers claim aegis <module-id> --note "implementing X" --ttl 7200

# 4. Edit WORK_BOARD.md: flip STATUS to "claimed by <your-session-id>"
# 5. Work only in the file paths listed for that module
```

**Good first issues for Week 1:**
- Improving error messages in the CLI
- Adding a missing unit test to a service
- Fixing a TODO comment with `// OPERATOR-INPUT-NEEDED:`
- Adding a missing OpenAPI description to a controller

### 3.2 The PR Protocol

Every PR must:

```
1. Reference a WORK_BOARD module or GitHub issue
2. Include tests (unit + integration for services, unit only for pure utils)
3. Pass CI: pnpm lint && pnpm typecheck && pnpm test:ci
4. Not introduce `any` without a `// type-rationale:` comment
5. Crypto changes require a security review tag: @aegis/security
6. verify.algorithm.ts changes require the engineering lead's sign-off
```

PR template:
```markdown
## What
[One paragraph — what does this PR do]

## Why
[One paragraph — what problem does it solve]

## How
[Technical implementation notes for reviewer]

## Test coverage
- [ ] Unit tests added/updated
- [ ] E2E test updated (if applicable)
- [ ] Multi-tenant test updated (if applicable)

## Checklist
- [ ] No `any` without comment
- [ ] Constants in packages/types, not hardcoded
- [ ] Error types use AegisError subclasses
- [ ] Updated SESSION_HANDOFF.md at end of session
```

### 3.3 Quality Bar (CLAUDE.md §Quality)

Non-negotiable:
- **No `any`** unless justified with `// type-rationale:` comment.
- **Every public service method has a unit test** or `// untestable: <reason>`.
- **Errors are typed** — use `AegisError` subclasses from `apps/api/src/common/errors`.
- **Constants in `packages/types`** — not duplicated.
- **No fabricated data** — if a call fails, surface the error. Never return stubs.
- **Crypto code requires a paired `.spec.ts`** — no exceptions.

---

## Week 2 — Go Deeper

### 4.1 Understand BATE

Read `docs/BATE_ALGORITHM.md` completely. Then read:
- `apps/api/src/modules/bate/bate.scorer.ts` — pure scoring function
- `apps/api/src/modules/bate/bate.weights.ts` — signal weights, trust bands
- `apps/api/src/modules/bate/bate.anomaly.ts` — 5 anomaly rules (R-1 through R-5)

Key: BATE is a pure function (`BateScorer.explain(input)`). It takes signals, returns a score + explanation. It has no side effects. This is intentional — it can run at edge (Cloudflare Workers) without a DB.

### 4.2 Understand the Audit Chain

Read `apps/api/src/modules/audit/audit-signer.service.ts`. The signing pipeline:
1. KMS (AWS/GCP) if configured
2. Environment variable key if set
3. Ephemeral dev key (NEVER in production)

Each event: `sig = sign(prevSig || canonicalize(event))` using RFC 8785 JCS.

Run the chain verification script on your local DB:
```bash
pnpm tsx scripts/audit-verify-chain.ts \
  --api-base http://localhost:3000 \
  --api-key $YOUR_TEST_KEY \
  --limit 20
```

Then tamper with a row manually and watch it break:
```sql
UPDATE "AuditEvent" SET action = 'tampered' WHERE id = '[any-event-id]';
```

Re-run the script — you should see a chain break detected.

### 4.3 Understand the SDK Surface

Read `packages/sdk-ts/src/` completely. The SDK is the public API. Any breaking change here requires a semver major bump. The SDK exports:
- `AegisClient` — principal management (agents, policies, audit)
- `AegisVerifier` (from `verifier-rp`) — offline JWT verification at relying party
- `AegisCallbackHandler` — LangChain integration
- `verifyRequest()` — Express/Fastify middleware

Understanding the SDK surface helps you understand what external developers depend on.

---

## Week 3-4 — Own Something

### 5.1 Your First Substantial Contribution

By the end of Month 1, you should have shipped at least one of:
- A complete feature from WORK_BOARD.md (not just a fix)
- A new E2E test suite that catches a real gap
- A new integration guide (see Tier 3 docs in the suite)
- A performance improvement with measured before/after latency

### 5.2 Get Comfortable with the Full Stack

Try these hands-on exercises:

```bash
# Exercise 1: Full happy path from CLI
aegis agents register --name "my-test-agent" --ttl 3600
aegis policy apply --agent my-test-agent --scope payment:read --limit 500
aegis verify --agent my-test-agent --scope payment:read --amount 100
aegis audit tail --agent my-test-agent

# Exercise 2: Trigger every denial reason
# (follow DEVELOPER_QUICKSTART.md §All 9 Denial Reasons)

# Exercise 3: Simulate key rotation
pnpm tsx scripts/generate-aegis-keys.ts
# Update local .env with new keys
# Restart API
# Run audit chain verification — chain must still verify

# Exercise 4: Read your own BATE score
aegis agents get --id my-test-agent --show-trust-breakdown
# Understand each contributor

# Exercise 5: Test tamper detection (Exercise 4.2 above)
```

### 5.3 Architecture Decision Records

Before making any architectural change, read the relevant ADR in `docs/decisions/`. If no ADR exists and your change is architectural (new dependency, new pattern, breaking change to hot path), write one. Use the template at `docs/decisions/TEMPLATE.md`.

ADRs that are locked (do not revisit without operator approval):
- ADR-0004: Denial precedence order
- ADR-0006: GDPR erasure via column hashing
- CLAUDE.md Invariants 1-6

---

## Month 1 Checkpoint

At 30 days, you should be able to:

```
[ ] Explain the verify algorithm step-by-step from memory
[ ] Name all 9 denial reasons and their order
[ ] Trace a single verify call through all layers (controller → service → algorithm → DB → audit)
[ ] Explain why the verify hot path has zero framework imports
[ ] Run the full test suite and interpret failures
[ ] Claim, implement, and PR a WORK_BOARD module independently
[ ] Run the audit chain verification and explain what it checks
[ ] Explain BATE: what signals it uses, how trust bands work, what triggers anomaly detection
[ ] Explain multi-tenant isolation: what makes a query principal-scoped?
[ ] Know which files are the highest-risk / highest-scrutiny in the codebase
```

If any of these are unclear, schedule a 30-min pairing session with the engineering lead.

---

## Codebase Anti-Patterns (What NOT to Do)

These have been called out in ADRs or CLAUDE.md. Don't repeat them:

```typescript
// ❌ Wrong: Math.random() in production code
const trustScore = 500 + Math.random() * 100;

// ✅ Right: deterministic score from BATE signals
const { score } = bateScorer.explain(signals);

// ❌ Wrong: any on a service method return
async function getAgent(id: string): Promise<any> { ... }

// ✅ Right: typed return
async function getAgent(id: string): Promise<AgentIdentity> { ... }

// ❌ Wrong: framework import in verify algorithm
import { Injectable } from '@nestjs/common'; // in verify.algorithm.ts

// ✅ Right: pure function with port injection
export async function verifyAlgorithm(input: VerifyInput, ports: VerifyPorts) { ... }

// ❌ Wrong: hardcoded constant in service
const MAX_SPEND = 10000;

// ✅ Right: imported from packages/types
import { DEFAULT_SPEND_LIMIT } from '@aegis/types';

// ❌ Wrong: fabricated data on error
if (!agent) return { approved: false, trustScore: 0 }; // NEVER fabricate

// ✅ Right: explicit error
if (!agent) return deny('AGENT_NOT_FOUND', { agentId });

// ❌ Wrong: UPDATE/DELETE on AuditEvent
await prisma.auditEvent.update({ where: { id }, data: { action: 'fixed' } });

// ✅ Right: append a correction event
await auditService.append({ eventType: 'AUDIT_CORRECTION', ... });
```

---

## Useful Commands Reference

```bash
# Development
pnpm dev                              # start API in watch mode
pnpm dev --filter=dashboard           # start dashboard
docker compose up -d                  # start Postgres + Redis

# Testing
pnpm test:ci                          # full test suite (what CI runs)
pnpm jest --testPathPattern=verify    # run verify tests only
pnpm vitest run tests/e2e/            # E2E tests
pnpm jest --coverage                  # with coverage report

# Database
pnpm prisma studio                    # GUI for local DB
pnpm prisma migrate dev               # apply + create migrations
pnpm prisma migrate status            # check migration state
pnpm prisma db seed                   # seed test data

# Code quality
pnpm lint                             # ESLint
pnpm typecheck                        # tsc --noEmit across all packages
pnpm format                           # Prettier

# Scripts
pnpm tsx scripts/generate-aegis-keys.ts         # generate Ed25519 key pairs
pnpm tsx scripts/audit-verify-chain.ts --help   # audit chain verification

# CLI (install globally first)
pnpm build --filter=@aegis/cli
pnpm global add ./packages/cli
aegis --version
aegis doctor
```

---

## Who to Ask About What

| Topic | Ask |
|-------|-----|
| Architecture decisions, CLAUDE.md invariants | Engineering Lead |
| Verify algorithm, denial precedence | Engineering Lead |
| BATE scoring, anomaly detection | Engineering Lead |
| Cryptography (Ed25519, JWT) | Engineering Lead + anyone who's read SECURITY.md |
| SDK surface, breaking changes | SDK owner |
| Railway / infra, deployments | DevOps / Engineering Lead |
| Beta user issues, onboarding | Erwin |
| Roadmap prioritization | Erwin |
| Pricing, business decisions | Erwin |
| "Is this an architecture change?" | When in doubt → yes. File an ADR. |

---

*Onboarding guide version: 1.0 | AEGIS Phase 1*  
*Next review: after first 3 engineers onboarded*
