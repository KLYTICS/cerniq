# CERNIQ — Go-To-Market & Market Adoption Doctrine

## Document 02 — GTM, PLG Engine, Adoption Curve, Revenue Architecture

### KLYTICS Internal | Version 1.0 | May 2026

---

## PART I — MARKET REALITY BRIEF

### The Numbers That Define the Opportunity

Every stat below was confirmed via live research as of May 2026. These are not projections — they are the current state:

- **$7.6B → $52.6B** — AI agent market in 2025 vs. 2030 (46.3% CAGR)
- **80.9%** of technical teams have moved AI agents past planning into active testing or production
- **Only 21.9%** treat agents as independent identity-bearing entities — the other 78% use shared API keys, service accounts, or hardcoded credentials
- **45.6%** still use shared API keys for agent-to-agent authentication
- **Only 14.4%** of organizations report agents go live with full security/IT approval
- **46%** of teams cite integration with existing systems as their #1 challenge

**NIST validation (February 2026):** NIST's Center for AI Standards launched the AI Agent Standards Initiative on Feb 17, 2026 and published a concept paper specifically titled "Accelerating the Adoption of Software and AI Agent Identity and Authorization." Public comments closed April 2, 2026. This is the US government saying the problem CERNIQ solves is real, urgent, and infrastructure-level.

**Legal validation (November 2025):** Amazon sued Perplexity over AI agent identification violations — agents scraping systems while misrepresenting their User-Agent headers. When companies are suing each other over agent identity, the market is ready for a solution.

**Regulatory tailwind:** The EU AI Act, FINRA guidance on autonomous systems, and COSSEC regulatory pressure on Puerto Rico cooperativas all create compliance-driven demand for exactly what CERNIQ provides — auditability, authorization chains, and identity attestation for AI-initiated actions.

---

## PART II — ADOPTION CURVE ANALYSIS

### Crossing the Adoption Chasm: Where CERNIQ Sits

The technology adoption lifecycle for infrastructure products follows a predictable pattern. CERNIQ enters in the **Early Adopter → Early Majority transition** — the chasm — which is simultaneously the hardest phase and the most valuable to capture.

```
INNOVATORS      EARLY ADOPTERS     EARLY MAJORITY     LATE MAJORITY     LAGGARDS
(2-3%)          (13-15%)           (34%)              (34%)             (16%)
│               │                  │                  │                 │
│ Dev tinkerers │ Agent builders    │ Scale-up SaaS    │ Enterprise IT   │ Legacy
│ Research labs │ PLG startups      │ E-commerce       │ Banks, telcos   │ Gov't
│               │                  │ platforms        │                 │
│               │◄── CERNIQ MVP ────►│◄─ Target Y2/Y3 ─►│                 │
│               │    launches here  │                  │                 │
```

**Year 1 (2026):** Lock innovators + early adopters. These are the indie developers and startups building consumer agents (shopping, scheduling, task execution). Pain is highest. Price sensitivity is high. They need cheap, fast, self-serve.

**Year 2–3 (2027–2028):** Early majority capture. Scale-up SaaS companies deploying agent features within their products. Platforms like Shopify merchants, e-commerce operators, mid-size fintech. They need reliability guarantees, SLAs, and compliance artifacts.

**Year 3–5 (2028–2030):** Enterprise and institutional. Banks, healthcare systems, government contractors. They need SOC2, FINRA alignment, on-premise options, dedicated support. This is where the revenue transforms from high-volume/low-ACV to low-volume/high-ACV enterprise contracts.

### The Regulatory Inflection Point

The NIST initiative creates an artificial forcing function that compresses the adoption curve. Historically, infrastructure security standards take years to trickle from NIST guidance to enterprise mandates. But AI agents are moving faster — the gap between NIST paper (Feb 2026) and enterprise compliance requirements could be 12–18 months, not 5 years.

**Strategic implication:** CERNIQ must be in production with enterprise-grade compliance documentation _before_ the NIST standards finalize. Companies that implement CERNIQ before the mandate can claim "NIST-aligned agent identity infrastructure." Companies that don't implement anything will be scrambling to comply. First-mover advantage in the standards cycle is a structural moat.

---

## PART III — PLG ENGINE DESIGN

### The CERNIQ Flywheel

The PLG flywheel for a developer infrastructure product follows the Twilio/Stripe playbook adapted for the agent identity category. Here is the CERNIQ-specific version:

```
                    ┌─────────────────────────┐
                    │  DEVELOPER DISCOVERS     │
                    │  "my agent got blocked"  │
                    │  → searches for solution  │
                    └─────────────┬───────────┘
                                  │ organic search / community
                                  ▼
                    ┌─────────────────────────┐
                    │  SIGNS UP (< 60 seconds) │
                    │  No credit card          │
                    │  10K free verifications  │
                    └─────────────┬───────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
               ┌───│  AHA MOMENT              │───┐
               │   │  First successful verify  │   │
               │   │  call in < 10 minutes     │   │
               │   └─────────────┬───────────┘   │
               │                 │                │
               │                 ▼                │
               │   ┌─────────────────────────┐   │
               │   │  ACTIVATION              │   │
               │   │  Agent registered        │   │
               │   │  Policy created          │   │
               │   │  First live verify       │   │
               │   └─────────────┬───────────┘   │
               │                 │                │
               │                 ▼                │
               │   ┌─────────────────────────┐   │
               │   │  EXPANSION               │   │
    Virus-     │   │  Hit free tier limit     │   │ BATE Score
    loop:      │   │  → upgrade to Developer  │   │ becomes
    agent      │   │  Register more agents    │   │ valuable
    builders   │   │  Create complex policies │   │ → can't
    tell each  │   └─────────────┬───────────┘   │ leave
    other      │                 │                │
               │                 ▼                │
               │   ┌─────────────────────────┐   │
               └───│  ADVOCACY                │───┘
                   │  Blog post: "how I made  │
                   │  my agent trusted"       │
                   │  SDK tutorial on GitHub  │
                   │  Discord recommendation  │
                   └─────────────────────────┘
```

### The Aha Moment — Engineering the "10-Minute Verify"

This is the single most important engineering goal in Phase 1. The Aha Moment for CERNIQ is:

**"My agent sent a request with an CERNIQ token, and the relying party returned `{ valid: true, trustScore: 500 }`"**

Stripe's equivalent was the first successful API charge. Twilio's was the first SMS sent. CERNIQ's is the first verified agent interaction.

**The 10-Minute Verify path:**

```
Minute 0:    Developer signs up (email only, no credit card)
Minute 1:    Dashboard loads → "Register your first agent"
Minute 2:    Copy-paste their public key → agent registered → agentId returned
Minute 3:    SDK install: npm install @cerniq/sdk
Minute 5:    Copy-paste quickstart code (3 lines) → sign a test request
Minute 7:    POST to /v1/verify in sandbox → see { valid: true }
Minute 10:   Developer integrates into their agent → production test
```

Every minute of friction beyond 10 in this flow is a lost developer. The dashboard must be dead-simple. The SDK must be dead-simple. The error messages must be human-readable. The docs must answer "but why does this work?" in the sidebar.

### Content-Driven Distribution (The Twilio Playbook)

Developers discover tools by searching for problems, not product names. The CERNIQ content engine targets the problem-search:

**Tier 1 — SEO / Problem-search content:**

- "AI agent blocked by website bot detection — how to fix"
- "How to give your AI agent a verified identity"
- "My ChatGPT agent got flagged as spam — solution"
- "NIST agent identity authorization compliance guide"
- "How to implement OAuth for AI agents"
- "LangChain agent authentication best practices"

Each article ends with: "CERNIQ handles this with 3 lines of code. [Free quickstart →]"

**Tier 2 — Framework integration guides (highest-intent traffic):**

- "Add CERNIQ identity to your LangChain agent in 10 minutes"
- "CrewAI agent verification with CERNIQ"
- "AutoGen multi-agent trust with CERNIQ BATE"
- "OpenAI Assistants API + CERNIQ identity layer"
- "Anthropic Claude agents + CERNIQ policy engine"

These articles rank for developers who are actively building and know what framework they're using. Conversion rate is 3–5× higher than generic content.

**Tier 3 — Thought leadership / standard-setting:**

- "Why agent identity matters: the NIST view explained"
- "ACP + CERNIQ: the complete agentic commerce trust stack"
- "How to build a trusted agent (the full architecture)"

This content builds authority and attracts press, investors, and enterprise buyers.

---

## PART IV — CHANNEL-BY-CHANNEL ACQUISITION PLAN

### Channel 1: GitHub (Highest ROI for Phase 1)

**What to build:**

- `@cerniq/sdk` — open-source TypeScript/Python SDK (Apache 2.0)
- `cerniq-examples` repo — working examples in LangChain, AutoGen, CrewAI, raw Python
- `cerniq-middleware` — Express/NestJS/FastAPI middleware packages
- GitHub Actions workflow: `cerniq/verify-action` — verify agent identity in CI/CD

**GitHub-specific tactics:**

- Open issues for planned features → builds contributor community
- "Good first issue" tags → drives organic stars from contributors
- GitHub Sponsors → validates even before paid tier
- README badge: `![CERNIQ verified](https://cerniq.io/badge/your-agent-id)` — viral distribution every time a developer publishes an agent repo

**Target:** 500 GitHub stars in first 90 days. Stars are a lagging indicator — if content is right, this follows.

### Channel 2: Hacker News / Dev.to / r/LocalLLaMA

**Launch strategy:**
The "Show HN" post is the most valuable single marketing event in Phase 1. Timing: launch on a Tuesday at 8am EST. Format:

```
Show HN: CERNIQ — Verified identity for AI agents (like Stripe but for agent trust)

We built CERNIQ because our agent kept getting flagged as a bot.
- Register your agent in 2 minutes
- Get a cryptographic identity (Ed25519)
- Set spend limits and action scopes
- Relying parties verify in <80ms

The BATE engine tracks behavioral signals across sessions and builds a trust
score (0-1000) that compounds over time — like a credit score for your agent.

Free tier: 10K verifications/month. SDK is MIT licensed.
[link] [demo video 90 seconds]
```

**What to have ready for HN launch day:**

- 90-second Loom demo (no talking head — screen only, show the code path)
- Working sandbox environment (never go down on HN day)
- Founder in comments for 4 hours answering every question
- Pre-written answers to predictable objections (see objection handling below)

### Channel 3: Developer Discord Communities

**Target communities (by priority):**

1. LangChain Discord (100K+ members)
2. AutoGen Discord / GitHub Discussions
3. ai-builders (multiple servers)
4. Indie Hackers
5. CrewAI Discord
6. Anthropic developer community
7. OpenAI developer forum

**Community entry strategy:**
Do NOT join and immediately post about CERNIQ. This is the #1 mistake. Instead:

- Week 1: Help 10 people with agent-related problems (no product mention)
- Week 2: Answer questions, become a known name
- Week 3: Someone asks about agent authentication → naturally mention CERNIQ
- This is the Twilio playbook: "Ask Your Developer" only works after developers trust you

### Channel 4: Framework Integrations (Force Multiplier)

Every agent framework is a distribution channel. The goal is to be listed or recommended in:

- LangChain's documentation under "Security and Authentication"
- AutoGen's "Production Deployment" guide
- CrewAI's "Enterprise Deployment" section

**How to get there:**

- Build the official LangChain-CERNIQ integration (open source, PR to their repo)
- Offer co-marketing: "Secure your LangChain agents with CERNIQ" blog post on their site
- Sponsor their Discord or community events (cheap at early stage)

This is the Stripe playbook: Stripe got into every e-commerce platform's documentation. CERNIQ gets into every agent framework's documentation.

### Channel 5: Relying Party Network (Pull Strategy)

This is counterintuitive but powerful: get relying parties to demand CERNIQ, not just developers.

**How it works:**

- Approach e-commerce platforms (Shopify apps, WooCommerce plugins) with: "Your merchants are getting flooded with AI agent traffic. CERNIQ gives you a one-line verification check."
- Build the Shopify app that checks CERNIQ on inbound agent requests (free for merchants)
- When a developer's agent hits a Shopify store with CERNIQ checking, they see: "This agent failed verification. Register at cerniq.io for a trusted identity."
- That message converts developers without any marketing spend

This is the network effect kicker: relying parties become acquisition channels for developer signups.

---

## PART V — CONVERSION & MONETIZATION ARCHITECTURE

### Free → Paid Conversion Events

The job is to make the paid upgrade feel obvious and necessary, not forced.

**Conversion Event 1 — Volume (most common):**
Developer hits 10K verification limit. Dashboard shows: "You've used 9,847 of 10,000 verifications. Your agent will stop verifying in 2 days. [Upgrade for $29/month →]"
Expected conversion rate: 15–25% of active users who hit the wall.

**Conversion Event 2 — Trust Score Unlock:**
Free tier shows a placeholder BATE score ("BATE score: [Upgrade to unlock]"). Developers see the score bar greyed out and want to know what it says. Upgrade to Developer tier unlocks live trust score. FOMO conversion.
Expected conversion rate: 8–12% of users who see the locked score.

**Conversion Event 3 — Anomaly Alert:**
Free tier does not include anomaly detection. When a developer's agent is flagged by a relying party, the free dashboard shows: "⚠ Your agent received 1 behavioral report from a relying party. Upgrade to see details and protect your trust score."
Expected conversion rate: 20–30% of users who see a flag.

**Conversion Event 4 — Audit Export:**
Developer needs audit logs for a compliance review, investor due diligence, or enterprise customer demo. Free tier limits to 30-day retention. They need more. [Upgrade for 90-day access →].
Expected conversion rate: 25–35% of users who request an export.

### Pricing Psychology

**$29/month Developer tier is priced at "impulse purchase":**
Under $30/month, most developers don't need manager approval. They swipe a personal card. This is intentional. $49/month often requires a Jira ticket. $29 does not.

**Growth tier at $149/month is priced at "team decision":**
$149 requires a brief conversation with a team lead. This is where the Account Executive motion starts. The first call is not a sales call — it's "I noticed your team upgraded, happy to walk you through the BATE dashboard."

**Enterprise is time-and-materials + base:**
No public pricing. Starts at $1,500/month. Scoped to the specific use case (cooperativa compliance, FINRA, on-prem BATE). This is where CERNIQ's pipeline becomes CERNIQ's direct sales pipeline.

### Expansion Revenue Model

The real money in developer tools is expansion, not acquisition. CERNIQ expansion levers:

| Lever             | How It Works                                          | Target Account               |
| ----------------- | ----------------------------------------------------- | ---------------------------- |
| Agent count       | 10 agents → 50 agents as product grows                | Any growing startup          |
| Verify volume     | Usage spikes as user base grows                       | Consumer agent products      |
| Policy complexity | Simple → complex spend controls → need Growth tier    | Fintech, e-commerce          |
| BATE access       | Free → Developer → custom scoring rules at Enterprise | Security-sensitive verticals |
| Audit retention   | 30d → 90d → 1yr → 7yr for compliance                  | FINRA, COSSEC, healthcare    |
| Multi-environment | Dev + Staging + Prod = 3× revenue from same customer  | Any production deployment    |

---

## PART VI — YEAR-BY-YEAR ADOPTION FORECAST

### Assumptions (Conservative)

- Month 1 launch: HN launch + GitHub release
- Developer channel growing at 15–20%/month via PLG
- Enterprise channel starts Month 9 with CERNIQ pipeline activation
- No paid marketing budget in Year 1 (pure PLG)

### Year 1 Forecast

| Month | Free Signups | Paid (Dev) | Paid (Growth) | MRR                                 |
| ----- | ------------ | ---------- | ------------- | ----------------------------------- |
| 1     | 200          | 0          | 0             | $0                                  |
| 2     | 400          | 8          | 0             | $232                                |
| 3     | 700          | 20         | 2             | $878                                |
| 4     | 1,100        | 38         | 5             | $1,847                              |
| 5     | 1,600        | 60         | 9             | $3,081                              |
| 6     | 2,300        | 88         | 15            | $4,797                              |
| 7     | 3,100        | 120        | 22            | $6,528                              |
| 8     | 4,000        | 158        | 32            | $9,374                              |
| 9     | 5,100        | 200        | 44            | $12,356 + Enterprise pipeline opens |
| 10    | 6,300        | 248        | 58            | $15,938                             |
| 11    | 7,800        | 302        | 75            | $20,433                             |
| 12    | 9,500        | 365        | 95            | $24,760                             |

**Year 1 ARR target: ~$250K–$300K**
This is the gate for Series A conversations. At $250K ARR with 46%+ CAGR category momentum, the story is clear.

### Year 2 Forecast (Enterprise Layer Activates)

| Quarter | Enterprise Customers | Enterprise ACV | Total ARR |
| ------- | -------------------- | -------------- | --------- |
| Q1 Y2   | 2                    | $18,000        | $450K     |
| Q2 Y2   | 5                    | $22,000        | $650K     |
| Q3 Y2   | 9                    | $25,000        | $950K     |
| Q4 Y2   | 14                   | $28,000        | $1.4M     |

**Year 2 ARR target: $1.2M–$1.5M**
This is the gate for Series A closing ($8M–$12M at 8–10× ARR). Use proceeds to hire: Head of Engineering, Head of Sales (enterprise), DevRel lead.

---

## PART VII — OBJECTION HANDLING LIBRARY

Every founder-led sales process hits the same 8 objections. Pre-loaded answers:

### Objection 1: "I'll just use OAuth."

**Reality:** OAuth delegates identity for _humans_. It was designed for a person granting an app access to their Google Calendar. When the agent acts without a human in the loop, OAuth breaks — there's no user to redirect to a login page. CERNIQ is built for autonomous, headless agent operation. OAuth is a component we build _on top of_, not a replacement.

### Objection 2: "Auth0 already handles this."

**Reality:** Auth0 for AI Agents (GA November 2025) is an excellent tool for agent _authentication within your own platform_. It doesn't solve cross-platform neutral verification — when your agent shows up at a third-party service, Auth0 can't tell Delta that your agent is safe. CERNIQ is the neutral trust layer between platforms. Auth0 is a building block inside your platform.

### Objection 3: "Won't Google/Stripe just build this?"

**Reality:** Stripe built ACP — the payment protocol. It explicitly leaves identity verification to implementers. Google controls device identity (passkeys, device attestation). Neither is a neutral broker between arbitrary agents and arbitrary services. CERNIQ is the Switzerland — no platform affiliation. Enterprises will not route all agent traffic through a competitor's infrastructure.

### Objection 4: "This is a security problem, not a product."

**Reality:** TLS was a security problem. API keys were a security problem. OAuth was a security problem. Every piece of infrastructure that routes value on the internet started as a security problem that someone productized. CERNIQ is productizing the agent identity security problem the same way Stripe productized payment security.

### Objection 5: "My agents don't do anything financial."

**Reality:** Today they don't. In 6 months they will. And the cost of retrofitting agent identity into a system that was built without it is enormous. Stripe is cheap when you start with it and expensive to add later. CERNIQ is the same. Start now, before your agent gets blocked.

### Objection 6: "I don't want a third party in my verification path."

**Reality:** The verification response is cached for 30 seconds and the hot path runs on Cloudflare's edge (135 locations globally). Your agent never waits more than 80ms for a verify response. If CERNIQ goes down, your system gets a cached "valid" response for up to 30 seconds and then degrades gracefully. We publish our uptime at status.cerniq.io.

### Objection 7: "How do I know my competitors won't see my agent activity?"

**Reality:** Zero behavioral data is shared between principals. Your agent's trust score and transaction history are private to your CERNIQ account. Relying parties see a score and a policy check — not your underlying activity. Anonymized aggregate signals (not individual agent data) power BATE's cross-network anomaly detection.

### Objection 8: "What if my agent's identity is stolen?"

**Reality:** CERNIQ never holds your private key. We hold the public key only. If your private key is compromised, you revoke the agent in one API call (DELETE /v1/agents/:agentId) and register a new one. The revocation propagates to Cloudflare edge in <5 seconds. Any verification attempt with the old token returns `{ valid: false, denialReason: "AGENT_REVOKED" }` immediately.

---

## PART VIII — DEVELOPER RELATIONS PLAN

DevRel is not a nice-to-have for CERNIQ. It is the primary distribution mechanism.

### Phase 1 DevRel (Erwin as sole DevRel, 5 hrs/week)

**Week 1–4: Content foundation**

- Quickstart guide (< 1,000 words, 10-minute path)
- API reference (auto-generated + hand-written intro sections)
- 3 integration tutorials (LangChain, AutoGen, raw Python)
- GitHub README with working code examples

**Week 5–8: Community entry**

- Join 5 target Discord communities (per Channel 3 plan above)
- Post 3 helpful answers/week in agent-related threads
- Begin relationship with LangChain team (GitHub PR or Discord contact)
- Submit to 2 developer newsletters (TLDR, The Pragmatic Engineer, etc.)

**Week 9–12: Amplification**

- "Show HN" launch (timing with MVP readiness)
- Guest post on a developer-focused publication (dev.to, hackernoon)
- 1 video tutorial (Loom, 15 minutes, no production required)
- Respond to every GitHub issue within 24 hours

### Phase 2 DevRel (First DevRel hire, post $5K MRR)

- Dedicated DevRel lead (contractor → FTE)
- Conference talks: Anthropic developer summit, LangChain Conference, AI Engineer Summit
- Partnership content: co-authored posts with LangChain, AutoGen maintainers
- CERNIQ developer blog: 2 posts/week
- Weekly Twitter/X thread on agent security topics

---

_Document 02 of 05 | CERNIQ KLYTICS Internal Suite_
