# OKORO — Sprint Protocol
## How 100 Engineers Ship in Parallel Without Stepping on Each Other

> **Owner:** Engineering Lead + Operator  
> **Updated:** 2026-05-04  
> **Applies to:** All contributors — contractors, agents, and staff engineers

---

## 1. Core Principle

OKORO is built by parallel sessions (humans, Claude agents, or both) working concurrently. Without discipline, parallel sessions cause merge conflicts, duplicate work, and broken invariants. This protocol prevents that.

The claim protocol is the coordination layer. **It is not optional.** Every session that touches code must claim its module before writing a single line.

---

## 2. The Work Board

`WORK_BOARD.md` at the repo root is the single source of truth for what's being worked on.

### 2.1 Module States

```
STATUS: open         → available for claiming
STATUS: claimed by <session-id>  → someone is working on it (with expiry)
STATUS: review       → PR open, waiting for review
STATUS: landed       → merged to main
STATUS: blocked      → depends on operator decision (see OPERATOR_DECISIONS.md)
STATUS: cancelled    → no longer needed
```

### 2.2 Module Entry Format

```markdown
## M-057: Stripe Billing Integration
**Status:** open
**Priority:** P0 (blocks $500 MRR gate)
**Est:** 4h
**Files:** apps/api/src/modules/billing/*, packages/types/src/billing.ts
**Depends on:** OD-003 (pricing tiers)
**Description:** Wire Stripe webhooks for plan upgrades, enforce tier limits at verify level
**Acceptance criteria:**
- Stripe webhook handler processes checkout.session.completed
- FREE tier enforced: 10K verifies/month hard limit
- PRO tier unenforced: unlimited until billing milestone
- pnpm jest apps/api/src/modules/billing passes
```

---

## 3. Claim Protocol

### 3.1 Before Starting Work

```bash
# Step 1: Check WORK_BOARD.md for available modules
cat WORK_BOARD.md | grep "STATUS: open"

# Step 2: Read the full module entry — understand scope and file paths

# Step 3: Claim it
claude-peers claim okoro <module-id> \
  --note "Implementing Stripe billing integration" \
  --ttl 7200   # 2 hours; extend if needed

# Step 4: Update WORK_BOARD.md
# STATUS: open  →  STATUS: claimed by <your-session-id> (YYYY-MM-DD HH:MM UTC)
```

### 3.2 Claim TTL Rules

| TTL | When to Use |
|-----|-------------|
| `--ttl 3600` (1h) | Small bugs, single file changes |
| `--ttl 7200` (2h) | Standard features |
| `--ttl 14400` (4h) | Complex features, multi-file changes |
| `--ttl 28800` (8h) | Full sprint session (renew before expiry) |

**Expired claims are fair game.** If a claim is > 2 hours past its TTL with no PR and no activity, it can be re-claimed. Always check for a stale PR first.

### 3.3 Extending a Claim

```bash
# Before TTL expires
claude-peers extend okoro:<module-id> --ttl 3600
# Update WORK_BOARD.md: add (extended HH:MM UTC)
```

### 3.4 Releasing a Claim

After your PR is merged:
```bash
claude-peers release okoro:<module-id>
# Update WORK_BOARD.md: STATUS: landed
# Append to docs/SESSION_HANDOFF.md
```

---

## 4. File Path Discipline

Every module lists its file paths explicitly. Stay within them.

```markdown
**Files:** apps/api/src/modules/billing/*, packages/types/src/billing.ts
```

This means:
- ✅ `apps/api/src/modules/billing/billing.service.ts` — in scope
- ✅ `packages/types/src/billing.ts` — in scope
- ❌ `apps/api/src/modules/verify/verify.service.ts` — not in scope
- ❌ `apps/api/prisma/schema.prisma` — ALWAYS coordinate before touching schema

### 4.1 Cross-Module Touches

When your module requires changes to files outside its listed paths:

```bash
# Message the holder of the conflicting module
claude-peers msg <session-id> "Module M-057 needs to touch verify.service.ts to add billing check. Can we coordinate?"

# If that session is expired or unresponsive: post in #engineering Slack
# If nobody objects in 2h: proceed with a narrow, clearly documented change
```

### 4.2 Always Coordinate Before Touching These Files

These files are high-collision. Announce in #engineering before every touch:

```
apps/api/prisma/schema.prisma           (everyone's foundation)
apps/api/src/modules/verify/algorithm/verify.algorithm.ts  (hot path, invariants)
packages/types/src/index.ts             (public API contract)
apps/api/src/app.module.ts              (module wiring)
CLAUDE.md                               (invariants, never change without operator)
WORK_BOARD.md                           (everyone reads this)
docs/SESSION_HANDOFF.md                 (append only)
```

---

## 5. Session Handoff Protocol

After every session, append to `docs/SESSION_HANDOFF.md`. This is the institutional memory.

### 5.1 Required Handoff Format

```markdown
## Session: <session-id> | <module-id> | <date>
**Duration:** Xh Ym
**Status:** ✅ Landed / 🟡 PR Open / ❌ Blocked

### What landed
- [List of files changed and what changed]
- [Key architectural decisions made]
- [Tests added]

### What did NOT land (be explicit)
- [Things you started but didn't finish]
- [Known gaps in what you shipped]

### Spec drift logged
- [Any divergence found between spec and code]
- [OpenAPI changes made]

### Open questions / next steps
- [Things the next session should know]
- [TODOs with file:line references]

### OPERATOR-INPUT-NEEDED
- [Any decisions that were deferred to the operator]
```

### 5.2 Handoff Completeness Check

Before releasing a claim, verify:

```
[ ] SESSION_HANDOFF.md appended
[ ] WORK_BOARD.md updated (STATUS: landed or review)
[ ] PR description matches SESSION_HANDOFF.md summary
[ ] All TODOs either resolved or filed as GitHub Issues
[ ] No console.log() left in production code
[ ] pnpm test:ci passes locally
[ ] No .env or secrets committed
```

---

## 6. Quality Gates

### 6.1 Per-PR Gates (Required for Merge)

CI must pass:
```
[ ] pnpm lint (zero warnings)
[ ] pnpm typecheck (zero errors, noUncheckedIndexedAccess on)
[ ] pnpm jest apps/api --coverage (no coverage regression)
[ ] pnpm vitest run tests/e2e/ (all green)
[ ] spec-sync checks (OpenAPI ↔ Zod ↔ Prisma parity)
```

Human review gates:
```
[ ] At least 1 approval from engineering team member
[ ] For crypto changes: engineering lead must approve
[ ] For verify.algorithm.ts changes: engineering lead must approve
[ ] For schema.prisma changes: engineering lead must approve
[ ] For CLAUDE.md changes: operator (Erwin) must approve
```

### 6.2 The FAANG Quality Bar

These are not suggestions:

**No `any`:**
```typescript
// ❌ Unacceptable (even in a hurry)
async function processPayment(data: any): Promise<any> { ... }

// ✅ Required
async function processPayment(data: ProcessPaymentDto): Promise<PaymentResult> { ... }

// If truly unavoidable:
// type-rationale: Prisma's Json type is structurally untyped at this boundary
const metadata = event.metadata as Record<string, unknown>;
```

**Typed errors:**
```typescript
// ❌ Never
throw new Error('Agent not found');

// ✅ Always
throw new AgentNotFoundError({ agentId, principalId });
```

**No fabricated data:**
```typescript
// ❌ Never return synthetic "success" when downstream fails
if (error) return { score: 500, band: 'VERIFIED' }; // NEVER

// ✅ Surface the error
if (error) throw new BateScoringError({ cause: error });
```

**Constants in packages/types:**
```typescript
// ❌ Never
const MAX_DELEGATION_DEPTH = 5; // in verify.service.ts

// ✅ Always
import { MAX_DELEGATION_DEPTH } from '@okoro/types'; // in packages/types
```

### 6.3 Architecture Change Protocol

A change is architectural if it:
- Adds a new dependency (even a dev dependency in production code)
- Changes a public interface in packages/types
- Modifies verify.algorithm.ts behavior
- Changes the denial-precedence order
- Adds a new module to app.module.ts
- Changes the audit chain format

For any architectural change:
1. Write an ADR in `docs/decisions/ADR-XXXX-title.md`
2. Post in #engineering: "Proposing ADR-XXXX: [summary]"
3. Wait 24h for objections
4. Engineering lead approves
5. Proceed

---

## 7. Parallel Session Coordination

### 7.1 Daily Sync (Async, No Meeting Required)

Every session posts a standup to #engineering by 10am local time:

```
📋 Daily standup — @[name/session]
Yesterday: [what landed or PR # opened]
Today: [module claimed, what you're building]
Blocked: [anything blocking you]
FYI: [any cross-cutting changes others should know about]
```

### 7.2 Cross-Session Communication

```bash
# Direct message to session holder
claude-peers msg <session-id> "Question about your M-044 PR..."

# Broadcast to all active sessions
claude-peers broadcast "Heads up: changing verify.algorithm.ts step 7 semantics"

# List all active sessions and their claims
claude-peers list --repo okoro
```

### 7.3 Conflict Resolution

If two sessions need the same file simultaneously:

1. Smaller scope change defers to larger scope change.
2. If equal scope: first claim wins.
3. If both urgent: split the work and coordinate in PRs.
4. Always default to: "ship the safer, smaller change first."

---

## 8. Sprint Structure

### 8.1 Sprint Cadence

| Event | Frequency | Duration | Owner |
|-------|-----------|---------|-------|
| Sprint planning | Every 2 weeks | 30 min | Engineering lead |
| Module prioritization | Every sprint | 15 min | Erwin |
| PR review cycle | Continuous | N/A | All engineers |
| Release cut | Every sprint | 1h | Engineering lead |
| Operator review | Every sprint | 30 min | Erwin |

### 8.2 Module Prioritization Rules

Modules are prioritized by:
1. **P0:** Blocks first paying customer or production GA
2. **P1:** Needed for first 10 design partners to succeed
3. **P2:** Needed for Phase 2 gate ($5K MRR)
4. **P3:** Tech debt, quality improvements, Phase 3 prep

Never work on P3 if there are open P0 items.

### 8.3 Sprint Goals (Phase 1 GA)

Current sprint goal: **Ship the minimum for first paying user.**

Blockers (do not close sprint until these are done):
```
[x] G-1: /.well-known/audit-signing-key endpoint — LANDED (wellknown.controller.ts, prior session)
[x] G-2: Free tier fully enforced — LANDED (UsageGuardService + BillingModule + VerifyService gate, 2026-05-04)
          Stripe wiring pending OD-003 resolution; billing/plans.ts defaults active.
[x] G-3: BATE anomaly detector wired — LANDED (bate.module.ts + bate.worker.ts G-3 block, 2026-05-04)
[x] G-4: Webhook subscription endpoints shipped — LANDED (webhooks.controller.ts POST/GET/DELETE, 2026-05-04)
```

**All Phase 1 GA sprint gates are now closed.** Remaining pre-GA work:
- OD-003 Stripe wiring (billing source-of-truth; quota enforcement already live)
- `UsageGuardService` unit tests
- `WebhookSubscription.secret` bcrypt hardening (see SESSION_HANDOFF.md 2026-05-04)
- `@nestjs/schedule` + `ScheduleModule.forRoot()` install
- `scripts/check-openapi-zod-parity.ts` authoring

See PRODUCTION_CHECKLIST.md §5.2 for exact acceptance criteria.

---

## 9. Emergency Protocol

When something breaks in production during a session:

```
1. STOP your current work immediately
2. Post in #incidents: "🔴 Production issue — I'm dropping M-XXX to investigate"
3. DO NOT push any uncommitted code for the module you were working on
4. Follow INCIDENT_RESPONSE.md
5. After incident is resolved: return to your module with a fresh claim
```

If you don't have production access (common for new engineers), hand off to the on-call engineer and continue supporting via Slack.

---

## 10. Onboarding New Engineers

First session checklist for a new team member:

```
Day 1:
[ ] Read CLAUDE.md completely
[ ] Run the codebase locally (DEVELOPER_QUICKSTART.md)
[ ] Complete the developer quickstart as a user
[ ] Read 3 recent SESSION_HANDOFF.md entries to understand velocity

Week 1:
[ ] Claim one "good first" module (ask engineering lead for recommendation)
[ ] Submit first PR following all quality gates
[ ] Complete ENGINEER_ONBOARDING.md Month 1 checklist

Protocol understanding:
[ ] Can explain the claim protocol without looking it up
[ ] Has used claude-peers to claim, extend, and release a module
[ ] Has written a SESSION_HANDOFF.md entry
[ ] Has reviewed someone else's PR with substantive feedback
```

---

## 11. Tool Reference

```bash
# All claude-peers commands
claude-peers claim <repo> <module-id> --note "..." --ttl <seconds>
claude-peers release <repo>:<module-id>
claude-peers extend <repo>:<module-id> --ttl <seconds>
claude-peers list --repo <repo>
claude-peers msg <session-id> "<message>"
claude-peers broadcast "<message>"
claude-peers status  # your current claims

# Useful WORK_BOARD queries
grep "STATUS: open" WORK_BOARD.md                    # available modules
grep "STATUS: claimed" WORK_BOARD.md                 # active claims
grep "Priority: P0" WORK_BOARD.md                    # urgent modules
```

---

*Sprint protocol version: 1.0 | OKORO Phase 1*  
*Next review: after first sprint with >5 concurrent engineers*
