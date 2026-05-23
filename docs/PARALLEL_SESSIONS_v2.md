# CERNIQ — Parallel Sessions Coordination Guide v2

## How to Run 10+ Engineering Terminals Without Conflicts

### Updated: 2026-05-05 | Phase 1 GA Closure Edition

> **What changed from v1:** All 4 Phase 1 gates are closed. The coordination model below reflects the current state of the codebase and what each terminal should be working on RIGHT NOW.

---

## CURRENT STATE SNAPSHOT

```
Gate   Status    Closed by
────────────────────────────────────────────────────────────────────
G-1    ✅ CLOSED  wellknown.controller.ts (prior session)
G-2    ✅ CLOSED  billing/ module — UsageGuardService + StripeService
G-3    ✅ CLOSED  bate.worker.ts G-3 block (2026-05-04)
G-4    ✅ CLOSED  webhooks.controller.ts (2026-05-04)

TypeScript errors (non-KMS): 0
Test files: 50
Source files: 190
```

The codebase is **ready for first paying users.** Every terminal below is working toward the $500 MRR → $5K MRR → $50K MRR gates.

---

## TERMINAL ASSIGNMENTS — CURRENT SPRINT

### 🔴 TERMINAL-A: Python SDK (P0)

**Why P0:** The LangChain, CrewAI, and AutoGen ecosystems are Python-dominant. Every Python agent developer is locked out of CERNIQ until this ships. This is the single highest-impact unshipped item for Phase 2 revenue.

**Claim:**

```bash
claude-peers claim cerniq M-PYTHON-SDK --note "Python SDK: agent.py, client.py, crypto.py" --ttl 28800
```

**File scope:**

```
packages/sdk-py/
├── cerniq/
│   ├── __init__.py        # Public exports
│   ├── agent.py           # CerniqAgent: generate_keypair(), sign(payload) → JWT
│   ├── client.py          # CerniqClient: verify(token, options) → VerifyResult
│   ├── crypto.py          # Ed25519 sign/verify via cryptography[ed25519]
│   ├── types.py           # VerifyResult, DenialReason, PlanInfo dataclasses
│   └── errors.py          # CerniqError, VerifyDeniedError, QuotaExceededError
├── tests/
│   ├── test_agent.py
│   ├── test_client.py
│   └── test_crypto.py
├── pyproject.toml
└── README.md
```

**Mirror from TypeScript:** `packages/sdk-ts/src/` is the reference. Match the API surface exactly so LangChain guides work in both languages.

**Key invariant (CLAUDE.md #1):** The private key NEVER leaves the SDK. `CerniqAgent.sign()` produces a JWT client-side. The private key is never in the network request.

**Minimum viable implementation:**

```python
# What LangChain developers need to do in their agents:
from cerniq import CerniqAgent, CerniqClient

agent = CerniqAgent.load(private_key_path="~/.cerniq/agent.key")
client = CerniqClient(api_key=os.environ["CERNIQ_VERIFY_KEY"])

# Signing (runs in agent, before tool call):
token = agent.sign({"action": "commerce.purchase", "amount": 50.00, "currency": "USD"})

# Verifying (runs in relying party):
result = await client.verify(token, min_trust_score=600)
if not result.valid:
    raise PermissionError(f"Agent denied: {result.denial_reason}")
```

**Acceptance criteria:** `tests/` all pass. The LangChain quickstart guide works end-to-end.

---

### 🔴 TERMINAL-B: MCP Bridge Full Transport (P0)

**Why P0:** This is the distribution wedge. Every MCP server is a potential CERNIQ relying party. Without this, the wedge isn't operational.

**Claim:**

```bash
claude-peers claim cerniq M-MCP-BRIDGE --note "Full MCP SDK 1.0 transport binding" --ttl 28800
```

**File scope:**

```
packages/mcp-bridge/src/
├── index.ts          # wrap() — already has interface, needs transport impl
├── transport.ts      # MCP SDK 1.0 Server.setRequestHandler interception
├── types.ts          # BridgeConfig, BridgeContext, BridgeDenialError — EXISTS
└── index.spec.ts     # Unit tests (mock MCP server + mock CERNIQ client)
```

**What's already done:** `BridgeConfig`, `BridgeContext`, `BridgeDenialError`, the `wrap()` function signature.

**What's needed:** The actual `Server.setRequestHandler` wrapping:

```typescript
export function wrap(server: McpServer, config: BridgeConfig): McpServer {
  const original = server.setRequestHandler.bind(server);

  server.setRequestHandler = (schema, handler) => {
    original(schema, async (req, extra) => {
      // 1. Extract CERNIQ token from request headers/params
      const token = extractToken(req);
      if (!token) throw new BridgeDenialError('MISSING_TOKEN', { ... });

      // 2. Verify with CERNIQ
      const result = await config.cerniq.verify(token, {
        action: config.actionPrefix + extractMethodName(req),
      });
      if (!result.valid) {
        if (config.onDenial) return config.onDenial(result.denialReason!, ctx);
        throw new BridgeDenialError(result.denialReason!, { ... });
      }

      // 3. Inject context and forward
      return handler(req, { ...extra, cerniq: result });
    });
  };

  return server;
}
```

**Reference:** Study the MCP TypeScript SDK `@modelcontextprotocol/sdk` Server class for the exact request handler interception pattern.

**Acceptance criteria:** A minimal MCP server wrapped with `wrap()` rejects tool calls without valid CERNIQ tokens. Test with the MCP inspector tool.

---

### 🟡 TERMINAL-C: Dashboard Features (P1)

**Why P1:** The 10-minute verify AHA moment requires a good dashboard. Without it, conversion rate suffers even if the API is perfect.

**Claim:**

```bash
claude-peers claim cerniq M-DASHBOARD-BATE --note "BATE widget, agent list, onboarding wizard" --ttl 28800
```

**Priority order within this module:**

1. **Onboarding wizard** — 7-step flow tied to `PrincipalOnboarding` flags. This drives the "register agent → create policy → first verify" path that produces the AHA moment.
2. **Plan + usage widget** — calls `GET /v1/billing/plan`, shows quota meter, "Upgrade" CTA when >80% used
3. **BATE score widget** — locked (blurred) on FREE with "Upgrade to see your trust score" CTA; visible on DEVELOPER+
4. **Agent list** — `GET /v1/agents`, shows trustScore, trustBand, lastSeenAt per agent
5. **Audit log viewer** — `GET /v1/audit`, filterable by date + decision

**File scope:** `apps/dashboard/app/` (Next.js 16 app router)

**Design rule:** Every page must be functional in the dashboard without reading docs. Error messages must tell the user what to do, not what went wrong.

---

### 🟡 TERMINAL-D: Email Lifecycle (P1)

**Why P1:** The PLG conversion rate depends heavily on triggered emails. Without them, free users churn silently.

**Claim:**

```bash
claude-peers claim cerniq M-EMAIL-LIFECYCLE --note "quota alerts, upgrade triggers, welcome" --ttl 14400
```

**File scope:**

```
apps/api/src/modules/notifications/
├── notifications.module.ts
├── notifications.service.ts    # send(to, template, data) → transactional email
├── email-templates/
│   ├── welcome.ts              # Day 1 after signup
│   ├── quota-90pct.ts          # When 90% of monthly quota used
│   ├── quota-exceeded.ts       # When PLAN_LIMIT_EXCEEDED fires
│   ├── upgrade-success.ts      # After checkout.session.completed
│   └── subscription-cancelled.ts
```

**Integration points:**

- `stripe.service.ts` `onCheckoutCompleted()` → send `upgrade-success`
- `stripe.service.ts` `onSubscriptionDeleted()` → send `subscription-cancelled`
- New cron job: daily sweep, find principals at 90%+ quota → send `quota-90pct`
- `onboarding.service.ts` day-3 trigger → send `welcome` (if not yet activated)

**Email provider:** Resend (`npm install resend`) — React Email templates, simple API.

**Do NOT implement:** Unsubscribe flows, email scheduling systems, CRM sync. Those are Phase 2. Just get the critical lifecycle emails firing.

---

### 🟡 TERMINAL-E: Test Coverage Gap (P1)

**Why P1:** CI must be green before GA. 50 spec files is a good start but there are gaps.

**Claim:**

```bash
claude-peers claim cerniq M-TEST-COVERAGE --note "webhooks isolation, stripe e2e, billing controller" --ttl 14400
```

**Priority order:**

1. `webhooks.controller.spec.ts` — multi-tenant isolation test: principal A CANNOT delete principal B's subscription
2. `stripe.service.spec.ts` — complete the existing file: SETNX idempotency (duplicate event = no-op), circuit breaker OPEN state, `onSubscriptionDeleted` → planTier = FREE
3. `billing.controller.spec.ts` — complete the existing file: checkout returns URL, webhook validates signature, plan endpoint returns correct usage
4. End-to-end: `verify → quota → PLAN_LIMIT_EXCEEDED → POST checkout → webhook → verify succeeds again`

**Reference pattern:** `apps/api/src/__multi_tenant__/multi-tenant-isolation.spec.ts` for the isolation test pattern.

---

### 🟢 TERMINAL-F: KMS + Schedule Fixes (P1, Quick Wins)

**Why P1:** These are blocking issues for production deployments that are quick to fix.

**Claim:**

```bash
claude-peers claim cerniq M-KMS-SCHEDULE-FIXES --note "KMS SDK installs, schedule module" --ttl 3600
```

**Task 1 — KMS SDK installs:**

```bash
cd apps/api
pnpm add @aws-sdk/client-kms @google-cloud/kms
# Then fix 8 type errors in src/modules/kms/kms.module.ts:
# - AwsKmsAdapter constructor
# - GcpKmsAdapter constructor
# - VaultTransitAdapter constructor
# Verify: npx tsc --project tsconfig.json --noEmit → 0 errors
```

**Task 2 — Schedule module:**

```bash
pnpm add @nestjs/schedule @types/cron
# In apps/api/src/app.module.ts, add to imports:
# ScheduleModule.forRoot()
# Then check: grep -r "@Cron" apps/api/src -- any @Cron decorators need this
```

**Task 3 — WebhookSubscription.secret bcrypt:**
In `apps/api/src/modules/webhooks/webhooks.service.ts`:

```typescript
import * as bcrypt from 'bcrypt';

async subscribe(principalId, url, events) {
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const secretHash = await bcrypt.hash(secret, 10);
  await this.prisma.webhookSubscription.create({
    data: { principalId, url, secretHash, events }, // store hash
  });
  return { id: sub.id, secret }; // return plaintext ONCE
}
```

Add `secretHash String` column to Prisma schema, migration.

---

### 🟢 TERMINAL-G: OpenAPI Parity + CI (P2)

**Claim:**

```bash
claude-peers claim cerniq M-OPENAPI-PARITY --note "check-openapi-zod-parity.ts script" --ttl 7200
```

**File to create:** `scripts/check-openapi-zod-parity.ts`

What it must verify:

1. `DenialReason` in `verify.dto.ts` matches the `denialReason` enum in `docs/spec/CERNIQ_API_SPEC.yaml`
2. Every `/v1/` path in `CERNIQ_API_SPEC.yaml` has a corresponding controller route
3. `PlanTier` enum in Prisma schema matches `PlanTier` enum in `packages/types`
4. New: `PLAN_LIMIT_EXCEEDED` is in the OpenAPI spec (it was added to the DTO this session — needs to be in the YAML too)

CI integration: the workflow already references this script. Once it exists, it runs automatically.

---

### 🟢 TERMINAL-H: Usage Monitoring + Operator Dashboard (P2)

**Claim:**

```bash
claude-peers claim cerniq M-USAGE-MONITORING --note "quota utilization metrics + admin endpoint" --ttl 7200
```

**Add to MetricsService:**

```typescript
readonly planQuotaUtilizationGauge = new Gauge({
  name: 'cerniq_plan_quota_utilization_pct',
  help: 'Monthly verify quota utilization percentage (0–100) by plan tier.',
  labelNames: ['plan_tier'] as const,
});
```

**Add to BillingController (admin route):**

```typescript
@Get('admin/usage')
@ApiSecurity('ApiKeyAuth') // Admin key only
async adminUsage(): Promise<PrincipalUsageSummary[]> {
  // Returns all principals with their current quota utilization
  // Useful for Erwin to monitor conversion pressure
}
```

**Alert YAML** (add to `docs/MONITORING_OBSERVABILITY.md` alert rules):

```yaml
- alert: PlanQuotaAtRisk
  expr: cerniq_plan_quota_utilization_pct{plan_tier="FREE"} > 90
  for: 1h
  labels:
    severity: info # trigger email flow, not page
  annotations:
    summary: 'FREE tier principal at >90% quota — potential upgrade conversion'
```

---

## COORDINATION RULES FOR PARALLEL SESSIONS

### Files That Require Announcement Before Touching

Post in your standup or SESSION_HANDOFF.md BEFORE touching:

```
apps/api/prisma/schema.prisma           ← everyone's foundation
apps/api/src/app.module.ts              ← module wiring
apps/api/src/modules/verify/algorithm/verify.algorithm.ts  ← hot path
packages/types/src/index.ts             ← public API contract
CLAUDE.md                               ← operator must approve changes
WORK_BOARD.md                           ← everyone reads this
```

### Conflict Resolution This Sprint

Two sessions that are most likely to conflict:

- **TERMINAL-D (Email)** and **TERMINAL-F (KMS/Schedule)**: Both may touch `app.module.ts`. Coordinate via `claude-peers msg`.
- **TERMINAL-E (Tests)** and any other terminal: Tests can touch any file's spec but not the implementation. If you need to change an implementation to make a test pass, check if another terminal has claimed that module.

### When a Terminal Blocks

If you're blocked on an operator decision:

1. Add `// OPERATOR-INPUT-NEEDED: <description>` comment at the block point
2. Add to `docs/SESSION_HANDOFF.md` under `### OPERATOR-INPUT-NEEDED`
3. Continue with a documented placeholder behavior
4. Do NOT stop working — move to the next task in your module

Current open operator decisions:

- OD-003: Pricing tier values (current defaults in `plans.ts` are conservative — operator may want to raise FREE to 10K)
- OD-bcrypt: WebhookSubscription.secret storage model (Terminal F is implementing bcrypt as the right answer)

---

## SPRINT BURNDOWN

### Done This Session (2026-05-04)

```
✅ G-2: UsageGuardService + BillingModule + verify.service.ts gate
✅ G-3: BateAnomalyDetector wired in bate.worker.ts
✅ G-4: WebhooksController (POST/GET/DELETE /v1/webhooks)
✅ DenialReason.PLAN_LIMIT_EXCEEDED added to verify.dto.ts
✅ MetricsService.bateAnomalyTriggerTotal counter added
✅ Schema field corrections: AuditEvent.timestamp, BateSignal.occurredAt
✅ BillingController + StripeService (Stripe fully wired, circuit breaker, idempotency)
✅ SESSION_HANDOFF.md updated
✅ SPRINT_PROTOCOL.md gates updated
```

### Done Previous Sessions

```
✅ G-1: wellknown.controller.ts
✅ BATE: BateScorer, BateRecomputeWorker, BateAnomalyDetector (pure)
✅ Audit: hash chain, KMS abstraction, AuditSignerService
✅ KMS: AWS/GCP/Vault adapters (pending SDK installs)
✅ Auth0/Clerk/WorkOS IdP bridges
✅ MCP module (CERNIQ as MCP server)
✅ Onboarding: PrincipalOnboarding 7-step wizard
✅ Compliance, DR, SLO, Threat Model documentation
✅ Full documentation suite (17 major docs, ~300KB)
```

### Next 2 Weeks (Sprint 2)

```
🔴 P0: Python SDK (Terminal A)
🔴 P0: MCP bridge transport (Terminal B)
🟡 P1: Dashboard BATE + onboarding wizard (Terminal C)
🟡 P1: Email lifecycle triggers (Terminal D)
🟡 P1: Test coverage gaps (Terminal E)
🟡 P1: KMS installs + schedule + bcrypt (Terminal F)
🟢 P2: OpenAPI parity script (Terminal G)
🟢 P2: Usage monitoring + admin (Terminal H)
```

**Sprint 2 goal:** First paying user. $49/month. Everything else is secondary.

---

## DAILY STANDUP FORMAT

Post this in your session notes or broadcast to active sessions:

```
📋 Standup — @[session/terminal]
Yesterday: [what landed, PR # if applicable]
Today: [module claimed, what you're building right now]
Blocked: [any blockers — if none, say "unblocked"]
FYI: [any cross-cutting changes others should know about]
```

Example:

```
📋 Standup — @terminal-a
Yesterday: Python SDK skeleton (cerniq/agent.py, cerniq/crypto.py)
Today: Finishing cerniq/client.py — the verify() method + error mapping
Blocked: Unblocked. Need to confirm EdDSA JWT format matches TS SDK output.
FYI: packages/sdk-py/tests/test_crypto.py tests Ed25519 sign/verify round-trip.
     Anyone touching @noble/ed25519 — coordinate with me on byte-compatible output.
```

---

_Parallel sessions guide v2 | Phase 1 GA closed | May 2026_
