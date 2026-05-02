# AEGIS — Agent Gateway & Identity Stack
## KLYTICS Internal Master Document v1.0
### Classification: INTERNAL — CONFIDENTIAL

---

## EXECUTIVE SUMMARY

**AEGIS** is a neutral, developer-first middleware layer that sits between AI agents and the services they interact with — providing verified identity, scoped authorization, behavioral attestation, and audit rails for every agent-initiated action.

This is not a "passport." It is not a single authority. It is the **verification and policy enforcement choke point** that no protocol owns but every agent transaction must pass through.

**Market signal:** OpenAI and Stripe launched the Agentic Commerce Protocol (ACP) in September 2025 — a payment rail for agent transactions. ACP solves the *payment* leg. It does not solve:
- Who is the agent?
- Is it actually authorized by a real human?
- Has its behavior been trustworthy across sessions?
- Can a relying party independently verify the claim in <100ms?

AEGIS fills that gap. ACP-compatible by design, AEGIS plugs into the emerging agentic commerce stack as the **trust and verification layer** that Stripe explicitly left to implementers.

---

## SECTION 1 — MARKET INTELLIGENCE

### 1.1 What Already Exists (Do Not Re-Build)

| Layer | Existing Solution | Our Angle |
|---|---|---|
| Agent payments | Stripe ACP + Shared Payment Tokens | Integrate, not compete |
| Enterprise IAM | Auth0, Okta, SailPoint | Too heavy, human-centric |
| Machine identity | Entro Security, Prefactor | Enterprise/DevSecOps angle |
| Agent auth SDK | Auth0 for AI Agents (GA Nov 2025) | Dev-facing, not neutral verifier |
| Commerce protocol | ACP (agenticcommerce.dev) | Open standard; we plug in |
| Attestation | None at scale | **Our whitespace** |

### 1.2 The Whitespace

No player owns the **neutral cross-platform agent trust score + attestation layer.** Every existing solution is:
- Tied to a platform (Auth0 → Okta, Prefactor → MCP-only)
- Commerce-specific (ACP → shopping flows)
- Enterprise-only (SailPoint, Entro → large org tooling)

AEGIS is **platform-agnostic, developer-facing, and protocol-compatible.** It works whether the agent runs on Claude, GPT-4o, Gemini, or a custom LLM.

### 1.3 TAM Snapshot

- By 2030: 4–40 AI agents per person on earth (Crone Consulting)
- AI-driven commerce projected at $1.7T by 2030 (Edgar Dunn & Co.)
- Every verified agent call = potential billable event
- At $0.002/verification × 10B daily verifications by 2028 = $20M/day run rate potential

---

## SECTION 2 — PRODUCT ARCHITECTURE

### 2.1 The AEGIS Stack (4 Layers)

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 4 — AUDIT & COMPLIANCE RAIL                       │
│  Immutable logs, FRTB-style audit chain, SOC2 artifacts  │
├─────────────────────────────────────────────────────────┤
│  LAYER 3 — BEHAVIORAL ATTESTATION ENGINE (BATE)         │
│  Trust score, anomaly signals, cross-session history     │
├─────────────────────────────────────────────────────────┤
│  LAYER 2 — POLICY ENGINE                                 │
│  Scoped permissions, spend limits, time bounds, revoke   │
├─────────────────────────────────────────────────────────┤
│  LAYER 1 — AGENT IDENTITY CORE                          │
│  Cryptographic keypair, DID-compatible, human binding    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Layer 1 — Agent Identity Core

**What it is:** A cryptographic identity object tied to a human or organization principal.

**Data model:**
```typescript
interface AgentIdentity {
  agentId: string;           // AEGIS-issued ULID
  publicKey: string;         // Ed25519 public key (DID-compatible)
  principalId: string;       // Human/org owner
  principalVerification: {
    method: "email" | "oauth" | "wallet";
    verifiedAt: Date;
    provider: string;
  };
  agentMetadata: {
    runtime: string;          // "openai" | "anthropic" | "custom"
    model: string;
    version: string;
    registeredAt: Date;
  };
  status: "active" | "suspended" | "revoked";
  attestationScore: number;  // 0-1000, updated by BATE
}
```

**How it works:**
1. Developer registers agent via AEGIS SDK or API
2. AEGIS issues a keypair — private key stored client-side, public key registered with AEGIS
3. Agent signs every outbound request with its private key
4. Relying party (Delta, Amazon, bank) calls AEGIS `/verify` endpoint to confirm identity + current trust score in <80ms

**Key design choice:** AEGIS never holds the private key. We are a **verifier and scorer**, not a key custodian. This eliminates our liability if a developer's key is compromised.

### 2.3 Layer 2 — Policy Engine

**What it is:** Fine-grained, programmable permission scopes bound to an agent identity.

**Policy object:**
```typescript
interface AgentPolicy {
  policyId: string;
  agentId: string;
  scopes: PolicyScope[];
  createdBy: string;        // Principal ID
  expiresAt: Date;
  revokable: true;
}

interface PolicyScope {
  category: string;          // "commerce" | "data-read" | "communication"
  spendLimit?: {
    currency: "USD" | "EUR";
    maxPerTransaction: number;
    maxPerDay: number;
    maxPerMonth: number;
  };
  merchantCategories?: string[];  // MCC codes for payment scopes
  allowedDomains?: string[];
  dataScopes?: string[];          // "read:email" | "write:calendar"
  validFrom: Date;
  validUntil: Date;
}
```

**Policy verification flow:**
```
Agent Request → AEGIS /verify
  → Decode signed token
  → Look up active policy
  → Check scope allows this action
  → Check spend limit not exceeded
  → Return: { valid: bool, trustScore: number, scopesGranted: string[] }
```

### 2.4 Layer 3 — Behavioral Attestation Engine (BATE)

This is the highest-value, most defensible component. No competitor has built this.

**What it is:** A real-time trust scoring engine that tracks agent behavior across sessions and surfaces anomaly signals to relying parties.

**Signal inputs:**
- Transaction velocity (requests/minute)
- Geographic consistency of request origins
- Merchant/domain diversity vs. expected behavior
- Spend pattern vs. policy baseline
- Failed verification attempts
- Session duration and action sequence patterns
- Cross-agent correlation (same principal, multiple agents)

**BATE score model:**
```
Trust Score (0-1000) = f(
  BaselineScore,          // Starts at 500 on registration
  TransactionHistory,     // +/- based on clean/flagged txns
  PrincipalVerification,  // +100 for verified email, +200 for KYC
  AnomalyPenalties,       // -50 to -500 per anomaly event
  AgeCohort,              // Time-weighted decay for new agents
  CrossPlatformSignals    // Future: shared signals with partners
)
```

**Trust bands:**
- 750–1000: PLATINUM — pre-approved at most relying parties
- 500–749: VERIFIED — standard verification required
- 250–499: WATCH — enhanced verification, lower spend limits
- 0–249: FLAGGED — most relying parties will reject

**Key insight:** This is the credit score layer for agents. It compounds in value over time. An agent with a 900-point AEGIS score has a moat against competitors who would have to rebuild that history.

### 2.5 Layer 4 — Audit & Compliance Rail

Every action logged:
```typescript
interface AuditEvent {
  eventId: string;
  agentId: string;
  principalId: string;
  timestamp: Date;
  action: string;
  relying_party: string;
  policySnapshot: PolicyScope;    // Exact policy at time of action
  decision: "approved" | "denied" | "flagged";
  decisionReason: string;
  signature: string;               // AEGIS signs the audit record
}
```

Audit log is append-only. Exportable for SOC2, GDPR, FINRA, and COSSEC compliance contexts. This is particularly relevant for CERNIQ's cooperativa clients who will use agent-based financial operations.

---

## SECTION 3 — TECHNICAL BUILD PLAN

### 3.1 Technology Choices

| Component | Technology | Rationale |
|---|---|---|
| Core API | NestJS (TypeScript) | Consistent with CERNIQ/SENTINEL stack |
| Database | PostgreSQL + Prisma | Same as existing KLYTICS stack |
| Cache / Real-time scores | Redis | Sub-10ms trust score lookups |
| Cryptography | libsodium (Ed25519) | Industry standard, battle-tested |
| Queue (BATE signals) | BullMQ | Already in SENTINEL pattern |
| Hosting | Railway | Same as CERNIQ/SENTINEL |
| CDN/Edge verification | Cloudflare Workers | Sub-50ms global verification |
| Monitoring | Datadog (or Railway native) | Production observability |

### 3.2 API Surface (v1)

#### Public Endpoints (Relying Parties)

```
POST /v1/verify
  Body: { token: string, action: string, amount?: number }
  Returns: { valid: bool, agentId: string, trustScore: number, scopesGranted: string[], ttl: number }
  SLA: <80ms p99

GET /v1/agent/:agentId/status
  Returns: { status: string, trustScore: number, lastSeen: string }

POST /v1/agent/:agentId/report
  Body: { eventType: "fraud" | "anomaly" | "policy_violation", evidence: object }
  Purpose: Relying parties report bad behavior back to BATE
```

#### Developer Endpoints (Agent Builders)

```
POST /v1/agents/register
  Body: { publicKey: string, runtime: string, model: string, principalId: string }
  Returns: { agentId: string, verificationToken: string }

POST /v1/agents/:agentId/policies
  Body: PolicyScope[]
  Returns: { policyId: string, signedToken: string }

DELETE /v1/agents/:agentId/policies/:policyId
  Purpose: Instant revocation

GET /v1/agents/:agentId/audit
  Query: { from: Date, to: Date, limit: number }
  Returns: AuditEvent[]
```

#### Webhook Events (Developer Subscriptions)

```
aegis.agent.trust_score_changed
aegis.agent.anomaly_detected
aegis.agent.policy_expired
aegis.agent.flagged_by_relying_party
```

### 3.3 SDK Design

```typescript
// npm install @aegis/sdk

import { Aegis } from '@aegis/sdk';

const aegis = new Aegis({ apiKey: process.env.AEGIS_API_KEY });

// Agent builder: sign outbound request
const token = await aegis.agent.sign({
  action: 'commerce.purchase',
  amount: 450,
  merchantId: 'delta-airlines'
});

// Relying party: verify inbound agent
const result = await aegis.verify(incomingToken);
if (result.valid && result.trustScore > 500) {
  processTransaction();
}

// Dashboard: revoke agent
await aegis.agent.revoke(agentId);
```

### 3.4 ACP Integration

OpenAI/Stripe ACP uses Shared Payment Tokens (SPTs). AEGIS wraps the agent identity layer *above* SPT:

```
ACP Flow with AEGIS:

1. User grants agent permission
2. Agent gets SPT from Stripe
3. Agent calls Delta API with:
   { spt: "stripe_spt_xxx", aegisToken: "aegis_signed_xxx" }
4. Delta calls:
   - Stripe: "Is this SPT valid for $450?"
   - AEGIS:  "Is this agent trusted at score >500 with commerce scope?"
5. Both confirm → transaction approved
```

AEGIS is **additive to ACP**, not competitive with it. This is the positioning wedge.

---

## SECTION 4 — GO-TO-MARKET STRATEGY

### 4.1 Beachhead Market

**Developer tooling / indie agent builders** — NOT enterprise.

Why: Enterprises already have IAM teams and budget. Indie developers have no solution. They're the ones building the next wave of consumer agents. Get them while they're forming habits.

**ICP (Ideal Customer Profile):**
- Solo or 2-5 person team building an AI agent product
- Agent performs real-world actions (shopping, scheduling, data retrieval)
- Stack: Python/TypeScript + any LLM
- Monthly agent call volume: 10K–1M calls
- Pain: "I need something to tell merchants my agent is legit"

### 4.2 Distribution Channels

**Phase 1 (0→1):**
- GitHub: Open-source the SDK, closed-source the BATE engine
- Hacker News, dev.to, r/LLMDevs
- LangChain, CrewAI, AutoGen community forums
- Discord: AI builders communities

**Phase 2 (1→10):**
- Partnerships with agent orchestration frameworks (LangChain, AutoGen)
- Co-marketing with ACP-enabled merchants who want agent verification
- Direct outreach to developer tool VCs (a16z, Sequoia scout programs)

**Phase 3 (10→100):**
- Enterprise sales to relying parties (e-commerce, financial services)
- COSSEC and PR financial institution angle via CERNIQ pipeline
- Regulatory-driven adoption (AI act compliance, SOC2 requirements)

### 4.3 Pricing Model

**Free tier (conversion engine):**
- 10,000 verifications/month
- 2 registered agents
- No BATE score (basic trust only)
- 30-day audit log retention

**Developer ($29/month):**
- 500,000 verifications/month
- 10 agents
- BATE score + anomaly alerts
- 90-day audit log
- Webhook events

**Growth ($149/month):**
- 5M verifications/month
- Unlimited agents
- Full BATE with custom scoring rules
- 1-year audit log
- Priority SLA (<50ms p99)
- SOC2 report access

**Enterprise (custom):**
- Unlimited
- On-premise BATE option
- Custom trust bands
- Dedicated support
- FINRA/COSSEC compliance packages

**Revenue model also includes:**
- Metered overages: $0.0002/verification above plan
- Verification API pass-through for relying parties: $0.001/call
- Trust score data licensing (anonymized, aggregate): future stream

### 4.4 Revenue Gate Position in KLYTICS Stack

Per Revenue Gate doctrine:
- AEGIS development begins: **AFTER CERNIQ Gate 1 ($2,500 MRR)**
- AEGIS is exempt from building moratorium during CERNIQ pilot phase
- Exception: Architecture documentation and spec can be completed now (zero dev cost)
- AEGIS prototype (proof of concept, no customers) can begin during CERNIQ pilot active phase
- First AEGIS revenue target before any new product: $500 MRR

**AEGIS entry into KLYTICS holding company:**
- Separate LLC entity (not under CERNIQ or FORGE)
- Operating as: AEGIS Labs LLC (or AEGIS Security Inc.)
- Housed under KLYTICS parent holdco

---

## SECTION 5 — COMPETITIVE MOAT ANALYSIS

### 5.1 Why We Win (If We Execute)

| Moat | Description | Time to Build |
|---|---|---|
| Network effects | Trust score improves as more relying parties report signals | 18–36 months |
| Data flywheel | More agents → richer BATE training data → better anomaly detection | 12–24 months |
| Protocol lock-in | If ACP cites AEGIS as recommended verifier, switching cost is high | 6–18 months |
| First-mover neutrality | We are not Google, Stripe, or OpenAI — we are the Switzerland of agent identity | Immediate |

### 5.2 Threats (Honest Assessment)

| Threat | Probability | Mitigation |
|---|---|---|
| Stripe extends ACP to include identity | HIGH | Build before they do; position as neutral to Stripe's commerce angle |
| Auth0/Okta builds agent BATE | MEDIUM | Enterprise only; we own developer segment |
| OpenAI/Anthropic builds identity | MEDIUM | They don't want to be trust gatekeepers; political liability |
| Google/Apple | HIGH (long term) | Become the standard they have to support |

### 5.3 Key Insight: The Neutrality Advantage

Stripe is Stripe. Auth0 is Okta. Both carry platform baggage. A Delta Air Lines or Chase Bank will not route all agent verification through OpenAI's infrastructure — their compliance teams won't allow it.

AEGIS is infrastructure-neutral, model-neutral, and commerce-neutral. This is the moat that big tech cannot buy.

---

## SECTION 6 — BOTTLENECKS & FRICTION POINTS

### 6.1 Technical Bottlenecks

**B1 — Verification latency**
The p99 target is <80ms globally. This requires Cloudflare Workers edge deployment for the hot verification path. Trust scores must be pre-computed and cached in Redis — not computed on-demand. This is the hardest infrastructure problem in Phase 1.

**B2 — Key management UX**
Developers are terrible at key management. The AEGIS SDK must make signing trivially easy. If signing an agent request adds more than 2 lines of code, adoption will suffer. Consider: magic link-style onboarding, auto-rotation policies, SDK-managed key storage.

**B3 — Cold start trust problem**
A new agent has a score of 500 — "neutral." Relying parties may still reject neutral agents for high-value actions. Need a "trust accelerator" path: principal KYC verification, pre-approved agent certification for specific use cases, referral from a high-trust agent (similar to credit card authorized user logic).

**B4 — Multi-agent chains**
When Agent A delegates to Agent B delegates to Agent C, who is responsible? Need a delegation chain model in the identity spec. This is an unsolved technical problem in the entire industry — first mover who spec's it right wins.

### 6.2 Go-to-Market Friction Points

**F1 — Chicken-and-egg**
Relying parties want to verify agents. Developers want their agents trusted. Neither side acts first. Solution: launch with relying party-side as open and free (no cost to check an AEGIS token), create developer demand through ecosystem positioning.

**F2 — Education overhead**
Developers building agents today don't know they need agent identity. They'll learn when their agent gets blocked by a merchant's bot detection. We need to be in that search result ("how to make my AI agent trusted by websites") before the problem is widespread.

**F3 — Standard fragmentation**
ACP may not be the only protocol. Google, Visa, and others are building their own. AEGIS must be protocol-agnostic at the transport layer — not coupled to any single commerce or agent protocol.

---

## SECTION 7 — DEVELOPMENT PHASES

### Phase 0 — Spec & Foundation (Now, no devs needed)
**Duration:** 2–4 weeks
**Owner:** Erwin
**Deliverables:**
- [ ] This document (AEGIS_MASTER.md)
- [ ] OpenAPI spec for all v1 endpoints
- [ ] Agent identity data model finalized
- [ ] Policy schema v1 finalized
- [ ] BATE scoring algorithm documented
- [ ] SDK API surface designed (TypeScript types)
- [ ] Legal entity research (AEGIS Labs LLC feasibility)

### Phase 1 — MVP (Post CERNIQ Gate 1)
**Duration:** 6–8 weeks
**Stack:** NestJS, PostgreSQL, Redis, Railway
**Team needed:** 1 backend dev (can be Erwin + 1 contractor)
**Deliverables:**
- [ ] Agent registration API
- [ ] Ed25519 keypair issuance
- [ ] Policy engine (create/revoke/check)
- [ ] Basic verification endpoint (<200ms, no edge)
- [ ] Audit log v1
- [ ] TypeScript SDK (npm package)
- [ ] Developer dashboard (basic React)
- [ ] Free + Developer tier billing (Stripe)

**Exit criteria:** 10 agents registered, 1 relying party integration, 1 paying developer customer

### Phase 2 — BATE Engine (Post $500 MRR)
**Duration:** 8–10 weeks
**Team needed:** +1 ML/data engineer (part-time)
**Deliverables:**
- [ ] BATE signal ingestion pipeline (BullMQ)
- [ ] Trust score computation engine
- [ ] Anomaly detection (rule-based v1, ML v2)
- [ ] Relying party reporting endpoint
- [ ] Webhook delivery system
- [ ] Trust score dashboard for developers
- [ ] Growth tier billing

**Exit criteria:** BATE live, trust score updating in real-time, 50+ agents tracked

### Phase 3 — Edge & Enterprise (Post $5,000 MRR)
**Duration:** 10–12 weeks
**Team needed:** +1 infra/DevSecOps
**Deliverables:**
- [ ] Cloudflare Workers edge deployment (global <80ms)
- [ ] Delegation chain support (multi-agent)
- [ ] ACP integration connector
- [ ] SOC2 Type I preparation
- [ ] Enterprise tier + custom onboarding
- [ ] COSSEC compliance module (feeds CERNIQ pipeline)

---

## SECTION 8 — INTEGRATION INTO KLYTICS STACK

### 8.1 Synergies

**CERNIQ:** Cooperativa AI agents (auto-generating risk reports, executing FRTB calculations, querying loan portfolios) need agent identity. AEGIS becomes the identity layer for CERNIQ's future agentic features. CERNIQ pilots AEGIS as first enterprise customer.

**FORGE:** Manufacturing OS agents that query inventory, trigger purchase orders, interface with suppliers — all need verified identity. AEGIS is FORGE's security substrate.

**GHOST SWARM:** Ethical hacking agents need controlled identities to simulate attacks without being flagged as real threats. AEGIS could provide "red team" agent credentials — a unique, defensible use case.

**BLR-OS:** 20-agent AI label OS — each agent is an AEGIS identity. This gives AEGIS real-world internal testing before external launch.

### 8.2 KLYTICS Entity Structure

```
KLYTICS LLC (holding)
├── CERNIQ (ALM/risk SaaS)
├── FORGE (manufacturing OS)
├── AEGIS Labs LLC (agent identity)
├── BLR / Black Label Records
└── SAKRA (streetwear)
```

AEGIS operates as a separate legal entity for liability isolation (cryptographic security = potential target), independent fundraising path, and eventual acqui-hire/acquisition positioning.

---

## SECTION 9 — VALIDATION FRAMEWORK

### 9.1 Pre-Build Validation (Phase 0)

**Experiment 1 — Pain validation**
Post in 3 AI developer communities:
"Building an AI agent that shops/acts on behalf of users. How do you handle the site blocking your agent as a bot? How do you prove your agent is acting on behalf of a real user?"
Target: 50 responses, measure pain language

**Experiment 2 — Willingness to pay**
Build a Typeform: "Would you pay $29/month for a service that gives your AI agent a verified identity that websites can trust?"
Target: 100 completions, >20% Yes

**Experiment 3 — Relying party demand**
Interview 5 e-commerce or financial services companies:
"If an AI agent shows up to transact with you, what would make you trust it?"
Target: 3/5 naming "verified identity + trust score" unprompted

### 9.2 Post-MVP Validation

**North Star Metric:** Weekly Verified Transactions (WVT) — number of agent actions successfully verified through AEGIS per week

**Leading indicators:**
- Agents registered (week 1 target: 10)
- SDK installs (week 4 target: 100)
- Developer signups (month 1 target: 50)
- Paying customers (month 2 target: 5)
- Trust score verifications/day (month 3 target: 10,000)

---

## SECTION 10 — ACQUISITION NARRATIVE

If AEGIS reaches $500K ARR and 1M monthly verifications, it becomes an acquisition target for:

| Acquirer | Rationale | Likely Multiple |
|---|---|---|
| Okta / Auth0 | Identity layer for agents, extends their IAM suite | 10–15× ARR |
| Stripe | Completes ACP with the identity layer they left to implementers | 12–20× ARR |
| Cloudflare | Zero Trust + agent identity = natural product extension | 8–12× ARR |
| CrowdStrike / Palo Alto | Agent identity as a security product | 10–15× ARR |
| Anthropic / OpenAI | Vertical integration of trust layer | Strategic premium |

At $500K ARR, this is a $5M–$10M exit minimum. At $2M ARR with strong growth, $20M–$40M. At protocol-level adoption, the ceiling is uncapped.

---

## APPENDIX A — KEY REFERENCES

- ACP Spec: https://agenticcommerce.dev
- ACP GitHub: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- Stripe SPT docs: https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce
- Auth0 for AI Agents: https://auth0.com/ai
- OpenID Foundation Agentic Identity Whitepaper: https://openid.net
- Prefactor (MCP auth): https://prefactor.tech

## APPENDIX B — GLOSSARY

- **ACP** — Agentic Commerce Protocol (OpenAI + Stripe open standard)
- **BATE** — Behavioral Attestation Engine (AEGIS proprietary)
- **DID** — Decentralized Identifier (W3C standard, AEGIS-compatible)
- **Ed25519** — Elliptic curve signature scheme used for agent signing
- **NHI** — Non-Human Identity (industry term for machine/agent identities)
- **SPT** — Shared Payment Token (Stripe primitive in ACP)
- **Trust Score** — AEGIS proprietary 0–1000 score computed by BATE

---

*Document version: 1.0 | Author: Erwin Kiess-Alfonso / KLYTICS | Status: DRAFT*
