# OKORO — Testing Strategy

## Unit, Integration, E2E, Load, Chaos, and Property Testing

> **Owner:** Engineering Lead  
> **Updated:** 2026-05-04  
> **Principle:** Tests are the contract. The test suite defines behavior more precisely than any spec document.

---

## 1. Testing Philosophy

OKORO tests must answer one question: **"Would a user be approved who should be denied, or denied who should be approved?"**

Everything flows from that. We have zero tolerance for false approvals. A missed denial is a security failure. A false denial is an availability failure. Both are P0.

**Testing pyramid:**

```
       /\          E2E + load (slow, high-value smoke)
      /  \
     /    \        Integration (service + DB + Redis, no mocks)
    /      \
   /--------\      Unit (pure functions — crypto, BATE, algorithm)
```

The middle tier is the most valuable for OKORO. Pure function unit tests validate logic. Integration tests validate the DB/Redis wiring. E2E tests validate the full contract.

---

## 2. Test Framework Decisions

| Layer                              | Framework                  | Reason                                       |
| ---------------------------------- | -------------------------- | -------------------------------------------- |
| NestJS services (apps/api)         | **Jest**                   | NestJS testing module integration            |
| Pure packages (types, verifier-rp) | **Vitest**                 | Faster, ESM-native                           |
| E2E (full API)                     | **Vitest**                 | Runs against live API process                |
| Load testing                       | **k6**                     | Scriptable, CI-friendly, Grafana integration |
| Property-based                     | **fast-check**             | Parametric tests for crypto and algorithm    |
| Multi-tenant isolation             | **Jest** (dedicated suite) | Parallel principal tests                     |

---

## 3. Unit Tests

### 3.1 What Gets Unit Tests

**Always:**

- Every pure function in `apps/api/src/common/crypto/*`
- `verify.algorithm.ts` (every step, every branch)
- `bate.scorer.ts` (every signal type, every band boundary)
- `bate.anomaly.ts` (every rule: R-1 through R-5)
- Every Zod schema in `packages/types`
- Every `OkoroError` subclass
- `audit-chain.ts` (signing, verification, tamper detection)

**With exceptions documented:**

- NestJS controllers (usually integration-tested)
- Service methods that are pure wrappers over Prisma calls

### 3.2 Crypto Unit Tests

Every crypto function requires a paired `.spec.ts`. No exceptions.

```typescript
// apps/api/src/common/crypto/ed25519.spec.ts

describe('ed25519', () => {
  it('round-trips: sign → verify with same key', async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const message = new TextEncoder().encode('hello okoro');
    const sig = await sign(message, privateKey);
    expect(await verify(sig, message, publicKey)).toBe(true);
  });

  it('rejects: signature from different key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const message = new TextEncoder().encode('hello');
    const sig = await sign(message, kp1.privateKey);
    expect(await verify(sig, message, kp2.publicKey)).toBe(false);
  });

  it('rejects: tampered message', async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const original = new TextEncoder().encode('pay $100');
    const tampered = new TextEncoder().encode('pay $999');
    const sig = await sign(original, privateKey);
    expect(await verify(sig, tampered, publicKey)).toBe(false);
  });

  it('rejects: truncated signature', async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const msg = new TextEncoder().encode('hi');
    const sig = await sign(msg, privateKey);
    const truncated = sig.slice(0, 32); // Ed25519 sigs are 64 bytes
    expect(await verify(truncated, msg, publicKey)).toBe(false);
  });
});
```

### 3.3 Algorithm Unit Tests

Test every denial reason explicitly:

```typescript
// apps/api/src/modules/verify/algorithm/verify.algorithm.spec.ts

describe('verifyAlgorithm', () => {
  // For each denial reason, there must be a test.

  it('returns AGENT_NOT_FOUND when agent does not exist', async () => {
    const ports = mockPorts({ getAgent: async () => null });
    const result = await verifyAlgorithm(validInput, ports);
    expect(result.outcome).toBe('denied');
    expect(result.denialReason).toBe('AGENT_NOT_FOUND');
  });

  it('returns AGENT_REVOKED before checking signature', async () => {
    const ports = mockPorts({
      getAgent: async () => ({ ...agent, status: 'REVOKED' }),
      // verifySignature is NOT called — denial-precedence means we stop early
      verifySignature: jest.fn().mockRejectedValue(new Error('should not be called')),
    });
    const result = await verifyAlgorithm(validInput, ports);
    expect(result.outcome).toBe('denied');
    expect(result.denialReason).toBe('AGENT_REVOKED');
    // Signature was NOT checked — denial precedence preserved
  });

  it('SPEND_LIMIT_EXCEEDED fires before TRUST_SCORE_TOO_LOW', async () => {
    const ports = mockPorts({
      checkSpend: async () => ({ exceeded: true, remaining: 0 }),
      getBateScore: jest.fn().mockReturnValue({ score: 100, band: 'FLAGGED' }),
    });
    const result = await verifyAlgorithm(validInput, ports);
    expect(result.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
    expect(ports.getBateScore).not.toHaveBeenCalled(); // step 7 not reached
  });

  it('fails closed on Redis unavailability → ANOMALY_FLAGGED', async () => {
    const ports = mockPorts({
      checkJtiReplay: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const result = await verifyAlgorithm(validInput, ports);
    expect(result.outcome).toBe('denied');
    expect(result.denialReason).toBe('ANOMALY_FLAGGED');
  });

  it('approves: all checks pass', async () => {
    const ports = validMockPorts(); // all checks pass
    const result = await verifyAlgorithm(validInput, ports);
    expect(result.outcome).toBe('approved');
    expect(result.trustBand).toBe('VERIFIED');
  });
});
```

### 3.4 BATE Unit Tests

```typescript
// apps/api/src/modules/bate/bate.scorer.spec.ts

describe('BateScorer', () => {
  it('starts at BASE_SCORE with no signals', () => {
    const result = bateScorer.explain([]);
    expect(result.score).toBe(BASE_SCORE); // 500
    expect(result.band).toBe('VERIFIED');
  });

  it('caps negative signals — cannot go below 0', () => {
    const signals = Array(100).fill({ type: 'FRAUD_REPORT_SEVERE', ts: Date.now() });
    const result = bateScorer.explain(signals);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('caps positive signals — cannot exceed 1000', () => {
    const signals = Array(100).fill({ type: 'SUCCESSFUL_VERIFY', ts: Date.now() });
    const result = bateScorer.explain(signals);
    expect(result.score).toBeLessThanOrEqual(1000);
  });

  it('AGENT_DPOP_REPLAY_ATTEMPT is -200 per occurrence, capped at -600', () => {
    const signals = [1, 2, 3, 4].map(() => ({
      type: 'AGENT_DPOP_REPLAY_ATTEMPT',
      ts: Date.now(),
    }));
    const result = bateScorer.explain(signals);
    // 4 occurrences × -200 = -800, but cap is -600
    const contributor = result.contributors.find((c) => c.type === 'AGENT_DPOP_REPLAY_ATTEMPT');
    expect(contributor?.delta).toBe(-600);
  });

  it('trust band boundaries are correct', () => {
    expect(bandForScore(750)).toBe('PLATINUM');
    expect(bandForScore(749)).toBe('VERIFIED');
    expect(bandForScore(500)).toBe('VERIFIED');
    expect(bandForScore(499)).toBe('WATCH');
    expect(bandForScore(250)).toBe('WATCH');
    expect(bandForScore(249)).toBe('FLAGGED');
  });
});

describe('BateAnomalyDetector', () => {
  it('R-1: velocity — flags burst >100 in 60s', async () => {
    const result = await detector.evaluate({
      agentId: 'agent_test',
      windowVerifyCount: 101,
      windowDuration: 60_000,
    });
    expect(result.triggered).toContain('R-1');
  });

  it('R-2: geo — flags >5 distinct countries in 1 hour', async () => {
    const result = await detector.evaluate({
      agentId: 'agent_test',
      distinctCountries1h: 6,
    });
    expect(result.triggered).toContain('R-2');
  });
});
```

---

## 4. Integration Tests

### 4.1 NestJS Testing Module Pattern

Integration tests spin up the real NestJS DI container with a test database.

```typescript
// apps/api/src/modules/verify/verify.service.integration.spec.ts

describe('VerifyService (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifyService: VerifyService;
  let testPrincipal: Principal;
  let testAgent: AgentIdentity;
  let keyPair: { privateKey: Uint8Array; publicKey: Uint8Array };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CONFIG_SERVICE)
      .useValue(testConfig) // BCRYPT_COST=4 in tests
      .compile();

    app = module.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    verifyService = app.get(VerifyService);

    // Seed test data
    testPrincipal = await seedPrincipal(prisma);
    keyPair = await generateKeyPair();
    testAgent = await seedAgent(prisma, testPrincipal.id, keyPair.publicKey);
  });

  afterAll(async () => {
    await cleanupPrincipal(prisma, testPrincipal.id);
    await app.close();
  });

  it('approves a valid verify call end-to-end (DB + Redis)', async () => {
    const token = await createTestToken(keyPair.privateKey, testAgent.id);
    const result = await verifyService.verify({
      token,
      principalId: testPrincipal.id,
      scopes: ['payment:read'],
      amount: 100,
      currency: 'USD',
    });
    expect(result.outcome).toBe('approved');

    // Verify audit event was written
    const auditEvent = await prisma.auditEvent.findFirst({
      where: { agentId: testAgent.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditEvent).toBeTruthy();
    expect(auditEvent?.outcome).toBe('APPROVED');
    expect(auditEvent?.signature).toBeTruthy(); // chain is signed
  });
});
```

### 4.2 Multi-Tenant Isolation Tests

**This suite must never be skipped.** Cross-principal data leakage is a P0 bug.

```typescript
// apps/api/src/__multi_tenant__/isolation.spec.ts

describe('Multi-tenant isolation', () => {
  let principalA: Principal;
  let principalB: Principal;
  let agentA: AgentIdentity;
  let agentB: AgentIdentity;

  it('principal A cannot read principal B agents', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/agents')
      .set('Authorization', `Bearer ${apiKeyA}`)
      .expect(200);

    const agentIds = response.body.agents.map((a: any) => a.id);
    expect(agentIds).toContain(agentA.id);
    expect(agentIds).not.toContain(agentB.id); // key assertion
  });

  it('principal A cannot verify using principal B agent', async () => {
    // Token signed for agentB, verified using principalA's API key
    const tokenForB = await createTestToken(keyPairB.privateKey, agentB.id);
    const result = await verifyService.verify({
      token: tokenForB,
      principalId: principalA.id, // wrong principal
      scopes: ['any'],
    });
    expect(result.outcome).toBe('denied');
    expect(result.denialReason).toBe('AGENT_NOT_FOUND'); // B's agent not visible to A
  });

  it('audit events are scoped to principal', async () => {
    // Make a verify call as principal A
    await verifyService.verify({ ..., principalId: principalA.id });

    // Principal B querying audit should NOT see principal A's events
    const events = await auditService.query({ principalId: principalB.id });
    const agentAEvents = events.filter(e => e.agentId === agentA.id);
    expect(agentAEvents).toHaveLength(0);
  });

  it('spend counters are isolated per principal', async () => {
    // Exhaust principal A's spend limit
    await exhaustSpendLimit(principalA);

    // Principal B should still be able to spend
    const result = await verifyService.verify({
      token: tokenForB,
      principalId: principalB.id,
      amount: 100,
      currency: 'USD',
    });
    expect(result.outcome).toBe('approved'); // B unaffected by A's exhaustion
  });
});
```

---

## 5. E2E Tests

E2E tests run against a live API process (localhost or staging). They use real HTTP requests, real JWTs, real DB and Redis.

```
tests/e2e/
  01_health.test.ts          — /health and /ready endpoints
  02_auth.test.ts            — API key creation, auth flow
  03_agents.test.ts          — agent CRUD
  04_policies.test.ts        — policy CRUD, policy engine selection
  05_audit.test.ts           — audit log, chain verification
  06_verify_happy.test.ts    — full happy path (all variants)
  07_verify_denials.test.ts  — all 9 denial reasons (required for GA)
  08_replay_protection.test.ts — JTI replay prevention
  09_spend_race.test.ts      — concurrent spend (TOCTOU prevention)
  10_bate.test.ts            — trust score signals, band transitions
  11_webhooks.test.ts        — webhook delivery, HMAC verification
  12_audit_chain.test.ts     — chain integrity, tamper detection
  13_revocation_propagation.test.ts — revocation within 30s
  14_rate_limit.test.ts      — FREE tier throttling
  15_idempotency.test.ts     — idempotent verify calls
```

### 5.1 E2E Test: All 9 Denial Reasons

```typescript
// tests/e2e/07_verify_denials.test.ts

const denialTests: Array<{
  name: string;
  reason: DenialReason;
  setup: (ctx: TestContext) => Promise<VerifyRequest>;
  expectedStatus: number;
}> = [
  {
    name: 'AGENT_NOT_FOUND',
    reason: 'AGENT_NOT_FOUND',
    setup: async (ctx) => ({
      token: await ctx.signToken({ sub: 'nonexistent-agent-id' }),
    }),
    expectedStatus: 404,
  },
  {
    name: 'AGENT_REVOKED',
    reason: 'AGENT_REVOKED',
    setup: async (ctx) => {
      await ctx.revokeAgent(ctx.agent.id);
      return { token: await ctx.signToken({ sub: ctx.agent.id }) };
    },
    expectedStatus: 403,
  },
  {
    name: 'INVALID_SIGNATURE',
    reason: 'INVALID_SIGNATURE',
    setup: async (ctx) => ({
      token: await ctx.signTokenWithWrongKey({ sub: ctx.agent.id }),
    }),
    expectedStatus: 403,
  },
  {
    name: 'SPEND_LIMIT_EXCEEDED',
    reason: 'SPEND_LIMIT_EXCEEDED',
    setup: async (ctx) => {
      await ctx.setSpendPolicy({ dailyLimit: 100, currency: 'USD' });
      await ctx.exhaustSpend(100); // use up the limit
      return { token: await ctx.signToken({ sub: ctx.agent.id, amt: 1 }) };
    },
    expectedStatus: 429,
  },
  // ... all 9
];

test.each(denialTests)('returns %s → HTTP %i', async ({ reason, setup, expectedStatus }) => {
  const ctx = await TestContext.create();
  const request = await setup(ctx);

  const response = await ctx.post('/v1/verify', request);

  expect(response.status).toBe(expectedStatus);
  expect(response.body.approved).toBe(false);
  expect(response.body.denialReason).toBe(reason);

  // Verify audit event was written with correct denial
  const audit = await ctx.getLatestAuditEvent(ctx.agent.id);
  expect(audit.denialReason).toBe(reason);
  expect(audit.outcome).toBe('DENIED');
});
```

### 5.2 E2E Test: Spend Race Condition (TOCTOU)

```typescript
// tests/e2e/09_spend_race.test.ts

it('concurrent spend requests never collectively exceed the limit', async () => {
  const LIMIT = 500; // USD
  const CONCURRENT = 20;
  const AMOUNT_PER_REQUEST = 30; // 20 × 30 = 600 → should only approve 16

  await ctx.setSpendPolicy({ dailyLimit: LIMIT, currency: 'USD' });

  // Fire 20 concurrent requests
  const results = await Promise.all(
    Array(CONCURRENT)
      .fill(null)
      .map(() =>
        ctx.post('/v1/verify', {
          token: await ctx.signToken({ amt: AMOUNT_PER_REQUEST }),
        }),
      ),
  );

  const approved = results.filter((r) => r.body.approved);
  const denied = results.filter((r) => !r.body.approved);

  // Total approved spend must not exceed LIMIT
  const totalApprovedSpend = approved.length * AMOUNT_PER_REQUEST;
  expect(totalApprovedSpend).toBeLessThanOrEqual(LIMIT);

  // Some must be denied
  expect(denied.length).toBeGreaterThan(0);
  denied.forEach((r) => {
    expect(r.body.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
  });
});
```

---

## 6. Load Tests

### 6.1 k6 Verify Load Test

```javascript
// tests/load/verify.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const verifyDuration = new Trend('verify_duration_ms', true);

export const options = {
  stages: [
    { duration: '2m', target: 50 }, // ramp up to 50 RPS
    { duration: '5m', target: 500 }, // sustain 500 RPS
    { duration: '2m', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99)<200'], // p99 < 200ms (SLO)
    errors: ['rate<0.001'], // < 0.1% error rate
    verify_duration_ms: ['p(95)<150'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://api.okoroapp.com/v1';
const API_KEY = __ENV.API_KEY;

export default function () {
  const token = generateToken(); // pre-signed in setup()

  const res = http.post(`${BASE_URL}/verify`, JSON.stringify({ token }), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  errorRate.add(res.status >= 500);
  verifyDuration.add(res.timings.duration);

  check(res, {
    'status is 200 or 403': (r) => r.status === 200 || r.status === 403,
    'response has approved field': (r) => JSON.parse(r.body).approved !== undefined,
    'latency < 200ms': (r) => r.timings.duration < 200,
  });

  sleep(0.01); // 100 RPS per VU
}
```

Run against staging before every GA milestone:

```bash
k6 run tests/load/verify.js \
  -e BASE_URL=https://staging.api.okoroapp.com/v1 \
  -e API_KEY=$STAGING_API_KEY

# Expected results for Phase 1 GA:
# ✓ p99 < 200ms at 500 RPS
# ✓ error rate < 0.1%
# ✓ no SPENT or OOM errors
```

### 6.2 Spend Race Load Test

```javascript
// tests/load/spend-race.js
// Run 100 concurrent requests all trying to hit the spend boundary

export const options = {
  vus: 100,
  iterations: 100,
  // ALL 100 requests fire simultaneously
  executor: 'shared-iterations',
};

export default function () {
  const res = http.post(
    `${BASE_URL}/verify`,
    JSON.stringify({
      token: generateTokenWithAmount(AMOUNT_AT_BOUNDARY),
    }),
    headers,
  );

  // Record: was this approved or denied?
  approvedCounter.add(res.status === 200);
  deniedCounter.add(res.status === 429);
}

export function handleSummary(data) {
  const totalApproved = data.metrics.approved_counter.values.count;
  const totalSpend = totalApproved * AMOUNT_AT_BOUNDARY;

  if (totalSpend > SPEND_LIMIT) {
    throw new Error(`RACE CONDITION: approved $${totalSpend} > limit $${SPEND_LIMIT}`);
  }
}
```

---

## 7. Property-Based Tests

For crypto and algorithm code, property tests find edge cases that example-based tests miss.

```typescript
// apps/api/src/common/crypto/ed25519.property.spec.ts
import fc from 'fast-check';

describe('Ed25519 properties', () => {
  it('for all messages: sign → verify = true', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 1024 }), async (message) => {
        const { privateKey, publicKey } = await generateKeyPair();
        const sig = await sign(message, privateKey);
        return await verify(sig, message, publicKey);
      }),
    );
  });

  it('for all messages: verify with wrong key = false', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 1024 }), async (message) => {
        const kp1 = await generateKeyPair();
        const kp2 = await generateKeyPair();
        const sig = await sign(message, kp1.privateKey);
        return !(await verify(sig, message, kp2.publicKey));
      }),
    );
  });
});

// Algorithm property: denial precedence is a total order
describe('Denial precedence properties', () => {
  it('if AGENT_NOT_FOUND fires, no other denial reason can fire first', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          agentExists: fc.constant(false),
          // All other conditions can be anything
          agentRevoked: fc.boolean(),
          signatureValid: fc.boolean(),
        }),
        async ({ agentRevoked, signatureValid }) => {
          const ports = mockPorts({
            getAgent: async () => null, // agent doesn't exist
            isRevoked: async () => agentRevoked,
            verifySignature: async () => signatureValid,
          });
          const result = await verifyAlgorithm(validInput, ports);
          return result.denialReason === 'AGENT_NOT_FOUND';
        },
      ),
    );
  });
});
```

---

## 8. Audit Chain Integrity Tests

```typescript
// tests/e2e/12_audit_chain.test.ts

it('chain verifies correctly after N verify calls', async () => {
  const N = 10;
  for (let i = 0; i < N; i++) {
    await ctx.post('/v1/verify', validRequest);
  }

  const result = await runChainVerification({ limit: N });
  expect(result.breaks).toBe(0);
  expect(result.eventsVerified).toBe(N);
});

it('chain detects a tampered row', async () => {
  // Make some verify calls
  for (let i = 0; i < 5; i++) {
    await ctx.post('/v1/verify', validRequest);
  }

  // Tamper with one row directly in DB
  const eventId = await ctx.getLatestAuditEventId();
  await ctx.prisma.auditEvent.update({
    where: { id: eventId },
    data: { action: 'tampered-action' },
  });

  // Chain verification should detect the break
  const result = await runChainVerification({ limit: 5 });
  expect(result.breaks).toBe(1);
  expect(result.breakAtEventId).toBe(eventId);
});

it('GDPR erasure: hashing a field preserves chain integrity', async () => {
  const eventId = await ctx.getLatestAuditEventId();

  // Hash the agentId field (GDPR erasure)
  await ctx.post(`/v1/audit/${eventId}/erase-field`, { field: 'agentId' });

  // Chain should still verify — *Hash columns are included in the signature
  const result = await runChainVerification({ limit: 10 });
  expect(result.breaks).toBe(0);
});
```

---

## 9. CI Pipeline

```yaml
# .github/workflows/ci.yml

name: CI

on: [push, pull_request]

jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm jest apps/api --coverage --ci
      - run: pnpm vitest run packages/

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: okoro_test
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
      - run: pnpm jest apps/api/src/__multi_tenant__ --ci
      - run: pnpm vitest run tests/e2e/

  spec-sync:
    runs-on: ubuntu-latest
    steps:
      # Three parallel checks:
      # 1. OpenAPI ↔ Zod schema parity
      # 2. OpenAPI ↔ Prisma schema parity
      # 3. DenialReason enum byte-identical in OpenAPI, Zod, TypeScript
      - run: pnpm tsx scripts/check-openapi-zod-parity.ts
      - run: pnpm tsx scripts/check-openapi-prisma-parity.ts
      - run: pnpm tsx scripts/check-denial-reason-sync.ts

  audit-chain-integrity:
    runs-on: ubuntu-latest
    # Runs on cron + on every PR touching audit code
    if: github.event_name == 'schedule' || contains(github.event.pull_request.changed_files, 'audit')
    steps:
      - run: pnpm tsx scripts/audit-verify-chain.ts --limit 1000
```

---

## 10. Coverage Targets

| Package / Module      | Line Coverage Target      | Branch Coverage Target |
| --------------------- | ------------------------- | ---------------------- |
| `verify.algorithm.ts` | **100%**                  | **100%**               |
| `common/crypto/*`     | **100%**                  | **100%**               |
| `bate.scorer.ts`      | **100%**                  | 95%                    |
| `bate.anomaly.ts`     | 95%                       | 90%                    |
| `audit.service.ts`    | 90%                       | 85%                    |
| `verify.service.ts`   | 85%                       | 80%                    |
| `identity.service.ts` | 80%                       | 75%                    |
| `policy.service.ts`   | 80%                       | 75%                    |
| Controllers           | 70% (E2E covers the rest) | —                      |

Coverage is a floor, not a goal. 100% coverage with meaningless tests is worse than 80% coverage with property tests.

---

## 11. Test Data Management

### 11.1 Seed Script

```bash
# Seed a full test principal with agents, policies, and audit history
pnpm tsx scripts/seed-test-data.ts \
  --principal-email test@example.com \
  --agents 5 \
  --verify-calls 100  # generates audit history for BATE scoring
```

### 11.2 Test Cleanup

Every integration test suite must clean up after itself:

```typescript
afterAll(async () => {
  // Delete in correct order (FK constraints)
  await prisma.auditEvent.deleteMany({ where: { principalId: testPrincipalId } });
  await prisma.agentPolicy.deleteMany({ where: { agent: { principalId: testPrincipalId } } });
  await prisma.agentIdentity.deleteMany({ where: { principalId: testPrincipalId } });
  await prisma.apiKey.deleteMany({ where: { principalId: testPrincipalId } });
  await prisma.principal.delete({ where: { id: testPrincipalId } });

  // Clean Redis keys for this principal
  const keys = await redis.keys(`okoro:*:${testPrincipalId}:*`);
  if (keys.length > 0) await redis.del(...keys);
});
```

---

_Testing strategy version: 1.0 | OKORO Phase 1_  
_Next review: after first 50K verify calls in production_
