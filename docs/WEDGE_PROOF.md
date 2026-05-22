# OKORO — The Product Wedge
## Why This Wins and Why Nobody Can Copy It Fast Enough
### Internal Strategy | May 2026

---

## THE ONE-SENTENCE WEDGE

**OKORO is the tool-call checkpoint for AI agents — the layer that every MCP server needs before it executes, and the trust score that every relying party checks before it complies.**

---

## SECTION 1: THE EXACT PROBLEM WE OWN

### What Exists Today vs. What OKORO Does

```
TODAY (without OKORO):

  LLM → agent → tool call → YOUR API
                              ↑
                         No identity.
                         No policy enforcement.
                         No behavioral history.
                         No audit trail.
                         No way to distinguish:
                           - Your authorized agent
                           - A jailbroken clone of it
                           - A competitor's agent scraping you
                           - A fraud bot wearing your agent's clothes


WITH OKORO:

  LLM → agent → @okoro/mcp-bridge.wrap() → tool call → YOUR API
                       ↑
               Ed25519-signed JWT
               Policy: scopes + spend limits
               Trust score: 0–1000
               Audit event: signed, chained, verifiable
               Anomaly detection: 5 behavioral rules firing async
               Webhook: push events on trust score changes
```

### Why Existing Solutions Don't Solve It

| Solution | Why It Fails Here |
|----------|------------------|
| **OAuth 2.0 / JWT** | Solves human authentication. No behavioral scoring, no agent-specific scopes, no audit chain, no multi-session trust. Agents rotating tokens every 15 minutes look identical whether they're trusted or compromised. |
| **Auth0 for AI Agents** (GA Nov 2025) | Tied to Okta's enterprise motion. Vendor-locked. Requires Auth0 tenant. No behavioral attestation layer. No neutral positioning — enterprises building on non-Okta stacks won't use it. |
| **Stripe ACP** | Solves the payment leg. Explicitly leaves identity to implementers. Their spec says: "identity verification is out of scope." We are that identity verification. |
| **Entro / Prefactor** | DevSecOps tooling for secret scanning and machine identity rotation. Enterprise-only, not developer-first. No behavioral scoring, no agent-facing SDK, not a neutral verifier. |
| **Cloudflare Zero Trust** | Network-layer access control. Not agent-aware, not behavioral, not developer-facing as an SDK, requires Cloudflare network. |

**The gap is real.** NIST validated it in February 2026 with a concept paper specifically titled "Accelerating the Adoption of Software and AI Agent Identity and Authorization." Public comments closed April 2026. Amazon sued Perplexity in November 2025 over agent identity violations. This is not a theoretical problem.

---

## SECTION 2: WHY THE WEDGE HOLDS

### Wedge 1 — Protocol-Level Insertion (`@okoro/mcp-bridge`)

MCP (Model Context Protocol) is the standard tool-call protocol for LLMs in 2026. Claude, GPT-4o, Gemini, and every major agent framework routes tool calls through MCP.

Our `wrap()` call:
```typescript
import { wrap } from '@okoro/mcp-bridge';
const protectedServer = wrap(myMcpServer, { okoro, actionPrefix: 'mcp.myserver.' });
```

This is 3 lines. That's it. The MCP server developer does nothing else.

**Why this is defensible:**

The insertion point is the lowest possible level before execution. You cannot go lower without modifying the LLM itself. Any competitor that wants to intercept tool calls must also wrap the MCP transport — which means they need a developer to install their package. The developer who installs ours never installs theirs.

**The bilateral network effect it creates:**
- MCP server developers install `@okoro/mcp-bridge` → they become OKORO relying parties
- Their users' agents must carry OKORO tokens to call their tools → users become OKORO clients
- Each integration creates two new OKORO touchpoints with no additional sales effort

**Adoption curve math:** If 1,000 MCP servers install our bridge over 18 months, and each server has 100 agent users, that's 100,000 potential OKORO users from the relying-party side alone — agents that need OKORO tokens to access tools they already use.

### Wedge 2 — BATE Data Moat (Behavioral History)

An agent's BATE trust score is built from behavioral signals accumulated over time:

```
CLEAN_TRANSACTION, RELYING_PARTY_FRAUD_REPORT, VELOCITY_ANOMALY,
GEOGRAPHIC_INCONSISTENCY, SPEND_ANOMALY, FAILED_VERIFY_SPIKE,
DELEGATION_DEPTH_EXCEEDED, ...
```

A 6-month-old PLATINUM-band agent (score 800+) has demonstrated:
- Hundreds or thousands of clean transactions
- No geographic inconsistencies
- Consistent spend patterns
- No fraud reports from relying parties

**You cannot port this history.** If a competing trust system launches, an agent migrating to it starts at zero. The BATE score is a switching cost that compounds every day the agent transacts.

**Why this matters commercially:** Relying parties that require `minTrustScore: 700` are creating an implicit distribution requirement. Every developer who wants their agent to access those relying parties must use OKORO — not because we require it, but because the relying party does.

### Wedge 3 — Standards Timing

The NIST AI Agent Identity Initiative creates a compliance clock. Timeline:
- Feb 2026: NIST concept paper published
- Apr 2026: Public comments closed
- ~Q4 2027: Standards draft for review
- ~Q2 2028: Final NIST guidance published
- ~Q4 2028: Enterprise compliance mandates start citing NIST guidance

Companies that implement OKORO before Q4 2027 can claim "NIST-aligned agent identity infrastructure" in procurement responses, investor due diligence, and customer security questionnaires. This is not a marketing claim — it's a checkbox in the enterprise sales motion.

**Why first-mover matters here:** Security standards create sticky vendor relationships. The company that passes SOC2 with OKORO in their stack does not rip it out when the standards finalize — they cite their existing implementation as compliant. We need to be the reference implementation before the standards lock in.

### Wedge 4 — ACP as a Sales Channel (Not Competition)

Stripe ACP is a tailwind, not a headwind. Here is the exact co-sell motion:

```
ACP Merchant (e.g. airline booking API accepting agent purchases)
    ↓
Currently: accepts any ACP payment from any agent
    ↓
Problem: they're getting fraudulent agent transactions
    ↓
OKORO pitch: "Add okoro.verify(token) before your ACP handler. 
              FLAGGED-band agents get rejected. 
              VERIFIED agents get approved. 
              Every decision is auditable."
    ↓
The merchant now requires OKORO tokens from all agents
    ↓
Agents that want to shop at this merchant need OKORO
```

Every ACP-integrated merchant is a warm OKORO relying-party lead. Stripe launched ACP at Stripe Sessions — every developer at that conference is now in our ICP.

---

## SECTION 3: THE MOATS IN DETAIL

### Moat 1 — Cryptographic Infrastructure (Hard to Replicate Fast)

OKORO uses Ed25519 everywhere:
- Agent keypairs: Ed25519
- JWT signatures: EdDSA (Ed25519)
- Audit chain signatures: Ed25519 via `@noble/ed25519`
- Replay prevention: JWT `jti` → Redis SETNX

The audit chain is structurally sound:
```
Event N:
  sig(N) = Ed25519( prevSig(N-1) || RFC8785_canonical(event) )
```

This is tamper-evident by construction. Changing any past event invalidates every subsequent signature. Independent verification requires only the public key (served at `/.well-known/audit-signing-key`) — no OKORO API call needed.

A competitor could build this, but they need months of cryptographic engineering, external security review, and production hardening. We have it running today, with KMS rotation support for AWS, GCP, and Vault.

### Moat 2 — Billing Infrastructure That Actually Works

Stripe is fully wired as of this session:
- `checkout.session.completed` → plan tier update → quota cache invalidation
- `customer.subscription.updated/deleted` → plan changes propagated immediately
- Circuit breaker on all Stripe API calls (5 failures → OPEN, 30s reset)
- Redis SETNX idempotency on every webhook event (7-day window)
- Idempotency rollback on handler throw (Stripe retries work correctly)
- `GET /v1/billing/plan` — real-time quota snapshot without Stripe round-trip

This is not a payment form wired to a webhook. This is production-grade billing infrastructure with proper error handling, idempotency, and observability. Competitors starting from scratch today are 4–6 weeks behind on billing alone.

### Moat 3 — Observability and Audit Trail

Every verify call produces:
1. An `AuditEvent` row with the signed hash-chain entry
2. A `verifyTotal` Prometheus counter increment with decision + denial reason
3. A `verifyLatency` histogram observation
4. A BATE signal (on approval) triggering async trust score update
5. A webhook event (if band crosses a threshold)

For enterprise procurement, the question "how do I prove your AI agent was authorized to do what it did?" has a specific answer: the audit chain. The response is:
1. The agent signed the request with their private key
2. OKORO verified the signature, the policy, and the spend limit
3. The verification result is in AuditEvent row `aev_xxxxx`
4. The signature on that row chains to `/.well-known/audit-signing-key`
5. Any party can independently verify the chain without calling OKORO

This is the infrastructure answer to enterprise legal's "can you prove it?" question. No competitor has this today.

### Moat 4 — Developer Experience that Compounds

The 10-minute verify path:
```
Minute 0:  Sign up (email only)
Minute 1:  Dashboard → "Register your first agent" (agentId returned)
Minute 3:  npm install @okoro/sdk
Minute 5:  agent.sign(payload) → token
Minute 7:  POST /v1/verify → { valid: true, trustScore: 500 }
Minute 10: Working in production
```

Every developer who hits the AHA moment at minute 7 becomes:
- A paying user when they hit 1,000 verifies
- An advocate when they blog about it
- A distribution channel when they wrap their MCP server

The Twilio analogy is exact: when a developer gets their first SMS working in 5 minutes, they don't evaluate alternatives. The same psychology applies here.

---

## SECTION 4: THE COMPETITIVE CLOCK

How long would a well-funded competitor take to replicate the Phase 1 OKORO stack?

| Component | Replication Time | Why |
|-----------|-----------------|-----|
| Ed25519 agent keypairs + JWT | 2 weeks | Standard crypto, well-documented |
| `/v1/verify` endpoint | 4 weeks | Logic is intricate (9-step denial precedence, spend guard, replay cache) |
| Audit hash chain | 3 weeks | GDPR-survivable design requires careful schema work |
| `/.well-known/audit-signing-key` | 1 week | JWKS format + KMS integration |
| BATE scoring (pure) | 3 weeks | Algorithm design + signal taxonomy |
| BATE anomaly detector (5 rules) | 2 weeks | Domain knowledge required |
| BATE recompute worker (BullMQ) | 2 weeks | Circular DI avoidance, idempotency |
| Stripe billing (full) | 3 weeks | Webhook idempotency, circuit breaker |
| MCP bridge | 2 weeks | MCP protocol expertise required |
| TypeScript SDK | 2 weeks | Client-side Ed25519 + browser compat |
| Python SDK | 3 weeks | |
| Multi-tenant isolation | Ongoing | Architectural discipline, not a feature |
| Test coverage (50 spec files) | Ongoing | |

**Conservative total: 6 months to production-grade parity, starting today.**

And in 6 months, we have:
- 6 months more BATE signal data (no competitor can manufacture behavioral history)
- 6 months more relying party integrations (bilateral network effects compounding)
- 6 months closer to NIST standards finalization (first-mover compliance claims)
- First paying customers who won't switch (audit trail + BATE score lock-in)

---

## SECTION 5: THE SALES MOTION MAP

### How a PLG Deal Closes (No Sales Touch)

```
Day 1:  Developer hits "agent got blocked" problem
        → searches: "AI agent identity verification"
        → finds OKORO docs or community post
        
Day 1:  Signs up (60 seconds, no credit card)
        → registers agent (2 minutes)
        → 10-minute verify completes
        → AHA moment: { valid: true, trustScore: 500 }
        
Day 7:  Developer integrates into production
        → 100-500 verifies/month (growing)
        
Day 21: 850/1,000 verifies used
        → OKORO trigger: "You're at 85% of free tier"
        → Developer knows this is real usage, not evaluation
        
Day 28: PLAN_LIMIT_EXCEEDED denial starts appearing
        → Agent breaks. Urgency is now HIGH.
        → POST /v1/billing/checkout → $49/month → 50,000 verifies
        
Day 29: $49 MRR. Zero sales humans involved.
```

### How a Sales-Assisted Deal Closes (1-2 touches)

```
Week 1:  Team lead sees junior dev using OKORO
         → "this is how we should do all agent auth"
         
Week 2:  Checks Growth tier ($299/month)
         → BATE score visibility for team
         → Webhook integrations for their Datadog setup
         → 500K verifies/month covers entire team
         
Week 2:  Email from Erwin: "I see [Company] has 4 devs on OKORO —
          here's what the team plan looks like"
         
Week 3:  15-minute call → demo of team dashboard
         → Signs up for Growth: $299/month

Erwin's email was the only human touch.
```

### How an Enterprise Deal Starts (3-6 month cycle)

```
Month 1: CISO receives board question: "how do we prove our AI agents
          are authorized to take the actions they're taking?"
         → Legal team asks: "do we have an audit trail?"
         → Answer is no.
         
Month 2: Security team evaluates 3 options:
          - Build in-house (estimated: 6 months, $300K)
          - Auth0 for AI Agents (Okta tie-in, enterprise pricing)
          - OKORO (neutral, developer-first, already in use by their team)
         
Month 3: Technical evaluation:
          - Can verify the audit chain independently? YES (wellknown endpoint)
          - Ed25519 (NIST-approved)? YES
          - GDPR-compliant? YES (erasure design in schema)
          - Self-hostable? YES (Docker Compose)
          - On-prem BATE option? ROADMAP (Phase 3)
         
Month 4: Legal review:
          - DPA available? (Need Phase 2 — legal document, not code)
          - SOC2 Type I? (Need Phase 3)
         
Month 5: Proof of concept in staging
          → Pilot: $1,500/month enterprise trial
          
Month 6: Contract: $18,000/year
```

---

## SECTION 6: THE NUMBERS THAT MATTER

### Path to $500 MRR (Phase 1 Gate — Engineering Can Close This)

```
Scenario A: 11 DEVELOPER conversions × $49 = $539 MRR ✅
Scenario B: 2 GROWTH conversions × $299 = $598 MRR ✅
Scenario C: 1 GROWTH + 5 DEVELOPER = $299 + $245 = $544 MRR ✅

Required: First 10-11 paying users.
Engineering's job: make the product so good they upgrade.
Sales' job (Erwin): find the first 11 developers.
```

### Path to $5K MRR (Phase 2 Gate — Needs Python SDK + MCP Bridge)

```
100 DEVELOPER × $49 = $4,900 MRR (almost there)
60 DEVELOPER + 5 GROWTH = $2,940 + $1,495 = $4,435 MRR
50 DEVELOPER + 6 GROWTH + 1 ENTERPRISE = $2,450 + $1,794 + $1,500 = $5,744 MRR ✅

Unlock condition: Python SDK ships → LangChain/CrewAI/AutoGen developers
Unlock condition: MCP bridge ships → every MCP server is a distribution channel
```

### Path to $50K MRR (Phase 3 Gate — Edge + Enterprise)

```
1,000 DEVELOPER × $49 = $49,000 MRR (almost there)
Or:
600 DEVELOPER + 50 GROWTH + 3 ENTERPRISE
= $29,400 + $14,950 + $6,000 = $50,350 MRR ✅

Unlock condition: CF Workers edge (global <50ms p99) → enterprise SLA
Unlock condition: SOC2 Type I → enterprise procurement checkbox
```

---

## APPENDIX — THE ACP INTEGRATION SPEC (for the pitch meeting)

When talking to a merchant who uses Stripe ACP:

**Current state:**
```javascript
// Their ACP handler today
app.post('/payment', async (req) => {
  const { acpToken, amount, currency } = req.body;
  await stripe.payments.confirm(acpToken, { amount, currency });
  return { success: true };
});
```

**With OKORO (add 4 lines):**
```javascript
import { OkoroClient } from '@okoro/sdk';
const okoro = new OkoroClient({ apiKey: process.env.OKORO_VERIFY_KEY });

app.post('/payment', async (req) => {
  const { acpToken, okoroToken, amount, currency } = req.body;
  
  // OKORO layer — 4 lines
  const identity = await okoro.verify(okoroToken, {
    action: 'commerce.purchase',
    amount,
    currency,
    minTrustScore: 600  // VERIFIED band or above
  });
  if (!identity.valid) return res.status(403).json({ error: identity.denialReason });
  
  // Original ACP handler unchanged
  await stripe.payments.confirm(acpToken, { amount, currency });
  return { success: true };
});
```

**What the merchant gets:**
- Fraudulent agents (FLAGGED band) blocked before the payment processes
- Every rejected payment has an `auditEventId` for dispute records
- Every approved payment has an agent identity attached — audit-proof
- Trust scores improve over time → trusted agents get lower friction

**What it costs the merchant:** 4 lines of code and ~$0.002/verified transaction.

---

*This document is the wedge argument. Everything in it is backed by code in the repo. When the code changes, update this document.*

*Last updated: 2026-05-05 | Session: cowork-master-state-analysis*
