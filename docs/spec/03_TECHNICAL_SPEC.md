# OKORO — Technical Implementation Deep Specification

## Document 03 — Architecture, Data Models, Service Design, Security

### KLYTICS Internal | Version 1.0 | May 2026

---

## SECTION 1 — SYSTEM ARCHITECTURE

### 1.1 Service Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DEVELOPER PLANE                              │
│                                                                       │
│  Dashboard (Next.js)    Docs Site (Mintlify)    SDK (@okoro/sdk)    │
│       │                       │                       │              │
│       └───────────────────────┴───────────────────────┘              │
│                               │                                       │
│                      OKORO API Gateway                                │
│                    (Railway / Cloudflare)                             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│   IDENTITY SVC   │  │   POLICY SVC     │  │    VERIFY SVC         │
│                  │  │                  │  │                        │
│ - Agent CRUD     │  │ - Policy CRUD    │  │ - Signature verify    │
│ - Keypair mgmt   │  │ - Token issue    │  │ - Policy check        │
│ - Principal mgmt │  │ - Revocation     │  │ - Spend guard         │
│ - Status cache   │  │ - Expiry cron    │  │ - BATE score read     │
└────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘
         │                     │                         │
         └─────────────────────┼─────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
     │  PostgreSQL  │  │    Redis      │  │    BullMQ        │
     │  (Prisma)    │  │  (cache/rate) │  │  (BATE signals)  │
     └──────────────┘  └──────────────┘  └──────────────────┘
                                                  │
                               ┌──────────────────┘
                               ▼
              ┌─────────────────────────────────┐
              │          BATE ENGINE             │
              │                                  │
              │  - Signal ingestion worker       │
              │  - Trust score computation       │
              │  - Anomaly detection (rules)     │
              │  - Score persistence             │
              │  - Webhook emission              │
              └─────────────────────────────────┘

EDGE LAYER (Phase 3 — Cloudflare Workers):
     ┌─────────────────────────────────────────┐
     │  CF Worker: /verify hot path            │
     │  CF KV: trust score cache (<80ms)       │
     │  CF Rate Limiting: per-key              │
     └─────────────────────────────────────────┘
```

### 1.2 Directory Structure (NestJS Monorepo)

```
okoro/
├── apps/
│   ├── api/                    # NestJS core API
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── modules/
│   │   │   │   ├── identity/
│   │   │   │   │   ├── identity.module.ts
│   │   │   │   │   ├── identity.controller.ts
│   │   │   │   │   ├── identity.service.ts
│   │   │   │   │   ├── identity.dto.ts
│   │   │   │   │   └── identity.spec.ts
│   │   │   │   ├── policy/
│   │   │   │   │   ├── policy.module.ts
│   │   │   │   │   ├── policy.controller.ts
│   │   │   │   │   ├── policy.service.ts
│   │   │   │   │   ├── policy.dto.ts
│   │   │   │   │   ├── policy-scope.validator.ts
│   │   │   │   │   └── policy.spec.ts
│   │   │   │   ├── verify/
│   │   │   │   │   ├── verify.module.ts
│   │   │   │   │   ├── verify.controller.ts
│   │   │   │   │   ├── verify.service.ts
│   │   │   │   │   ├── verify.dto.ts
│   │   │   │   │   ├── spend-guard.service.ts
│   │   │   │   │   └── verify.spec.ts
│   │   │   │   ├── audit/
│   │   │   │   │   ├── audit.module.ts
│   │   │   │   │   ├── audit.controller.ts
│   │   │   │   │   ├── audit.service.ts
│   │   │   │   │   └── audit.spec.ts
│   │   │   │   ├── bate/
│   │   │   │   │   ├── bate.module.ts
│   │   │   │   │   ├── bate.worker.ts
│   │   │   │   │   ├── bate.scorer.ts
│   │   │   │   │   ├── bate.anomaly.ts
│   │   │   │   │   └── bate.spec.ts
│   │   │   │   ├── webhooks/
│   │   │   │   │   ├── webhooks.module.ts
│   │   │   │   │   ├── webhooks.service.ts
│   │   │   │   │   └── webhooks.worker.ts
│   │   │   │   └── auth/
│   │   │   │       ├── auth.module.ts
│   │   │   │       ├── api-key.guard.ts
│   │   │   │       └── api-key.service.ts
│   │   │   ├── common/
│   │   │   │   ├── crypto/
│   │   │   │   │   ├── ed25519.util.ts
│   │   │   │   │   └── jwt.util.ts
│   │   │   │   ├── redis/
│   │   │   │   │   └── redis.module.ts
│   │   │   │   ├── prisma/
│   │   │   │   │   └── prisma.service.ts
│   │   │   │   ├── decorators/
│   │   │   │   └── filters/
│   │   │   └── config/
│   │   │       ├── config.module.ts
│   │   │       └── config.schema.ts
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   └── dashboard/              # Next.js developer dashboard
│       ├── app/
│       ├── components/
│       └── lib/
├── packages/
│   ├── sdk-ts/                 # @okoro/sdk (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts
│   │   │   ├── agent.ts
│   │   │   ├── verify.ts
│   │   │   ├── policy.ts
│   │   │   └── types.ts
│   │   └── package.json
│   └── sdk-py/                 # okoro-sdk (Python)
│       ├── okoro/
│       │   ├── __init__.py
│       │   ├── client.py
│       │   ├── agent.py
│       │   └── types.py
│       └── pyproject.toml
├── workers/
│   └── cf-verify/              # Cloudflare Worker (Phase 3)
│       ├── src/
│       │   └── index.ts
│       └── wrangler.toml
├── docker-compose.yml
├── railway.json
└── package.json
```

---

## SECTION 2 — COMPLETE PRISMA SCHEMA

```prisma
// schema.prisma — OKORO v1.0

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── PRINCIPALS ──────────────────────────────────────

model Principal {
  id                String   @id @default(cuid())
  email             String   @unique
  name              String?
  planTier          PlanTier @default(FREE)
  billingCustomerId String?  // Stripe customer ID

  // Verification
  emailVerified     Boolean  @default(false)
  kycVerified       Boolean  @default(false)

  // API access
  apiKeys           ApiKey[]

  // Ownership
  agents            AgentIdentity[]
  webhooks          WebhookSubscription[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([email])
}

model ApiKey {
  id          String    @id @default(cuid())
  keyHash     String    @unique // bcrypt hash — never store plaintext
  keyPrefix   String    // First 8 chars for identification: "okoro_sk_xxxx"
  label       String?
  principalId String
  principal   Principal @relation(fields: [principalId], references: [id], onDelete: Cascade)
  lastUsedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  @@index([principalId])
  @@index([keyHash])
}

enum PlanTier {
  FREE
  DEVELOPER
  GROWTH
  ENTERPRISE
}

// ─── AGENT IDENTITY ───────────────────────────────────

model AgentIdentity {
  id              String      @id @default(cuid()) // The public agentId
  publicKey       String      // Ed25519 public key, base64url
  principalId     String
  principal       Principal   @relation(fields: [principalId], references: [id], onDelete: Cascade)

  // Metadata
  label           String?
  runtime         AgentRuntime
  model           String?     // "gpt-4o", "claude-3-7-sonnet", etc.

  // Status
  status          AgentStatus @default(PENDING_VERIFICATION)
  revokedAt       DateTime?
  revokedReason   String?

  // Trust (computed by BATE)
  trustScore      Int         @default(500) // 0-1000
  trustBand       TrustBand   @default(VERIFIED)
  lastScoredAt    DateTime?

  // Activity
  lastSeenAt      DateTime?
  verifyCount     Int         @default(0)
  verifyCountDay  Int         @default(0) // Reset daily

  // Relations
  policies        AgentPolicy[]
  auditEvents     AuditEvent[]
  bateSignals     BateSignal[]
  delegations     AgentDelegation[] @relation("delegator")
  delegatedTo     AgentDelegation[] @relation("delegate")

  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([principalId])
  @@index([status])
  @@index([trustScore])
}

enum AgentRuntime {
  OPENAI
  ANTHROPIC
  GOOGLE
  HUGGINGFACE
  CUSTOM
}

enum AgentStatus {
  PENDING_VERIFICATION  // Keypair not yet confirmed
  ACTIVE
  SUSPENDED             // Temp suspension, can be restored
  REVOKED               // Permanent, cannot be restored
}

enum TrustBand {
  PLATINUM   // 750-1000
  VERIFIED   // 500-749
  WATCH      // 250-499
  FLAGGED    // 0-249
}

// ─── POLICIES ─────────────────────────────────────────

model AgentPolicy {
  id          String        @id @default(cuid())
  agentId     String
  agent       AgentIdentity @relation(fields: [agentId], references: [id], onDelete: Cascade)
  label       String?

  // Token (signed JWT containing policy claims)
  signedToken String        @db.Text
  tokenHash   String        // SHA256 of signed token for fast lookup

  // Status
  status      PolicyStatus  @default(ACTIVE)
  revokedAt   DateTime?
  expiresAt   DateTime

  // Scopes (stored as JSON for flexibility)
  scopes      Json          // PolicyScope[]

  // Usage tracking
  verifyCount Int           @default(0)

  createdAt   DateTime      @default(now())

  @@index([agentId])
  @@index([tokenHash])
  @@index([status, expiresAt])
}

enum PolicyStatus {
  ACTIVE
  EXPIRED
  REVOKED
}

// ─── SPEND TRACKING ───────────────────────────────────

model SpendRecord {
  id          String   @id @default(cuid())
  agentId     String
  policyId    String
  amount      Decimal  @db.Decimal(10, 2)
  currency    String   @default("USD")
  merchantId  String?
  domain      String?
  date        DateTime @default(now())

  // Aggregation helpers (updated on insert)
  dateKey     String   // "2026-05-01" — for daily aggregation
  monthKey    String   // "2026-05" — for monthly aggregation

  @@index([agentId, dateKey])
  @@index([agentId, monthKey])
}

// ─── AUDIT ────────────────────────────────────────────

model AuditEvent {
  id                String        @id @default(cuid())
  agentId           String
  agent             AgentIdentity @relation(fields: [agentId], references: [id])
  principalId       String

  // Event detail
  action            String        // "commerce.purchase", "data.read", etc.
  decision          AuditDecision
  denialReason      String?

  // Context
  relyingParty      String?       // Domain or ID of the service that called /verify
  requestedAmount   Decimal?      @db.Decimal(10, 2)
  currency          String?

  // Policy snapshot (exact policy at time of event)
  policyId          String?
  policySnapshot    Json?         // Full PolicyScope[] at time of decision

  // Trust snapshot
  trustScoreAtEvent Int
  trustBandAtEvent  TrustBand

  // Integrity
  okoroSignature    String        @db.Text // OKORO signs this record

  timestamp         DateTime      @default(now())

  @@index([agentId, timestamp])
  @@index([principalId, timestamp])
  @@index([relyingParty, timestamp])
  @@index([timestamp]) // For BATE signal queries
}

enum AuditDecision {
  APPROVED
  DENIED
  FLAGGED
}

// ─── BATE ─────────────────────────────────────────────

model BateSignal {
  id            String          @id @default(cuid())
  agentId       String
  agent         AgentIdentity   @relation(fields: [agentId], references: [id])

  signalType    BateSignalType
  severity      SignalSeverity  @default(MEDIUM)
  source        String          // "internal" | "relying_party:{id}"

  // Signal payload
  payload       Json            // Flexible — varies by signalType

  // Idempotency
  idempotencyKey String?        @unique

  // Processing
  processed     Boolean         @default(false)
  processedAt   DateTime?
  scoreDelta    Int?            // How much this signal moved the score

  occurredAt    DateTime        @default(now())

  @@index([agentId, processed])
  @@index([signalType, occurredAt])
}

enum BateSignalType {
  // Positive signals
  CLEAN_TRANSACTION
  PRINCIPAL_KYC_VERIFIED
  CONSISTENT_GEOGRAPHY
  NORMAL_VELOCITY

  // Negative signals
  RELYING_PARTY_FRAUD_REPORT
  VELOCITY_ANOMALY
  GEOGRAPHIC_INCONSISTENCY
  SPEND_PATTERN_DEVIATION
  POLICY_VIOLATION_ATTEMPT
  FAILED_VERIFY_SPIKE
  DELEGATION_CHAIN_ANOMALY
}

enum SignalSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

model TrustScoreHistory {
  id          String        @id @default(cuid())
  agentId     String
  score       Int
  band        TrustBand
  reason      String        // Human-readable reason for change
  signalId    String?       // BateSignal that triggered this change

  recordedAt  DateTime      @default(now())

  @@index([agentId, recordedAt])
}

// ─── DELEGATIONS ──────────────────────────────────────

model AgentDelegation {
  id            String        @id @default(cuid())
  delegatorId   String        // The agent granting delegation
  delegator     AgentIdentity @relation("delegator", fields: [delegatorId], references: [id])
  delegateId    String        // The agent receiving delegation
  delegate      AgentIdentity @relation("delegate", fields: [delegateId], references: [id])

  // What the delegate can do (subset of delegator's policies)
  scopeSubset   Json          // PolicyScope[] — must be subset of delegator scopes

  // Chain
  chainDepth    Int           @default(1) // How deep in the chain
  chainRoot     String        // The original human principal's agent

  // Token
  delegationToken String      @db.Text // Signed JWT with full delegation chain

  status        PolicyStatus  @default(ACTIVE)
  expiresAt     DateTime
  createdAt     DateTime      @default(now())

  @@index([delegatorId])
  @@index([delegateId])
}

// ─── WEBHOOKS ─────────────────────────────────────────

model WebhookSubscription {
  id          String      @id @default(cuid())
  principalId String
  principal   Principal   @relation(fields: [principalId], references: [id], onDelete: Cascade)

  url         String
  secret      String      // HMAC secret for signature verification
  events      String[]    // ["okoro.agent.trust_score_changed", ...]

  active      Boolean     @default(true)
  createdAt   DateTime    @default(now())

  deliveries  WebhookDelivery[]

  @@index([principalId])
}

model WebhookDelivery {
  id              String              @id @default(cuid())
  subscriptionId  String
  subscription    WebhookSubscription @relation(fields: [subscriptionId], references: [id])

  event           String
  payload         Json

  status          DeliveryStatus      @default(PENDING)
  attempts        Int                 @default(0)
  lastAttemptAt   DateTime?
  nextRetryAt     DateTime?
  responseCode    Int?
  responseBody    String?             @db.Text

  createdAt       DateTime            @default(now())

  @@index([subscriptionId, status])
  @@index([nextRetryAt]) // For retry worker query
}

enum DeliveryStatus {
  PENDING
  DELIVERED
  FAILED
  ABANDONED
}

// ─── RELYING PARTIES ──────────────────────────────────

model RelyingParty {
  id          String   @id @default(cuid())
  name        String
  domain      String   @unique
  apiKeyHash  String   @unique // Their verify-key hash

  // Trust weight for their reports (higher = more weight in BATE)
  reportWeight Float   @default(1.0)

  verified    Boolean  @default(false)
  verifiedAt  DateTime?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([domain])
}
```

---

## SECTION 3 — CORE SERVICE IMPLEMENTATIONS

### 3.1 Verify Service (The Critical Path)

```typescript
// verify.service.ts — every line matters here

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { Ed25519Util } from '../common/crypto/ed25519.util';
import { JwtUtil } from '../common/crypto/jwt.util';
import { BateService } from '../bate/bate.service';
import { SpendGuardService } from './spend-guard.service';
import { AuditService } from '../audit/audit.service';
import { VerifyRequestDto, VerifyResponseDto } from './verify.dto';

@Injectable()
export class VerifyService {
  private readonly logger = new Logger(VerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ed25519: Ed25519Util,
    private readonly jwt: JwtUtil,
    private readonly bate: BateService,
    private readonly spendGuard: SpendGuardService,
    private readonly audit: AuditService,
  ) {}

  async verify(dto: VerifyRequestDto): Promise<VerifyResponseDto> {
    const startMs = Date.now();

    // Step 1 — Decode token (fail fast, no DB hit)
    let claims: AgentTokenClaims;
    try {
      claims = await this.jwt.decode(dto.token);
    } catch {
      return this.deny('INVALID_SIGNATURE', null, null, startMs);
    }

    const { agentId, policyId } = claims;

    // Step 2 — Agent status (Redis cache first, 60s TTL)
    const cacheKey = `agent:status:${agentId}`;
    let agent = await this.redis.get<CachedAgent>(cacheKey);

    if (!agent) {
      const dbAgent = await this.prisma.agentIdentity.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          publicKey: true,
          status: true,
          trustScore: true,
          trustBand: true,
          principalId: true,
        },
      });

      if (!dbAgent) {
        return this.deny('AGENT_NOT_FOUND', agentId, null, startMs);
      }

      agent = dbAgent;
      await this.redis.set(cacheKey, agent, 60);
    }

    if (agent.status === 'REVOKED') {
      return this.deny('AGENT_REVOKED', agentId, agent.principalId, startMs);
    }

    if (agent.status !== 'ACTIVE') {
      return this.deny('AGENT_NOT_FOUND', agentId, agent.principalId, startMs);
    }

    // Step 3 — Cryptographic signature verification
    const isValidSig = await this.ed25519.verify(dto.token, agent.publicKey);

    if (!isValidSig) {
      return this.deny('INVALID_SIGNATURE', agentId, agent.principalId, startMs);
    }

    // Step 4 — Policy check (Redis cache first, 30s TTL)
    const policyCacheKey = `policy:${policyId}`;
    let policy = await this.redis.get<CachedPolicy>(policyCacheKey);

    if (!policy) {
      const dbPolicy = await this.prisma.agentPolicy.findUnique({
        where: { id: policyId, agentId },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          scopes: true,
        },
      });

      if (!dbPolicy) {
        return this.deny('POLICY_EXPIRED', agentId, agent.principalId, startMs);
      }

      policy = dbPolicy;
      const ttl = Math.min(30, Math.floor((policy.expiresAt.getTime() - Date.now()) / 1000));
      if (ttl > 0) await this.redis.set(policyCacheKey, policy, ttl);
    }

    if (policy.status === 'REVOKED') {
      return this.deny('POLICY_REVOKED', agentId, agent.principalId, startMs);
    }

    if (new Date() > policy.expiresAt) {
      return this.deny('POLICY_EXPIRED', agentId, agent.principalId, startMs);
    }

    // Step 5 — Scope check
    const scopes = policy.scopes as PolicyScope[];
    const requestedScope = dto.action?.split('.')[0] ?? 'general';
    const matchingScope = scopes.find((s) => s.category === requestedScope);

    if (dto.action && !matchingScope) {
      return this.deny('SCOPE_NOT_GRANTED', agentId, agent.principalId, startMs);
    }

    // Step 6 — Domain check (if scope has allowedDomains)
    if (matchingScope?.allowedDomains?.length && dto.merchantDomain) {
      if (!matchingScope.allowedDomains.includes(dto.merchantDomain)) {
        return this.deny('SCOPE_NOT_GRANTED', agentId, agent.principalId, startMs);
      }
    }

    // Step 7 — Spend limit check (async but fast — daily/monthly totals in Redis)
    if (dto.amount && matchingScope?.spendLimit) {
      const spendResult = await this.spendGuard.check(
        agentId,
        policyId,
        dto.amount,
        dto.currency ?? 'USD',
        matchingScope.spendLimit,
      );

      if (!spendResult.allowed) {
        return this.deny('SPEND_LIMIT_EXCEEDED', agentId, agent.principalId, startMs);
      }
    }

    // Step 8 — Trust score from Redis (pre-computed, sub-ms lookup)
    const trustScore = agent.trustScore;
    const trustBand = agent.trustBand;

    // Step 9 — Record spend (fire-and-forget, non-blocking)
    if (dto.amount) {
      this.spendGuard
        .recordSpend(agentId, policyId, dto.amount, dto.currency ?? 'USD', dto.merchantId)
        .catch((e) => this.logger.error('Spend record failed', e));
    }

    // Step 10 — Audit log (fire-and-forget, non-blocking)
    this.audit
      .record({
        agentId,
        principalId: agent.principalId,
        action: dto.action ?? 'verify',
        decision: 'APPROVED',
        relyingParty: dto.merchantDomain,
        requestedAmount: dto.amount,
        currency: dto.currency,
        policyId,
        policySnapshot: scopes,
        trustScoreAtEvent: trustScore,
        trustBandAtEvent: trustBand,
      })
      .catch((e) => this.logger.error('Audit record failed', e));

    // Step 11 — BATE signal (fire-and-forget)
    this.bate
      .ingestSignal({
        agentId,
        signalType: 'CLEAN_TRANSACTION',
        severity: 'LOW',
        source: 'internal',
        payload: { action: dto.action, amount: dto.amount, merchantDomain: dto.merchantDomain },
      })
      .catch((e) => this.logger.error('BATE signal failed', e));

    const latencyMs = Date.now() - startMs;
    this.logger.debug(`Verify approved: ${agentId} in ${latencyMs}ms`);

    return {
      valid: true,
      agentId,
      principalId: agent.principalId,
      trustScore,
      trustBand,
      scopesGranted: scopes.map((s) => s.category),
      verifiedAt: new Date().toISOString(),
      ttl: 30,
      denialReason: null,
    };
  }

  private async deny(
    reason: DenialReason,
    agentId: string | null,
    principalId: string | null,
    startMs: number,
  ): Promise<VerifyResponseDto> {
    this.logger.debug(`Verify denied: ${reason} for agent ${agentId}`);

    if (agentId) {
      // Fire-and-forget audit on denial too
      this.audit
        .record({
          agentId,
          principalId: principalId ?? 'unknown',
          action: 'verify',
          decision: 'DENIED',
          denialReason: reason,
          trustScoreAtEvent: 0,
          trustBandAtEvent: 'FLAGGED',
        })
        .catch(() => {});
    }

    return {
      valid: false,
      agentId: agentId ?? null,
      principalId: principalId ?? null,
      trustScore: 0,
      trustBand: null,
      scopesGranted: [],
      denialReason: reason,
      verifiedAt: new Date().toISOString(),
      ttl: 0,
    };
  }
}
```

#### 3.1.1 Denial Reasons

The `DenialReason` union (see `apps/api/src/modules/verify/verify.dto.ts`) is split
into two tiers. Tier 0 is a **pre-algorithm gate** that runs before the cryptographic
denial precedence chain even begins. Tier 1 is the fixed 9-step precedence chain
documented in `CLAUDE.md` § Architecture invariants and `docs/SECURITY.md` §
Denial Precedence — it is what relying parties code against.

**Tier 0 — Pre-algorithm gate (billing / commercial):**

| Reason                | When it fires                                                                                                                                                                                                                                                                                                                           | Source of truth                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PLAN_LIMIT_EXCEEDED` | Principal has exceeded their plan-tier monthly verify quota. Returned with HTTP 200 (not 429) because it's a contractual quota, not a transient throttle. Body includes `remaining: 0`, `monthlyQuota: <N>`, `planTier: <tier>`. Fires **before** any signature, policy, or trust evaluation — the 9-step chain below is not consulted. | `apps/api/src/modules/billing/usage-guard.service.ts`, `apps/api/src/modules/verify/verify.service.ts` |

**Tier 1 — Denial precedence chain (top wins, order is fixed):**

1. `AGENT_NOT_FOUND`
2. `AGENT_REVOKED`
3. `INVALID_SIGNATURE`
4. `POLICY_REVOKED`
5. `POLICY_EXPIRED`
6. `SCOPE_NOT_GRANTED`
7. `SPEND_LIMIT_EXCEEDED`
8. `TRUST_SCORE_TOO_LOW`
9. `ANOMALY_FLAGGED`

`PLAN_LIMIT_EXCEEDED` does **not** interleave with this chain. It is checked
first; if it fires, the verify service returns immediately and none of the
cryptographic / authz steps run. This keeps the precedence chain a property
of the verification algorithm itself, untouched by commercial concerns.

### 3.2 BATE Scoring Engine

```typescript
// bate.scorer.ts — Trust score computation

interface ScoringContext {
  agent: AgentIdentity;
  recentSignals: BateSignal[]; // Last 30 days
  signalCounts: Record<BateSignalType, number>;
}

export class BateScorer {
  compute(ctx: ScoringContext): number {
    let score = ctx.agent.trustScore; // Start from current score (not 500 always)

    // ── POSITIVE SIGNALS ──────────────────────────────

    // Clean transactions: +1 per clean tx, capped at +20/day
    const cleanTxCount = ctx.signalCounts['CLEAN_TRANSACTION'] ?? 0;
    score += Math.min(cleanTxCount * 1, 20);

    // KYC verified principal: +150 (one-time, already baked into baseline)
    // Age cohort bonus: +0.5 per day of age, max +100 at 200 days
    const ageDays = Math.floor((Date.now() - ctx.agent.createdAt.getTime()) / 86400000);
    const ageCohortBonus = Math.min(ageDays * 0.5, 100);
    // Only apply if not already applied — check lastScoredAt
    // (simplified — full implementation tracks these separately)

    // Consistent geography: +5 if all requests from same IP block
    if (ctx.signalCounts['CONSISTENT_GEOGRAPHY'] > 0) {
      score += 5;
    }

    // Normal velocity maintained for 7+ days: +10
    const normalVelocityDays = ctx.recentSignals.filter(
      (s) => s.signalType === 'NORMAL_VELOCITY',
    ).length;
    if (normalVelocityDays >= 7) score += 10;

    // ── NEGATIVE SIGNALS ──────────────────────────────

    // Relying party fraud report: -100 to -500 by severity
    const fraudReports = ctx.recentSignals.filter(
      (s) => s.signalType === 'RELYING_PARTY_FRAUD_REPORT',
    );
    for (const report of fraudReports) {
      const penalty =
        {
          LOW: -25,
          MEDIUM: -100,
          HIGH: -250,
          CRITICAL: -500,
        }[report.severity] ?? -100;
      score += penalty;
    }

    // Velocity anomaly: -50 per event
    score -= (ctx.signalCounts['VELOCITY_ANOMALY'] ?? 0) * 50;

    // Geographic inconsistency: -30 per event
    score -= (ctx.signalCounts['GEOGRAPHIC_INCONSISTENCY'] ?? 0) * 30;

    // Spend pattern deviation: -20 per event
    score -= (ctx.signalCounts['SPEND_PATTERN_DEVIATION'] ?? 0) * 20;

    // Policy violation attempt: -75 per event
    score -= (ctx.signalCounts['POLICY_VIOLATION_ATTEMPT'] ?? 0) * 75;

    // Failed verify spike: -40 per event
    score -= (ctx.signalCounts['FAILED_VERIFY_SPIKE'] ?? 0) * 40;

    // ── FLOOR/CEILING ─────────────────────────────────
    return Math.max(0, Math.min(1000, Math.round(score)));
  }

  bandFromScore(score: number): TrustBand {
    if (score >= 750) return 'PLATINUM';
    if (score >= 500) return 'VERIFIED';
    if (score >= 250) return 'WATCH';
    return 'FLAGGED';
  }
}
```

### 3.3 Spend Guard Service

```typescript
// spend-guard.service.ts — Redis-backed spend tracking

@Injectable()
export class SpendGuardService {
  constructor(private readonly redis: RedisService) {}

  async check(
    agentId: string,
    policyId: string,
    amount: number,
    currency: string,
    limit: SpendLimit,
  ): Promise<{ allowed: boolean; remainingDay: number; remainingMonth: number }> {
    const today = new Date().toISOString().slice(0, 10); // "2026-05-01"
    const month = new Date().toISOString().slice(0, 7); // "2026-05"

    const dayKey = `spend:day:${agentId}:${policyId}:${today}`;
    const monthKey = `spend:month:${agentId}:${policyId}:${month}`;

    const [daySpend, monthSpend] = await Promise.all([
      this.redis.get<number>(dayKey) ?? 0,
      this.redis.get<number>(monthKey) ?? 0,
    ]);

    const wouldExceedDay = limit.maxPerDay && daySpend + amount > limit.maxPerDay;
    const wouldExceedMonth = limit.maxPerMonth && monthSpend + amount > limit.maxPerMonth;
    const wouldExceedTx = limit.maxPerTransaction && amount > limit.maxPerTransaction;

    if (wouldExceedDay || wouldExceedMonth || wouldExceedTx) {
      return {
        allowed: false,
        remainingDay: Math.max(0, (limit.maxPerDay ?? Infinity) - daySpend),
        remainingMonth: Math.max(0, (limit.maxPerMonth ?? Infinity) - monthSpend),
      };
    }

    return {
      allowed: true,
      remainingDay: (limit.maxPerDay ?? Infinity) - daySpend,
      remainingMonth: (limit.maxPerMonth ?? Infinity) - monthSpend,
    };
  }

  async recordSpend(
    agentId: string,
    policyId: string,
    amount: number,
    currency: string,
    merchantId?: string,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);

    const dayKey = `spend:day:${agentId}:${policyId}:${today}`;
    const monthKey = `spend:month:${agentId}:${policyId}:${month}`;

    // Atomic increment with TTL (day key expires in 2 days, month in 35 days)
    await Promise.all([
      this.redis.incrBy(dayKey, amount, 172800), // 2 days TTL
      this.redis.incrBy(monthKey, amount, 3024000), // 35 days TTL
    ]);
  }
}
```

---

## SECTION 4 — SDK DESIGN (TypeScript)

```typescript
// @okoro/sdk — index.ts

export class Okoro {
  private readonly config: OkoroConfig;
  private readonly http: OkoroHttpClient;

  public readonly agent: AgentClient;
  public readonly policy: PolicyClient;

  constructor(config: OkoroConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://api.okoroapp.com/v1',
      timeout: config.timeout ?? 5000,
    };
    this.http = new OkoroHttpClient(this.config);
    this.agent = new AgentClient(this.http);
    this.policy = new PolicyClient(this.http);
  }

  // Primary relying-party method
  async verify(token: string, context?: VerifyContext): Promise<VerifyResult> {
    return this.http.post('/verify', { token, ...context });
  }
}

export class AgentClient {
  constructor(private readonly http: OkoroHttpClient) {}

  // Sign an outbound request — the developer calls this before each agent action
  async sign(privateKey: string, policyToken: string, context?: SignContext): Promise<string> {
    // Creates a signed JWT: { agentId, policyId, action, amount, iat, exp }
    return signAgentToken(privateKey, policyToken, context);
  }

  async register(req: RegisterAgentRequest): Promise<RegisteredAgent> {
    return this.http.post('/agents/register', req);
  }

  async get(agentId: string): Promise<AgentIdentity> {
    return this.http.get(`/agents/${agentId}`);
  }

  async revoke(agentId: string): Promise<void> {
    return this.http.delete(`/agents/${agentId}`);
  }

  async status(agentId: string): Promise<AgentStatus> {
    return this.http.get(`/agents/${agentId}/status`);
  }

  async audit(agentId: string, params?: AuditQueryParams): Promise<AuditLog> {
    return this.http.get(`/agents/${agentId}/audit`, params);
  }

  async report(agentId: string, report: BehaviorReport): Promise<void> {
    return this.http.post(`/agents/${agentId}/report`, report);
  }
}

// ── USAGE EXAMPLE ────────────────────────────────────────
//
// Developer-side (agent builder):
//
// import { Okoro } from '@okoro/sdk';
//
// const okoro = new Okoro({ apiKey: process.env.OKORO_API_KEY });
//
// // One-time setup: register agent and create policy
// const agent = await okoro.agent.register({
//   publicKey: myEd25519PublicKey,
//   runtime: 'anthropic',
//   model: 'claude-sonnet-4-5',
//   label: 'Shopping agent for alice@example.com',
//   principalId: 'principal_abc123',
// });
//
// const policy = await okoro.policy.create(agent.agentId, {
//   label: 'Buy flights under $500',
//   scopes: [{
//     category: 'commerce',
//     spendLimit: { currency: 'USD', maxPerTransaction: 500, maxPerDay: 1000 },
//     allowedDomains: ['delta.com', 'united.com', 'southwest.com'],
//   }],
//   expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
// });
//
// // Before each agent action: sign the request
// const token = await okoro.agent.sign(myPrivateKey, policy.signedToken, {
//   action: 'commerce.purchase',
//   amount: 347.00,
//   currency: 'USD',
//   merchantDomain: 'delta.com',
// });
//
// // Send token with agent request to Delta
// const response = await fetch('https://api.delta.com/book', {
//   headers: { 'X-OKORO-Token': token },
//   body: JSON.stringify({ flight: 'DL401', ... }),
// });
//
// ── RELYING PARTY USAGE (Delta's server):
//
// const okoro = new Okoro({ apiKey: process.env.OKORO_VERIFY_KEY });
//
// const result = await okoro.verify(req.headers['x-okoro-token'], {
//   action: 'commerce.purchase',
//   amount: 347.00,
//   merchantDomain: 'delta.com',
// });
//
// if (!result.valid) {
//   return res.status(403).json({ error: result.denialReason });
// }
//
// if (result.trustScore < 500) {
//   // Extra friction for WATCH agents
//   return requireHumanApproval(result);
// }
//
// proceedWithBooking();
```

---

## SECTION 5 — SECURITY ARCHITECTURE

### 5.1 Threat Model

| Threat             | Description                                   | Mitigation                                                               |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------ |
| Token theft        | Attacker steals signed token and replays      | JWT `exp` of 60s max; single-use `jti` claim on high-value actions       |
| Key compromise     | Developer's private key stolen                | Immediate revocation API; OKORO never holds private key                  |
| BATE poisoning     | Attacker floods fake signals to inflate score | Report weight by verified relying party only; rate limiting on reports   |
| DDoS on verify     | Flood /verify endpoint                        | Cloudflare WAF + rate limiting per API key; edge caching                 |
| Prompt injection   | Agent is jailbroken into signing bad requests | Policy hard limits enforced server-side; client-side signing is advisory |
| Principal spoofing | Attacker registers as a legitimate company    | Email verification + optional KYC for BATE bonus                         |
| Insider threat     | OKORO employee reads audit logs               | Audit records OKORO-signed and tamper-evident; access logged             |
| Supply chain       | SDK dependency compromised                    | pinned deps, Sigstore signing of npm packages                            |

### 5.2 Cryptographic Details

**Agent signing:** Ed25519 (libsodium). 32-byte private key, 32-byte public key. Signatures are 64 bytes. Signing is ~50μs — effectively free.

**Token format:** Compact JWT, Ed25519-signed.

```json
Header: { "alg": "EdDSA", "typ": "JWT" }
Payload: {
  "sub": "agt_01HZ9...",    // agentId
  "pid": "pol_01HZ9...",    // policyId
  "act": "commerce.purchase",
  "amt": 347.00,
  "cur": "USD",
  "dom": "delta.com",
  "iat": 1746700000,
  "exp": 1746700060,        // 60 second max TTL
  "jti": "ulid_01HZ9..."    // unique per request (for jti replay prevention on high-value)
}
```

**Audit record signing:** OKORO signs each AuditEvent with an OKORO-held Ed25519 keypair (separate from the policy-signing keypair so a policy-key compromise does not invalidate the audit chain). Decision rationale and post-quantum migration plan live in `docs/THREAT_MODEL_v2.md` § 4.2 and `docs/POST_QUANTUM_ROADMAP.md`. This allows third parties to verify audit records without OKORO involvement. Public key published at `https://api.okoroapp.com/.well-known/jwks.json` (and the convenience endpoint `https://api.okoroapp.com/.well-known/audit-signing-key`).

**API key format:** `okoro_sk_[32 random bytes base58]`. Stored as bcrypt hash (cost 12). Only the `okoro_sk_` prefix + first 4 chars stored as `keyPrefix` for identification in dashboards.

### 5.3 Compliance Mapping

| Standard                            | OKORO Coverage                                    | Gap                                    |
| ----------------------------------- | ------------------------------------------------- | -------------------------------------- |
| NIST AI Agent Identity (2026 draft) | Agent identity, authorization, auditing           | Prompt injection controls (agent-side) |
| SOC2 Type II                        | Audit trail, access controls, availability        | Requires 6-month evidence window       |
| GDPR                                | Minimal data (public key + transaction metadata)  | Data residency option needed for EU    |
| FINRA                               | Audit trail, revocation, principal accountability | Needs FINRA-specific report templates  |
| COSSEC (PR)                         | Audit trail, compliance artifacts                 | COSSEC-specific module in Phase 3      |

---

_Document 03 of 05 | OKORO KLYTICS Internal Suite_
