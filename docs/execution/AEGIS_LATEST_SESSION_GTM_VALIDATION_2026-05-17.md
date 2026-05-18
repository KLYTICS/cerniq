# AEGIS Latest Session, GTM, Validation, and Video Asset Brief

Date: 2026-05-17
Scope: latest repo session state, launch readiness, GTM, marketing, video assets, field research.

## Executive Read

AEGIS is technically far stronger than the average pre-launch security product. The latest session materially improved the trust substrate: FAPI-shaped verify behavior, denial context, Worker parity, intent-manifest regression locks, cross-language SDK parity, and design-system assets all landed or were documented in the latest handoff arc. The core engineering story is good enough to sell to technical early adopters now.

The business launch story is not yet fully self-serve. The public marketing app is intentionally honest: paid CTAs route to email because cold signup -> payment -> principal -> API key -> email fulfillment is not wired. The executable launch gate confirms this: `scripts/launch-runbook/phase-0-check.sh --verbose` currently fails 5 of 8 checks.

The right next move is not more internal architecture polish. It is a founder-led wedge: sell a manually onboarded pilot to 5-10 high-signal buyers while closing only the minimum onboarding gaps needed to make the first customer successful.

## What Works Now

### 1. The technical thesis is coherent

AEGIS is positioned as a neutral verification, policy, behavioral attestation, and audit layer between AI agents and the services they act on. The invariant is clear and differentiated: AEGIS holds public keys, not private keys; it signs what it observed; and relying parties get a typed verification decision.

The strongest surfaces:

- Agent identity with Ed25519 public-key registration.
- Policy-bound action verification through `/v1/verify`.
- Fixed denial precedence, now extended with `TRIAL_EXHAUSTED`.
- Append-only signed audit chain and offline verification tooling.
- BATE trust scoring as the future compounding moat.
- Intent manifest and verifier-rp work that makes relying-party integration more credible.
- FAPI 2.0-shaped substrate: JAR, RAR, OAuth error envelope, AS metadata, denial context, and Worker parity tests.

### 2. The latest session closed real security and parity debt

Per `docs/SESSION_HANDOFF.md`, the latest arc reports 12 commits on `feat/sdk-verify-gateway-hardening`, moving the branch from a staged swarm surface to a bundled, audited state. The key outcome is that the parity suite grew from 16 files / 237 tests to 25 files / 325 tests green.

Meaningful closures:

- Intent-manifest scaffold promises became regression tests.
- Structural cross-protocol substitution defense is now locked by test.
- FAPI rounds 8-11 were bundled into an interdependent substrate commit.
- Worker parity caught drift in `VerifyResponseSchema` and denial context.
- TS/Python IntentClient wire-shape parity is now covered.
- Brand/design-system assets were committed.

### 3. The marketing surface exists and is directionally usable

`apps/marketing` is a standalone Next app with a credible landing page, terms/privacy/DPA pages, quickstart, security, integrations, changelog, and use-cases pages.

The marketing page is especially strong when it says:

- AEGIS is standards-shaped, not bespoke.
- It is FAPI 2.0-shaped for financial rail teams.
- It is neutral across vendors, models, and protocols.
- It holds only public keys.
- Every action becomes signed audit evidence.

That is the right category frame.

### 4. Brand assets are ahead of the product stage

`brand/` includes a brand brief, design tokens, logos, style guide, pitch deck, and generated visual assets/prompts. This is useful now: early security products often look like internal tools. AEGIS already has enough visual language to produce demo videos, social clips, pitch material, and investor/customer proof.

### 5. External market timing is real

Current market signals support the thesis:

- NIST launched the AI Agent Standards Initiative on 2026-02-17, explicitly focused on interoperable, secure AI agents and agent identity/security research.
- NIST's NCCoE concept paper on software and AI agent identity/authorization was published 2026-02-05 and asks for feedback on identification, authorization, auditing, non-repudiation, and prompt-injection controls.
- Cloud Security Alliance reported on 2026-03-24 that 73% of organizations expect AI agents to become vital within a year, while 68% cannot clearly distinguish human from AI agent activity.
- MCP's 2025-06-18 authorization spec requires OAuth 2.1, protected resource metadata, HTTPS, PKCE, secure token storage, and exact redirect URI validation. This validates that agent protocol ecosystems are converging on identity/security infrastructure, but does not replace AEGIS's neutral verification/audit layer.
- Stripe/OpenAI ACP and Google AP2/UCP activity validate agentic commerce as a category. Payment protocols need identity, intent, authorization, and audit around them.

## What Needs Work

### P0: Onboarding is blocked

`bash scripts/launch-runbook/phase-0-check.sh --verbose` result:

- FAIL: no lazy principal creation in checkout webhook.
- FAIL: no email service in `apps/api`.
- FAIL: no API-key auto-issuance in billing webhook.
- FAIL: no IDP SDK installed in dashboard.
- FAIL: no admin path to create a Principal in production.
- PASS: all 3 IDP adapters call `prisma.principal.create`.
- PASS: dashboard has UpgradeButton for Flow B.
- PASS: marketing CTAs route to mailto.

Practical meaning: do not run paid ads or push a self-serve promise yet. Founder-led onboarding is acceptable; automated cold checkout is not.

Minimum viable fix path:

1. Pick one IDP for v1. The repo has ADR-0019 proposing Clerk for Developer tier and Auth0 for Enterprise. Decide and install one dashboard SDK.
2. Add an auditable admin/onboarding path or close the IDP invite flow end-to-end.
3. Add first API-key issuance after principal creation.
4. Add transactional email only if you want self-serve fulfillment; manual delivery is fine for the first 5 pilots.
5. Keep marketing CTAs as mailto until this passes.

### P0: The public promise needs calibration

AEGIS can credibly say "standards-shaped agent verification and audit." It should not yet imply:

- Fully automated self-serve onboarding.
- Production-ready cold checkout.
- DPoP implemented.
- All Tier-A integrations implemented.
- BATE weights finalized.
- Enterprise compliance complete.

The product will be more trusted if it is blunt about what is live, beta, and roadmap.

### P1: BATE is the moat, but needs buyer validation

BATE is conceptually strong. It also risks becoming abstract. Field research must answer:

- Do buyers want a numeric agent trust score, or do they want pass/fail policy enforcement plus audit evidence?
- Which signals are trusted enough to affect decisions?
- Who is allowed to submit negative behavioral reports?
- Does "agent credit score" excite people or scare compliance/legal buyers?
- What is the first paid BATE use case: anomaly alerts, trust bands, fraud-report weighting, audit summaries, or policy tuning?

### P1: Integrations are mostly stubs

`docs/INTEGRATION_ROADMAP.md` correctly prioritizes OpenAI, Anthropic, Vercel AI SDK, LangChain, n8n, Zapier, AWS, and Azure. Most `packages/integrations/*` surfaces are still stubs. For GTM, pick one developer ecosystem and make it real before widening.

Recommended first real integration:

- MCP bridge if the buyer pain is tool execution.
- LangChain/LangGraph if PLG developer adoption is the goal.
- Stripe ACP/SPT or AP2 adjacent demo if commerce is the wedge.
- Auth0/Okta positioning only as "coexists with identity providers," not a replacement.

### P1: Pricing docs have drift

ADR-0014 locks:

- Free trial: 10K lifetime verifies.
- Developer: $49/mo, 50K verifies/mo.
- Team: $299/mo, 500K verifies/mo.
- Scale: $1,499/mo, 5M verifies/mo.
- Overage: $0.0008/verify.

Some older strategy docs still reference $29/$149. Treat ADR-0014 as source of truth.

### P2: Documentation needs a buyer-ready path

The repo has excellent internal docs. External docs need one clean "first buyer" route:

1. What is AEGIS?
2. Why now?
3. Integrate in 10 minutes.
4. Verify an agent request.
5. View audit event.
6. Understand denials.
7. Pilot checklist.
8. Security FAQ.

Do not expose every internal architecture document to prospects. Buyers need confidence, not the whole workshop floor.

## What Is Good

### The category definition is good

"Neutral verification layer for AI agents" is stronger than "AI identity platform." It avoids fighting Auth0/Okta directly and gives AEGIS permission to sit between protocols: ACP, AP2, MCP, A2A, custom agents, internal tools.

### The proof orientation is excellent

The project has a rare discipline: claims become tests, parity checks, generated artifacts, and runbooks. That should become marketing:

- "Every public claim maps to code or a test."
- "Verified. Or it didn't happen."
- "No silent failure; every denial is typed."
- "Offline-verifiable audit evidence."

### The wedge into financial rails is plausible

FAPI/JAR/RAR/AS metadata gives AEGIS a stronger financial-services story than generic agent-security tools. This is useful for fintech, cooperativas, broker-dealer demos, and buyer teams who already understand standards.

### The brand is differentiated

"Verified Light" plus the Aegis Shield mark can make this feel premium and serious without becoming enterprise sludge. Keep the voice cryptographic, neutral, and literal.

## GTM Recommendation

### Positioning

Primary:

> AEGIS verifies every AI-agent action before it reaches a real system.

Supporting:

> Public-key agent identity, scoped authorization, behavioral attestation, and signed audit evidence. Protocol-neutral. Vendor-neutral. Built for relying parties that need to know who acted, under whose authority, and whether the action should be allowed.

Avoid:

- "AI passport"
- "The Okta for AI agents"
- "Trust score for all AI"
- "Enterprise-grade AI identity governance platform"

Those either narrow the product incorrectly or invite direct comparison against bigger IAM vendors.

### ICP for the next 30 days

Pick one:

1. Fintech / payments teams building agentic transaction flows.
2. Agent framework/platform builders who need trust middleware.
3. B2B SaaS teams exposing tool-calling agents to customer data.

My recommendation: start with fintech/payments, because the repo's FAPI substrate, intent-manifest work, audit chain, and ACP/AP2 tailwinds all point there.

### First offer

Do not sell "platform." Sell a pilot:

> AEGIS Verified Agent Pilot: 2 weeks, one agent, one relying-party endpoint, one signed audit trail, one denial dashboard, one buyer-facing trust report.

Pilot scope:

- Register one agent.
- Define one policy.
- Verify one action path.
- Generate signed audit evidence.
- Produce a buyer-ready "agent action attestation" report.

Price:

- Founder-led beta: $500-$2,500 setup, then $49-$299/month depending on volume.
- For warm CERNIQ/cooperativa route: $2,500-$10,000 pilot if compliance/audit deliverables are included.

### Channels

Near term:

- Founder outbound to 30 high-signal buyers.
- Demo video + technical landing page.
- 3 deep technical posts.
- GitHub README + working example.
- Warm CERNIQ/cooperativa introductions.

Later:

- HN launch only after self-serve passes Phase 0 or after the demo sandbox can survive traffic.
- Framework partnerships only after one integration is production-quality.
- Paid ads last; not before activation is measurable.

## Field Research and Validation Plan

### Hypotheses to validate

H1: Teams building agentic commerce need a neutral verification layer that is not owned by OpenAI, Stripe, Google, Auth0, or a model vendor.

H2: Relying parties care more about typed denials and signed audit trails than about a generic trust score.

H3: Developers will integrate if they can reach first verify in under 10 minutes.

H4: Fintech/security buyers will pay for audit evidence before they pay for BATE scoring.

H5: "FAPI-shaped" is a meaningful trust signal for financial-rail teams.

### 30-interview plan

Segment A: 10 builders

- LangChain/LangGraph, Vercel AI SDK, OpenAI/Anthropic agent builders.
- Goal: learn integration friction and language.

Segment B: 10 relying parties

- API owners, marketplace/ecommerce operators, B2B SaaS platform teams.
- Goal: learn what proof they require before accepting agent traffic.

Segment C: 10 security/compliance buyers

- Fintech, regulated SaaS, cooperativa/COSSEC contacts, SOC2-heavy startups.
- Goal: validate audit/compliance buying triggers and budget.

### Interview script

1. What agent workflows are you shipping or testing?
2. When an agent takes an action, how do you know who authorized it?
3. Do you assign distinct identities to agents, or do they share service accounts/API keys?
4. What happens if an agent is blocked, over-scoped, or misbehaves?
5. What logs would you need to prove what happened to a customer, auditor, or regulator?
6. Would a typed verification decision help? Which fields must be present?
7. Would a trust score help, or would it feel too opaque?
8. What would make you uncomfortable about a third-party verification layer?
9. Who would approve using this?
10. What would you pay for a 2-week pilot proving one live flow?

### Validation scorecard

Advance a segment only if:

- At least 6/10 have the pain now or in the next 90 days.
- At least 4/10 have an identifiable owner and budget path.
- At least 3/10 agree to a follow-up technical demo.
- At least 1/10 agrees to run a pilot or introduce the budget owner.

Kill or pivot if:

- Buyers say the pain is interesting but not urgent.
- They want this only as part of an IAM suite.
- They cannot name the relying-party verification point.
- Audit evidence is not tied to a real compliance/customer event.

## Video Asset Pack

Use the brand direction in `brand/README.md`: cinematic immersive, near-black canvas, aurora gradient as key light, cryptographic literalism, no mascots, no "AI magic."

### Asset 1: 90-second product demo

Goal: Show the 10-minute verify path, no talking head required.

Structure:

0-10s: Problem
"AI agents can click, buy, query, and deploy. Most systems still cannot tell which agent acted, who authorized it, or whether the action was allowed."

10-25s: AEGIS setup
Screen capture: register agent, public key only, policy creation.

25-45s: Signed action
Screen capture: code signs one outbound action.

45-65s: Verify decision
Screen capture: `POST /v1/verify` returns valid result or typed denial.

65-80s: Audit evidence
Screen capture: signed audit event and offline verifier.

80-90s: CTA
"Verified. Or it didn't happen. Join the first AEGIS pilot."

Visual requirements:

- Use real code and terminal output where possible.
- Blur secrets.
- Show one denial as well as one approval.
- End with the shield mark and one CTA URL/email.

### Asset 2: 30-second social cut

Hook:

"Your AI agent just moved money. Prove it was allowed."

Shot list:

1. Agent action token appears.
2. Policy gate checks scope/spend/domain.
3. Trust band updates.
4. Audit block links into chain.
5. Badge: "Verified by AEGIS."

Caption:

"AI agents need more than API keys. AEGIS gives every action identity, policy, and audit evidence."

### Asset 3: 12-second visual bumper

Use for posts, launch pages, deck intros.

Storyboard:

1. Black field, faint hexagonal shield outline.
2. One cyan-violet beam crosses a request path.
3. Three stamps appear: Identity, Policy, Audit.
4. Final text: "Verified. Or it didn't happen."

Generation prompt:

> Cinematic product-security bumper for AEGIS, a neutral AI-agent verification layer. Near-black obsidian background, subtle hexagonal shield mark, thin cyan-violet aurora light beam tracing a request through three checkpoints labeled Identity, Policy, Audit. Minimal, premium, cryptographic, no mascots, no humanoid robots, no stock-photo feel, no glowing text, no busy network blobs. End frame: AEGIS shield mark and tagline "Verified. Or it didn't happen." 12 seconds, smooth Apple-like ease-out motion, high contrast, clean typography, 16:9.

### Asset 4: Founder validation clip

Goal: Recruit interviews, not sell.

Script:

"I'm working on AEGIS, a neutral verification layer for AI agents. The question we're testing is simple: when an agent takes an action, what proof does the receiving system need before it trusts that action? If you're building agents, accepting agent traffic, or reviewing AI security, I want to learn how you're handling identity, authorization, and audit today. No pitch deck. Just a 20-minute field interview."

CTA:

"Reply with 'agent identity' and I'll send a time."

## 14-Day Execution Plan

Day 1-2:

- Decide v1 IDP path.
- Keep marketing CTAs mailto.
- Create one private demo tenant.
- Record the 90-second demo from local/staging.

Day 3-5:

- Build one buyer-specific demo: fintech agent verifies a payment-like action.
- Write one technical post: "How to verify an AI-agent action before it hits a financial API."
- Send 30 interview requests.

Day 6-8:

- Conduct 10 interviews.
- Tune demo around the strongest pain language.
- Close one pilot candidate.

Day 9-11:

- Fix only the onboarding gaps blocking that pilot.
- Build the pilot's one policy and one verify path.
- Produce the first signed audit evidence export.

Day 12-14:

- Run pilot review.
- Ask for paid continuation or intro to security/compliance owner.
- Convert the learnings into public case-study-shaped copy, even if anonymized.

## Bottom Line

AEGIS is not missing a thesis. It is missing live market contact. The latest session made the architecture significantly more defensible; the next phase should make the buyer journey significantly more real.

Ship the founder-led pilot path first. Use the impressive security substrate as proof, not as an excuse to delay selling.

## External Sources Checked

- NIST AI Agent Standards Initiative, 2026-02-17: https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure
- NIST NCCoE AI Agent Identity and Authorization concept paper, 2026-02-05: https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd
- Cloud Security Alliance / Aembit survey press release, 2026-03-24: https://cloudsecurityalliance.org/press-releases/2026/03/24/more-than-two-thirds-of-organizations-cannot-clearly-distinguish-ai-agent-from-human-actions
- MCP Authorization specification, 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Stripe agentic commerce docs: https://docs.stripe.com/agentic-commerce
- OpenAI ACP announcement, 2025-09-29: https://openai.com/blog/buy-it-in-chatgpt/
- Stripe ACP / Instant Checkout announcement, 2025-09-29: https://stripe.com/newsroom/news/stripe-openai-instant-checkout
- Google AP2 announcement, 2025-09-16: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
- Auth0 for AI Agents: https://auth0.com/ai
- OWASP Agentic AI security solutions landscape Q2 2026: https://genai.owasp.org/resource/ai-security-solutions-landscape-for-agentic-ai-q2-2026/
