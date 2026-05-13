# AEGIS — Developer Quickstart
## From Zero to First Verified Agent Call in 10 Minutes

> **Audience:** Developer integrating AEGIS for the first time.  
> **Time:** ~10 minutes for happy path. ~30 minutes for full denial-precedence walkthrough.  
> **Prerequisites:** Node.js 18+ or Python 3.11+. An AEGIS API key (get one at dashboard.aegislabs.io or via the CLI).

---

## The 30-Second Concept

```
Your Agent                 AEGIS                    Your Service (Relying Party)
    │                         │                              │
    │  1. register()          │                              │
    │ ──────────────────────► │                              │
    │  ◄─── agentId + pubkey  │                              │
    │                         │                              │
    │  2. policies.create()   │                              │
    │ ──────────────────────► │                              │
    │  ◄────── policyId + JWT │                              │
    │                         │                              │
    │  3. sign(privateKey, action, amount)                   │
    │  ─ token (local, no network) ──────────────────────►  │
    │                         │                              │
    │                         │  4. aegis.verify(token)      │
    │                         │ ◄──────────────────────────  │
    │                         │  ──── { valid, trustScore } ►│
    │                         │                              │
    │              ◄─ approved or denied ───────────────────►│
```

**Private key never leaves your process. AEGIS only sees the public key.**

---

## Option A — TypeScript / JavaScript

### 1. Install

```bash
npm install @aegis/sdk
# or
pnpm add @aegis/sdk
# or
yarn add @aegis/sdk
```

### 2. Register an Agent

```typescript
import { AegisClient, generateKeypair } from '@aegis/sdk';

const aegis = new AegisClient({
  apiKey: process.env.AEGIS_API_KEY!,        // Your management API key
  baseUrl: 'https://api.aegislabs.io/v1',    // default; omit in prod
});

// Generate an Ed25519 keypair. Private key stays client-side — NEVER sent to AEGIS.
const { publicKey, privateKey } = await generateKeypair();

// Register the agent
const agent = await aegis.agents.register({
  publicKey,
  runtime: 'ANTHROPIC',   // 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'HUGGINGFACE' | 'CUSTOM'
  label: 'my-purchase-agent',
  model: 'claude-opus-4',  // optional, for observability
});

console.log('Agent ID:', agent.agentId);
// ► Agent ID: cld_01HXYZ...

// STORE SECURELY: agent.agentId + privateKey (e.g., in OS keychain or HSM)
// You'll need both for every signed request.
```

### 3. Create a Policy

Policies bind an agent to a set of scopes (what it can do), spend limits (how much), and a TTL (how long).

```typescript
const policy = await aegis.policies.create({
  agentId: agent.agentId,
  label: 'flight-booking-scope',
  scopes: [
    {
      category: 'commerce',
      spendLimit: {
        currency: 'USD',
        maxPerTransaction: 1500,     // single txn cap
        maxPerDay: 5000,             // daily rolling cap
        maxPerMonth: 20000,          // monthly cap
      },
      merchantCategories: ['3000-3499'],  // IATA / airline MCC range
      allowedDomains: ['delta.com', 'united.com', 'aa.com'],
    },
    {
      category: 'data-read',         // read-only data access scope
    },
  ],
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
});

console.log('Policy ID:', policy.policyId);
console.log('Signed JWT:', policy.signedToken.slice(0, 40) + '...');
```

### 4. Sign a Per-Action Token

Your agent signs a short-lived token for each action. This token is what relying parties verify.

```typescript
import { sign } from '@aegis/sdk';

// Called by your agent immediately before each action
const token = await sign(privateKey, {
  agentId: agent.agentId,
  policyId: policy.policyId,
  action: 'commerce.purchase',
  amount: 347.50,
  currency: 'USD',
  merchantDomain: 'delta.com',
  merchantId: 'delta-airlines',
  ttlSeconds: 30,             // token expires in 30s (default)
});

// token is a compact EdDSA JWT, ~400 bytes
// Send it as: Authorization: Bearer <token>  or  X-AEGIS-Token: <token>
```

### 5. Verify (Relying-Party Side)

This is what the service receiving the agent's request calls.

```typescript
// In your API handler (Express, Fastify, Hono, etc.)
const result = await aegis.verify(token, {
  action: 'commerce.purchase',
  amount: 347.50,
  currency: 'USD',
  merchantDomain: 'delta.com',
  minTrustScore: 400,           // reject agents with low trust (optional)
});

if (!result.valid) {
  console.error('Denied:', result.denialReason);
  // One of: AGENT_NOT_FOUND | AGENT_REVOKED | INVALID_SIGNATURE |
  //         POLICY_REVOKED | POLICY_EXPIRED | SCOPE_NOT_GRANTED |
  //         SPEND_LIMIT_EXCEEDED | TRUST_SCORE_TOO_LOW | ANOMALY_FLAGGED
  return res.status(403).json({ error: result.denialReason });
}

// result.valid === true
console.log('Agent:', result.agentId);
console.log('Trust score:', result.trustScore, '/', 1000);
console.log('Trust band:', result.trustBand); // PLATINUM | VERIFIED | WATCH | FLAGGED
console.log('Scopes granted:', result.scopesGranted);
console.log('Audit event ID:', result.auditEventId); // link to your own logs
```

### 6. Drop-In Middleware (Express)

```typescript
import express from 'express';
import { AegisClient } from '@aegis/sdk';

const app = express();
const aegis = new AegisClient({ apiKey: process.env.AEGIS_API_KEY! });

// Middleware: verify AEGIS token before any protected route
const requireAgent = (minTrustScore = 400) => async (req, res, next) => {
  const token = req.headers['x-aegis-token'] as string ?? req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'missing_aegis_token' });

  const result = await aegis.verify(token, {
    action: req.path.replace('/', '').replace('/', '.'),
    minTrustScore,
  });

  if (!result.valid) return res.status(403).json({ error: result.denialReason });

  req.agent = result;  // downstream handlers have full result
  next();
};

app.post('/checkout', requireAgent(500), async (req, res) => {
  // req.agent.agentId, req.agent.trustScore, req.agent.scopesGranted
  // proceed with Stripe charge...
});
```

### 7. Offline Verify (No AEGIS Network Call)

For ultra-low-latency relying parties, `@aegis/verifier-rp` verifies tokens offline via cached JWKS:

```typescript
import { AegisVerifier } from '@aegis/verifier-rp';

const verifier = new AegisVerifier({
  // AEGIS JWKS endpoint is fetched once, cached 1h (configurable)
  getAgentPublicKey: async (agentId) => {
    // Your key store — e.g., Redis, or a previous registration cache
    return await myKeyCache.get(agentId); // returns Uint8Array (32 bytes, Ed25519)
  },
});

// Warm the JWKS cache at startup
await verifier.prefetchJwks();

// In your handler — zero network round-trip
const result = await verifier.verify(token, {
  action: 'commerce.purchase',
  amount: 347.50,
  merchantDomain: 'delta.com',
});
```

**Latency:** <1ms on warm cache (Ed25519 verify is ~50μs). Suitable for edge runtimes and high-frequency APIs.

---

## Option B — Python

### 1. Install

```bash
pip install aegis-sdk
# or
uv add aegis-sdk
# or
poetry add aegis-sdk
```

### 2. Full Example (Async)

```python
import asyncio
import os
from aegis import AsyncAegis
from aegis.crypto import generate_keypair, sign

async def main():
    async with AsyncAegis(api_key=os.environ["AEGIS_API_KEY"]) as aegis:

        # 1. Generate keypair (stays client-side)
        keypair = generate_keypair()

        # 2. Register agent
        agent = await aegis.agents.register(
            public_key=keypair.public_key,
            runtime="anthropic",
            label="my-langchain-agent",
        )
        print(f"Agent ID: {agent.agent_id}")

        # 3. Create policy
        policy = await aegis.policies.create(
            agent_id=agent.agent_id,
            scopes=[{
                "category": "commerce",
                "spendLimit": {
                    "currency": "USD",
                    "maxPerTransaction": 500,
                    "maxPerDay": 2000,
                },
                "allowedDomains": ["stripe.com", "shopify.com"],
            }],
            expires_at="2026-12-31T00:00:00Z",
        )

        # 4. Sign a per-action token
        token = sign(
            private_key=keypair.private_key,
            agent_id=agent.agent_id,
            policy_id=policy.policy_id,
            action="commerce.purchase",
            amount=149.99,
            currency="USD",
            merchant_domain="stripe.com",
        )

        # 5. Verify
        result = await aegis.verify(token, action="commerce.purchase", amount=149.99)
        print(f"Valid: {result.valid}")
        print(f"Trust score: {result.trust_score}/1000")

asyncio.run(main())
```

### 3. LangChain Integration

```python
from langchain.tools import BaseTool
from aegis import AsyncAegis
from aegis.crypto import sign

class AegisVerifiedTool(BaseTool):
    """Wrap any LangChain tool with AEGIS verification."""

    name = "verified_purchase"
    description = "Purchase a flight ticket with AEGIS trust verification"

    def __init__(self, aegis_client: AsyncAegis, agent_id: str,
                 policy_id: str, private_key: bytes):
        self.aegis = aegis_client
        self.agent_id = agent_id
        self.policy_id = policy_id
        self.private_key = private_key

    async def _arun(self, amount: float, merchant: str, **kwargs) -> str:
        token = sign(
            private_key=self.private_key,
            agent_id=self.agent_id,
            policy_id=self.policy_id,
            action="commerce.purchase",
            amount=amount,
            merchant_domain=merchant,
        )
        result = await self.aegis.verify(
            token, action="commerce.purchase", amount=amount
        )
        if not result.valid:
            raise PermissionError(f"AEGIS denied: {result.denial_reason}")
        # proceed with actual purchase logic
        return f"Purchase authorized (trust: {result.trust_score}/1000)"
```

---

## Option C — CLI (Go Binary)

### Install

```bash
# macOS (Homebrew)
brew install klytics/tap/aegis

# Linux / macOS (curl installer)
curl -fsSL https://get.aegis.dev/install.sh | sh

# From source
cd packages/cli && go build -o aegis . && sudo mv aegis /usr/local/bin/
```

### First Use

```bash
# Authenticate
aegis login --api-key sk_live_...

# Verify your setup
aegis doctor
# ✓ API reachable (142ms)
# ✓ JWKS endpoint reachable
# ✓ Clock skew OK (+1s)
# ⚠ No agents registered yet

# Register an agent with auto-generated keypair
aegis agents register \
  --runtime anthropic \
  --label "my-first-agent" \
  --generate-keypair

# Output:
# Agent ID: cld_01HXYZ...
# Public key: ed25519:abc123...
# ⚠️  Private key (shown once — store securely):
# 0x4a3b...f99e

# Create a policy
aegis policy create \
  --agent-id cld_01HXYZ \
  --scope commerce \
  --max-per-txn 500 \
  --max-per-day 2000 \
  --allowed-domains "delta.com,united.com" \
  --expires "30d"

# Verify a token
aegis verify eyJhbGciOiJFZERTQSJ9... \
  --action commerce.purchase \
  --amount 347.50 \
  --merchant-domain delta.com

# Output:
# ✓ VALID
# Agent:       cld_01HXYZ (my-first-agent)
# Principal:   princ_01ABC
# Trust score: 512 / 1000 (VERIFIED)
# Scopes:      commerce
# Audit ID:    evt_01DEF
# Latency:     67ms

# Tail live audit events for an agent
aegis events tail --agent-id cld_01HXYZ
# 14:32:01 APPROVED  commerce.purchase  $347.50  delta.com  score=512
# 14:32:47 APPROVED  commerce.purchase  $89.00   delta.com  score=512
# ^C (Ctrl-C exits cleanly)
```

---

## All 9 Denial Reasons — What They Mean and How to Fix

Understanding denial reasons is critical for debugging integrations:

| Denial Reason | Meaning | Fix |
|---|---|---|
| `AGENT_NOT_FOUND` | agentId in token doesn't exist or agent is SUSPENDED | Check agent status: `aegis agents show <id>` |
| `AGENT_REVOKED` | Agent was explicitly revoked | Register a new agent |
| `INVALID_SIGNATURE` | Token tampered, wrong private key, expired, or replay attempt | Re-sign with correct key; check clock skew |
| `POLICY_REVOKED` | Policy was explicitly revoked | Create a new policy |
| `POLICY_EXPIRED` | Policy TTL passed | Create a new policy with updated `expiresAt` |
| `SCOPE_NOT_GRANTED` | Action or merchantDomain not covered by policy scopes | Check scope.category matches action prefix; check allowedDomains |
| `SPEND_LIMIT_EXCEEDED` | Per-txn, per-day, or per-month spend cap hit | Reduce request amount or wait for window reset |
| `TRUST_SCORE_TOO_LOW` | Agent's BATE score below `minTrustScore` | Lower your threshold, or wait for agent to build history |
| `ANOMALY_FLAGGED` | BATE engine has hard-flagged the agent | Check `aegis events tail` for anomaly signals; contact support |

**Denial precedence is guaranteed:** AEGIS always reports the highest-priority denial (AGENT_NOT_FOUND before INVALID_SIGNATURE, etc.). Your error handling can branch on the exact string.

---

## Trust Score — Quick Reference

| Score | Band | Typical relying-party behavior |
|---|---|---|
| 750–1000 | PLATINUM | Pre-approved; highest spend limits |
| 500–749 | VERIFIED | Standard verification; normal limits |
| 250–499 | WATCH | Enhanced checks; lower limits suggested |
| 0–249 | FLAGGED | Most relying parties reject by default |

New agents start at **500 (VERIFIED)**. Score improves via clean transactions, principal KYC verification (+150 one-time), and consistent behavior over time.

---

## Webhooks — Stay Notified of Changes

```typescript
// Subscribe to events that matter to your integration
await aegis.webhooks.create({
  url: 'https://your-api.com/webhooks/aegis',
  secret: process.env.AEGIS_WEBHOOK_SECRET!,
  events: [
    'aegis.agent.revoked',           // Immediate revocation — stop accepting tokens
    'aegis.agent.trust_score_changed', // Score band changes — adjust limits
    'aegis.anomaly.detected',         // Flag for human review
    'aegis.policy.expired',           // Renew policy before next action
  ],
});
```

Verify the webhook signature (Stripe-style):

```typescript
import { createHmac } from 'crypto';

function verifyWebhookSignature(payload: string, header: string, secret: string): boolean {
  const [tPart, v1Part] = header.split(',');
  const timestamp = tPart.split('=')[1];
  const signature = v1Part.split('=')[1];
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return expected === signature;
}

app.post('/webhooks/aegis', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.headers['x-aegis-signature'] as string;
  if (!verifyWebhookSignature(req.body.toString(), header, process.env.AEGIS_WEBHOOK_SECRET!)) {
    return res.status(401).send('Invalid signature');
  }
  const event = JSON.parse(req.body);
  switch (event.type) {
    case 'aegis.agent.revoked':
      // Immediately purge agent from your allow-list / session cache
      await revokeAgentSession(event.data.agentId);
      break;
  }
  res.sendStatus(200);
});
```

---

## Environment Variables Reference

```bash
# Required
AEGIS_API_KEY=sk_live_...          # Management API key (full scope)
AEGIS_VERIFY_KEY=vk_live_...       # Verify-only key (RP-side, no management access)

# Optional
AEGIS_BASE_URL=https://api.aegislabs.io/v1   # default
AEGIS_TIMEOUT_MS=5000                         # default 5000ms
AEGIS_RETRY_ATTEMPTS=3                        # default 3
AEGIS_LOG_LEVEL=info                          # debug | info | warn | error
```

---

## Next Steps

- **MCP Integration:** See `docs/INTEGRATION_GUIDE_MCP.md` — add AEGIS to Claude Desktop or any MCP server in one line
- **LangChain/CrewAI:** See `docs/INTEGRATION_GUIDE_LANGCHAIN.md`
- **RP verifier (offline):** See `docs/INTEGRATION_GUIDE_EXPRESS.md`
- **Fintech pattern:** See `docs/INTEGRATION_GUIDE_FINTECH.md`
- **Production deployment:** See `docs/DEPLOYMENT_GUIDE.md`
- **Full API reference:** See `docs/API_REFERENCE_COMPLETE.md`
- **Monitoring your integration:** See `docs/MONITORING_OBSERVABILITY.md`

---

*Last updated: 2026-05-04 | SDK versions: @aegis/sdk@0.1.0, aegis-sdk@0.1.0, CLI@0.1.0*
