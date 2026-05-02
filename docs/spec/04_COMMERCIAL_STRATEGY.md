# AEGIS — Commercial Strategy & Buying Journey
## Document 04 — Sales Motion, Buyer Personas, ICP, Revenue Operations
### KLYTICS Internal | Version 1.0 | May 2026

---

## PART I — BUYER UNIVERSE

### The Three Buying Motions

AEGIS operates across three distinct buying motions simultaneously. Confusing them is the #1 GTM mistake for developer tools. Each requires a different trigger, different buyer, different close cycle.

```
MOTION 1: SELF-SERVE PLG          MOTION 2: SALES-ASSISTED          MOTION 3: ENTERPRISE
(Developer → Individual)           (Team Lead → Manager)              (CISO → Procurement)

Trigger: Agent got blocked         Trigger: Team needs consistency    Trigger: Compliance audit
Buyer: The developer               Buyer: Eng Manager or CTO          Buyer: CISO + Legal + Procurement
Price point: $0 → $29/mo          Price point: $149 → $500/mo        Price point: $1,500+ /mo
Close cycle: Minutes               Close cycle: 1–2 weeks             Close cycle: 3–6 months
Touch: Zero human contact          Touch: 1–2 async emails            Touch: Discovery → Demo → Proof
ACV: $348–$1,788                  ACV: $1,788–$6,000                 ACV: $18,000–$120,000
```

**Key principle:** The PLG motion *feeds* the sales-assisted motion. A developer who loves AEGIS brings it to their team. The team expansion triggers the sales-assisted deal. Multiple team deals at one company trigger enterprise procurement. This is the Twilio → AT&T pattern: start with one developer's SMS, end with a corporate contract.

---

## PART II — BUYER PERSONAS (DEEP)

### Persona A — "The Builder" (PLG Motion)

**Who:** Solo developer or early-stage startup engineer building an AI agent product.
**Stack:** Python (LangChain, AutoGen) or TypeScript (Vercel AI SDK). Deploys on Railway, Render, or Vercel.
**Situation:** Their agent is hitting bot detection walls, getting flagged by merchant systems, or a customer asked "how do I know your agent isn't a bot?"
**Budget authority:** Personal credit card or startup card. No approval needed under $50/mo.
**Decision timeline:** Evaluates → signs up → integrates in same session if the docs are good.
**What they need from AEGIS:**
- Work in 3 lines of code
- Clear quickstart (not a 30-page enterprise guide)
- Actually solves the "agent got blocked" problem today
- Free tier that lasts long enough to prove value
**What they hate:**
- Sales calls before they can try the product
- Credit card required to start
- Enterprise-only documentation
- Slow onboarding (any friction > 10 minutes = lost)

**Messaging that works:** "Your agent, verified in 3 lines of code."
**Messaging that doesn't:** "Enterprise-grade AI identity governance platform."

---

### Persona B — "The Tech Lead" (Sales-Assisted Motion)

**Who:** Senior engineer or engineering manager at a 10–100 person startup that's shipping agent features into their product.
**Situation:** Their team has 3–5 developers each implementing agent auth differently. They need consistency, audit logs for customers, and something defensible to show investors.
**Budget authority:** $500–$2,000/month with team budget, no procurement. Maybe a quick Slack check with CTO.
**Decision timeline:** 1–2 weeks. Sees the free tier working, checks AEGIS docs for enterprise features, reads the SOC2 posture page, decides.
**What they need from AEGIS:**
- Multi-agent management (team dashboard, not per-developer silos)
- BATE score visibility (can report to customers: "your agent has a 780 trust score")
- Webhook integration (pipe AEGIS events into their Datadog or PagerDuty)
- Some compliance documentation (for investor due diligence)
**What they hate:**
- "Contact sales" for features they can evaluate themselves
- Hidden pricing
- Poor documentation for advanced features

**Messaging that works:** "One verified identity layer for all your agents, with the audit trail your customers will ask for."
**Sales trigger email subject:** "Your team's AEGIS usage — a few questions"

---

### Persona C — "The CISO" (Enterprise Motion)

**Who:** CISO or VP Security at a 200–5,000 person company (fintech, healthcare, e-commerce platform) deploying AI agents at scale.
**Situation:** Legal team flagged agent identity as a liability gap. Board asked about AI governance. Or (increasingly) their customers are asking for vendor AI security attestations.
**Budget authority:** Signs off on $50K+ contracts. Goes through procurement. Needs legal review of DPA.
**Decision timeline:** 3–6 months minimum. Includes: discovery call, technical deep-dive, security review, legal review, pilot, board approval.
**What they need from AEGIS:**
- SOC2 Type II report (or Type I with roadmap to II)
- Data Processing Agreement (DPA) for GDPR/CCPA
- Penetration test report
- SLA with uptime guarantee (99.9% minimum)
- On-premise BATE option (some won't send signals to third parties)
- Named customer references in their industry
- Regulatory compliance mapping (FINRA, COSSEC, HIPAA, etc.)
**What they hate:**
- Startup risk (will you exist in 2 years?)
- No compliance documentation
- "We'll figure out the DPA"
- Shared-tenant for their agent data

**Messaging that works:** "NIST AI Agent Identity standards alignment, auditable to FINRA and SOC2."
**Sales trigger:** Customer asks "do you have a way to prove your AI agents are who they say they are?"

---

### Persona D — "The Platform Partner" (Network Effect Motion)

**Who:** The developer who builds and maintains an agent orchestration framework (LangChain, AutoGen, CrewAI) OR a platform that serves other developers (Shopify app ecosystem, Twilio marketplace, etc.).
**Situation:** Their platform users are asking for agent identity features. They don't want to build it themselves.
**Budget authority:** Revenue share / integration deal — not a subscription buyer.
**What they need:**
- Native SDK integration that feels like first-party
- Co-marketing opportunity ("Secure your LangChain agents with AEGIS")
- Revenue share or partner tier
- API stability guarantees
**Value to AEGIS:** Each platform partner is a distribution channel for thousands of developers. One LangChain integration = 10,000 potential AEGIS users.

---

## PART III — SALES PLAYS BY MOTION

### Play 1 — The Self-Serve Conversion (PLG Motion)

**Trigger:** Developer signs up, completes the 10-minute verify, goes quiet.
**Timing:** Day 3 after signup if no payment and <10K verifications used.
**Touch:** Automated email (Founder-signed, plain text).

Subject: Your AEGIS setup — quick question

```
Hey [Name],

I saw you registered an agent last week — did the quickstart work for you?

If you hit any friction in the setup, I'd love to know. We're still early and 
everything you run into is a bug we want to fix.

Also: if you're building something interesting with agents, I'm always happy 
to hop on a 15-minute call. Not a sales call — genuinely curious what you're 
building.

— Erwin, AEGIS
```

**Conversion goal:** Reply (any reply) → understand use case → identify expansion potential.
**Not goal:** Close a paid deal on this email.

---

**Trigger:** Developer hits 90% of free tier limit.
**Timing:** When 9,000/10,000 verifications used.
**Touch:** In-app notification + automated email.

Subject: You're at 90% of your free verify limit

```
Hey [Name],

Your agent has used 9,124 of 10,000 free verifications this month. At your 
current pace, you'll hit the limit in ~3 days.

When you hit the cap, your agents will continue to sign requests but relying 
parties will get a "PLAN_LIMIT" response instead of a valid verification.

To keep verifications flowing: [Upgrade to Developer — $29/month →]

You'll get:
→ 500,000 verifications/month
→ Your BATE trust score (currently locked)
→ Anomaly alerts if a relying party flags your agent

If $29/month doesn't work right now, reply and let me know. We sometimes 
extend free tier for builders working on cool stuff.

— Erwin
```

---

### Play 2 — The Team Expansion (Sales-Assisted)

**Trigger:** 3+ team members registered, or Growth tier inquiry.
**Touch:** Personal email from Erwin (not automated).

Subject: [Company] on AEGIS — want to share something

```
Hey [Name],

I noticed [Company] has 4 developers registered on AEGIS this week — looks 
like you're all building agent features in parallel.

A few things that might help as you scale:

1. The team dashboard (Growth tier) lets you manage all agents from one view 
   and set organization-level spend policies.

2. Your agents currently have individual BATE scores. On Growth, we can 
   surface a principal-level score that rolls up across all your agents — 
   useful if you're showing this to customers.

3. If you're planning to show agents to customers or investors, the audit 
   log export (PDF, SOC2-ready) is in Growth too.

Happy to do a 20-minute walkthrough if useful. No sales deck, just screen share.

— Erwin
```

**Expected response rate:** 30–40% (warm, in-product signal).
**Goal:** Upgrade to Growth ($149/mo) or open Enterprise conversation.

---

### Play 3 — The Enterprise Land-and-Expand

**Entry point:** Almost always comes through the PLG channel. A developer in a large org registers, uses AEGIS, mentions it internally. Security team hears about it and either (a) asks to "get something more official" or (b) blocks it and then the developer advocates for an official deployment.

**Discovery call structure (45 minutes):**
- 0–5 min: Context (what are they building, what's the agent stack)
- 5–15 min: Current state ("how are you handling agent identity today?")
- 15–25 min: The gap (where does their current approach break down)
- 25–35 min: AEGIS positioned against gap (not a demo — a conversation)
- 35–40 min: Compliance requirements (what do they need to check before buying)
- 40–45 min: Next steps (technical deep-dive? security review? pilot scope?)

**Key enterprise requirements checklist (collect in discovery):**
- [ ] SOC2 Type II needed? (Current status: Type I roadmap)
- [ ] GDPR/data residency requirements?
- [ ] On-premise BATE required?
- [ ] SLA requirement (99.9%? 99.99%?)
- [ ] Existing IAM integration (Okta, Azure AD)?
- [ ] Regulatory framework (FINRA? HIPAA? COSSEC?)
- [ ] Agent volume (verifications/month estimate)
- [ ] Timeline pressure (what's forcing a decision?)
- [ ] Budget owner and process

**Enterprise pilot structure (4 weeks):**
- Week 1: Technical integration (engineering team)
- Week 2: Security review (CISO/security team)
- Week 3: Compliance documentation review (legal)
- Week 4: Business case + pricing negotiation

**Enterprise pricing construction:**
```
Base platform fee:         $1,500/month
Per 1M verifications:      $500/month
BATE full access:          $300/month
On-premise BATE:           $2,000/month + setup
SOC2 artifact access:      Included
Dedicated support SLA:     $500/month
Compliance module (FINRA): $750/month
COSSEC module:             $500/month

Example: Mid-size fintech, 5M verifications/month, FINRA compliance
= $1,500 + (5 × $500) + $300 + $500 + $750 = $5,550/month = $66,600/year
```

---

## PART IV — THE CERNIQ BRIDGE

This is the highest-leverage enterprise sales path AEGIS has.

**The play:** CERNIQ already has relationships with Puerto Rico cooperativas (COSSEC-regulated). These institutions will deploy AI agents for routine financial operations — FRTB compliance checks, loan portfolio queries, member service automation.

Every one of these agent actions — a cooperativa's AI agent querying NCUA data, generating a risk report, filing a regulatory return — needs exactly what AEGIS provides: identity attestation, audit trail, revocation capability, and behavioral trust scoring.

**The bridge sequence:**
1. CERNIQ reaches pilot stage with cooperativa (Gate 0 active)
2. During pilot, demonstrate the agent-enhanced reporting feature (CERNIQ roadmap item)
3. The cooperativa asks: "How do we know this agent is authorized to access our data?"
4. AEGIS is the answer — positioned as a separate but compatible service
5. CERNIQ pilot customer becomes AEGIS beta enterprise customer
6. COSSEC compliance module built using this customer's requirements
7. That customer becomes the reference for every other cooperativa pitch

**Revenue bridge math:**
- 91 PR cooperativas
- If 15 adopt CERNIQ + AEGIS: $5,550/month × 15 = $83,250 MRR from this segment alone
- This is AEGIS's Puerto Rico-specific enterprise moat that no mainland competitor can replicate

---

## PART V — REVENUE OPERATIONS SETUP

### Metrics That Matter (North Star Cascade)

**Primary:** MRR (Monthly Recurring Revenue)
**Secondary:** Verified Agent Actions (VAA) — total verifications across all agents, all tiers
**Tertiary:** Net Revenue Retention (NRR) — target: >120% (expansion > churn)

**Leading indicators (weekly dashboard):**
- New signups (target: +20%/week in months 1–3)
- Activation rate (signups who complete first verify / total signups) — target: >40%
- Day-7 retention (still active 7 days after signup) — target: >50%
- Free → Paid conversion rate — target: 8–12% of MAU
- Paid → Growth upgrade rate — target: 5% of Developer tier/month
- Enterprise pipeline value — target: 3× current MRR in pipeline by month 6

**Lagging indicators (monthly board view):**
- MRR (absolute + growth rate)
- Churn rate (target: <2% monthly for Developer, <0.5% for Enterprise)
- NRR (target: >120%)
- CAC by channel (PLG target: <$5; Sales-assisted: <$500; Enterprise: <$5,000)
- LTV:CAC ratio (target: >3:1 at 12 months)
- Payback period (target: <6 months for Developer, <12 months for Enterprise)

### CRM Setup (Minimal, Non-Distracting)

Phase 1 CRM is a Notion database, not Salesforce. Salesforce is for companies with sales teams. Before 10 enterprise deals in pipeline, any CRM beyond Notion is premature optimization.

**Notion CRM fields:**
- Company name, domain
- Persona type (Builder / Tech Lead / CISO / Partner)
- Motion (PLG / Sales-Assisted / Enterprise)
- Stage (Aware / Signed Up / Activated / Paying / Expanding / Enterprise)
- MRR (current or forecast)
- Next action + date
- Notes (context from emails/calls)

**When to graduate to HubSpot:** When pipeline exceeds 20 active enterprise deals.
**When to hire first sales rep:** When founder-led enterprise sales closes 3 deals ≥$2K/month.

### Billing Architecture (Stripe)

```
Stripe Products:
├── AEGIS Free (metered, $0 base, $0 per verify)
├── AEGIS Developer ($29/month flat)
│   └── Overage: $0.0002/verify above 500K
├── AEGIS Growth ($149/month flat)
│   └── Overage: $0.0001/verify above 5M
└── AEGIS Enterprise (custom, Stripe invoicing)
    └── Metered: $500/1M verifications block

Stripe Meters:
├── aegis_verifications (per verify call)
└── aegis_agents (per registered agent, for future seat-based pricing)

Usage reporting:
- Every verify call → increment Redis counter
- Redis → Stripe meter: nightly batch (Stripe Meters API)
- Overage billing: automatic via Stripe
```

---

## PART VI — PARTNERSHIP ECOSYSTEM

### Tier 1 Partners (Revenue-Generating)

**Stripe:**
Position: AEGIS as the recommended identity layer above ACP. Goal: get listed in Stripe's "ACP implementation guides" as the identity provider partner. Revenue: referral traffic + co-marketing.

**Cloudflare:**
Position: AEGIS uses CF Workers for edge verification. Goal: Cloudflare Workers Marketplace listing. Revenue: CF refers enterprise developers who need agent security.

**Railway:**
AEGIS deploys on Railway. Goal: featured template in Railway marketplace. Revenue: Railway developers discover AEGIS naturally.

### Tier 2 Partners (Distribution)

**LangChain:** Integration library → co-authored documentation → Discord presence
**AutoGen (Microsoft):** SDK integration → GitHub presence in their ecosystem
**CrewAI:** Integration + tutorial post on their blog
**n8n:** Native AEGIS node for n8n workflow automation

### Tier 3 Partners (Future)

**Visa Agentic Commerce:** Visa named Anthropic, OpenAI, and Perplexity as agentic commerce partners — AEGIS positions as the identity verification layer that makes Visa's agentic commerce program more trustworthy. Long-term: Visa certifies AEGIS as a trusted identity provider for agent-initiated card transactions.

**AWS Marketplace:** When enterprise revenue exceeds $500K ARR, list on AWS Marketplace for enterprise procurement simplification (many enterprise buyers have existing AWS commit).

---

*Document 04 of 05 | AEGIS KLYTICS Internal Suite*
