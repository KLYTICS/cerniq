# CERNIQ — Beta Onboarding Runbook

## Operator Guide for First 100 Users

> **Owner:** Erwin Kiess-Alfonso (Operator) + Growth Lead  
> **Phase:** Public Beta (Phase 1 GA → $500 MRR gate)  
> **Updated:** 2026-05-04  
> **Source of truth for:** user acquisition, activation funnel, feedback loops, escalation path

---

## 1. North Star Metrics

| Metric                   | Definition                                                  | Beta Target |
| ------------------------ | ----------------------------------------------------------- | ----------- |
| **Activation Rate**      | Users who reach first successful `/v1/verify` within 7 days | ≥ 60%       |
| **Time-to-First-Verify** | Minutes from signup to first `approved: true` response      | ≤ 10 min    |
| **Week-1 Retention**     | Users who make ≥1 verify call on Day 7                      | ≥ 40%       |
| **NPS**                  | Net Promoter Score at Day 14                                | ≥ 45        |
| **P99 Verify Latency**   | At any real user load                                       | ≤ 200ms     |

---

## 2. Beta Cohort Strategy

### 2.1 Who We Onboard First

Beta cohort priority order (do not deviate):

**Tier A — Design Partners (slots: 5-10 companies)**

- Criteria: Building LangChain/CrewAI agents handling real money OR enterprise data.
- Commitment: 60-min onboarding call + weekly check-in for 30 days.
- What they get: Dedicated Slack channel, white-glove setup, direct line to engineering.
- Metric: These users define Phase 2 feature roadmap.

**Tier B — Developers (slots: 50-100 individuals)**

- Criteria: Active on AI/agent communities (LangChain Discord, Claude Discord, Hugging Face Forums).
- Commitment: Async only — docs + Discord support.
- What they get: Free tier (10 req/sec, 10K verifies/month), early access badge.
- Metric: These users produce public integrations (repos, blog posts, tweets).

**Tier C — Waitlist**

- All others. Invite in batches of 20 as infrastructure stabilizes.

### 2.2 Waitlist Form Fields

Collect at signup (cerniqapp.com/beta):

```
1. Email (required)
2. Company/project name (optional)
3. What are you building? (free text, required — AI agent / autonomous workflow / other)
4. Monthly API calls estimate (1-1K / 1K-100K / 100K+)
5. Primary stack (TypeScript / Python / Other)
6. How did you hear about CERNIQ? (referral source)
7. "Do you handle financial transactions or sensitive user data?" (Yes/No — fast-tracks Tier A)
```

---

## 3. Invitation Flow

### 3.1 Send Invite

When a batch is ready:

```bash
# 1. Generate a signed invitation token (CLI)
cerniq admin invite-batch \
  --emails ./beta-cohort-1.csv \
  --tier developer \
  --expires-days 14 \
  --note "Beta Cohort 1, May 2026"

# 2. This returns: N invitation URLs with embedded signed tokens
# 3. Feed to your email provider (Loops, Resend, etc.)
```

Invitation email template (plain text preferred for deliverability):

```
Subject: Your CERNIQ beta access is ready

Hey [First Name],

You're in. CERNIQ beta is live — here's your personal access link:

  [INVITE_URL]

This link expires in 14 days and creates your principal account.

What you can do today:
  → Register an AI agent (1 API call)
  → Attach a policy (spend limits, scope gates)
  → Start verifying actions in your workflow

Start here: https://docs.cerniqapp.com/quickstart

If you're building something cool and want a dedicated Slack channel
with direct engineering access, reply to this email.

— Erwin
Founder, CERNIQ
```

### 3.2 Onboarding Activation Email Sequence

Use Loops or equivalent. Fire these automatically via webhook on Principal creation:

| Day | Trigger          | Subject                                          | Content                                |
| --- | ---------------- | ------------------------------------------------ | -------------------------------------- |
| 0   | Account created  | "Your CERNIQ account is ready"                   | Dashboard link + quickstart link       |
| 1   | No first agent   | "Register your first agent in 2 minutes"         | CLI one-liner to register              |
| 3   | No first verify  | "Haven't verified yet? Here's a working example" | curl snippet that works out of the box |
| 7   | Has verified ≥1  | "You're live — here's what to watch"             | Trust bands, BATE signals, audit log   |
| 7   | Has NOT verified | "Quick check-in from CERNIQ"                     | Ask what's blocking (reply to email)   |
| 14  | Any              | "30 seconds of feedback?"                        | NPS survey link                        |

---

## 4. PrincipalOnboarding Activation Funnel

Every `Principal` has a server-persisted `PrincipalOnboarding` record (7 binary gates, one-way ratchet):

```typescript
enum OnboardingStep {
  hasFirstAgent        // created ≥1 AgentIdentity
  hasFirstPolicy       // attached ≥1 policy to an agent
  hasFirstVerify       // received ≥1 verify call → approved
  hasFirstDenial       // hit at least 1 denial (proves policy enforcement works)
  hasKmsConfigured     // KMS key source configured (not just env var dev keys)
  hasWebhookConfigured // ≥1 active WebhookSubscription
  hasApiKeyRotated     // rotated initial API key at least once
}
```

### 4.1 Tracking Activation in Real Time

```sql
-- Cohort activation funnel as of today
SELECT
  step,
  COUNT(*) FILTER (WHERE reached) AS reached,
  ROUND(100.0 * COUNT(*) FILTER (WHERE reached) / COUNT(*), 1) AS pct
FROM (
  SELECT
    p.id,
    po."hasFirstAgent"    AS reached, 'hasFirstAgent'    AS step FROM "Principal" p JOIN "PrincipalOnboarding" po ON po."principalId" = p.id
  UNION ALL
  SELECT p.id, po."hasFirstVerify",    'hasFirstVerify'    FROM "Principal" p JOIN "PrincipalOnboarding" po ON po."principalId" = p.id
  UNION ALL
  SELECT p.id, po."hasFirstDenial",    'hasFirstDenial'    FROM "Principal" p JOIN "PrincipalOnboarding" po ON po."principalId" = p.id
) q
GROUP BY step
ORDER BY pct DESC;
```

### 4.2 Activation Targets by Day

| Gate             | Day 1 Target | Day 7 Target |
| ---------------- | ------------ | ------------ |
| `hasFirstAgent`  | 80%          | 95%          |
| `hasFirstPolicy` | 50%          | 80%          |
| `hasFirstVerify` | 40%          | 70%          |
| `hasFirstDenial` | 10%          | 50%          |

If `hasFirstVerify` < 40% at Day 7, trigger manual outreach to all stuck users.

---

## 5. White-Glove Onboarding (Tier A Design Partners)

### 5.1 Pre-Call Checklist (do before the 60-min call)

```
[ ] Create their Principal account manually (don't make them wait for invite)
[ ] Pre-register a test agent: cerniq agents register --name "design-partner-test"
[ ] Prepare a working verify curl snippet using their domain
[ ] Read their GitHub/product page — know what they're building before the call
[ ] Prepare a Slack channel: #partner-[company-name]
[ ] Confirm: do they handle money? → enable spend limits demo
[ ] Confirm: do they need GDPR/SOC2? → show audit log + chain verification
```

### 5.2 60-Minute Call Structure

```
00:00 - 05:00  Introductions. Ask: "Tell me about an agent action that went wrong
                recently." Let them talk. This is research.

05:00 - 20:00  Live walkthrough:
                1. Register agent (watch them do it, don't do it for them)
                2. Attach a spend policy (explain DENY vs LIMIT vs ALERT)
                3. Make a verify call — show approved response
                4. Trigger a denial — show SPEND_LIMIT_EXCEEDED
                5. Show audit log — prove the chain is signed
                6. Run audit-verify-chain.ts — show tamper detection

20:00 - 35:00  Their integration. Help them wire CERNIQ into their actual codebase.
                For LangChain: use CerniqCallbackHandler
                For Express: use verifyRequest() middleware
                For MCP: use mcp-bridge wrap()

35:00 - 50:00  Policy design workshop. Map their actual use cases to CERNIQ scopes.
                "What actions should an agent NEVER take without a limit?"
                "What's the worst-case scenario if an agent goes rogue?"
                Document their scope names for the SDK.

50:00 - 60:00  Feedback + roadmap preview.
                "What would make you pay $200/month for this?"
                Preview Phase 2: multi-agent delegation, enterprise SSO, webhooks
```

### 5.3 Post-Call Actions (within 24h)

```bash
# 1. Add them to Slack channel
# 2. Create their production principal (if not already done)
# 3. Send call summary email with:
#    - Their policy config as a code snippet
#    - Link to their specific quickstart (TS or Python)
#    - Direct line: "ping me on Slack if anything breaks"
# 4. Log feedback in OPERATOR_DECISIONS.md under "Design Partner Feedback"
# 5. File any P0 issues on GitHub with label: design-partner
```

---

## 6. Self-Serve Activation Flow

For Tier B developers who don't get a call:

### 6.1 Dashboard Onboarding Widget

The dashboard shows `PrincipalOnboarding` state as a checklist. Each incomplete step has a "Do this now →" button:

```
✅ Account created
☐ Register your first agent          → [Copy CLI command]
☐ Attach a policy                    → [Open policy wizard]
☐ Make your first verify call        → [Copy curl snippet]
☐ See your first denial              → [Try spend limit demo]
☐ Configure production keys          → [KMS setup guide]
☐ Set up webhooks                    → [Webhook docs]
```

### 6.2 CLI Doctor Command

New users should run this first:

```bash
$ cerniq doctor

✅ CLI version: 0.4.0 (latest)
✅ API reachable: https://api.cerniqapp.com/health → 200 OK (47ms)
✅ Auth: principal abc123 (erwin@cerniqapp.com)
✅ Default agent: agent_xyz (ACTIVE, VERIFIED band, score 823)
⚠️  No webhook configured: revocation events won't be received
⚠️  Production keys: using env var (recommend KMS for production)
❌ No policies attached to default agent
   → Run: cerniq policy apply --agent agent_xyz --scope payment:write --limit 1000

Run "cerniq doctor --fix" to auto-remediate warnings.
```

---

## 7. Feedback Collection

### 7.1 In-Product Feedback

Every Dashboard page has a "Feedback" button (bottom right). Routes to a Tally/Typeform form. Fields:

```
1. What are you trying to do? (free text)
2. How hard was it? (1-5 stars)
3. What would have made it easier? (free text)
4. Can we follow up? (Yes/No + email)
```

All responses land in `#feedback-inbox` Slack channel. Erwin triages daily.

### 7.2 Weekly Beta Digest

Every Monday, run:

```bash
# Pull last week's activation metrics
psql $DATABASE_URL -c "
  SELECT
    DATE_TRUNC('week', p.\"createdAt\") AS week,
    COUNT(DISTINCT p.id) AS new_principals,
    COUNT(DISTINCT CASE WHEN po.\"hasFirstVerify\" THEN p.id END) AS activated,
    COUNT(DISTINCT ae.\"principalId\") AS weekly_active
  FROM \"Principal\" p
  LEFT JOIN \"PrincipalOnboarding\" po ON po.\"principalId\" = p.id
  LEFT JOIN \"AuditEvent\" ae ON ae.\"principalId\" = p.id
    AND ae.\"createdAt\" > NOW() - INTERVAL '7 days'
  WHERE p.\"createdAt\" > NOW() - INTERVAL '30 days'
  GROUP BY 1 ORDER BY 1 DESC;
"
```

Post digest to `#growth` Slack channel. Include:

- New signups this week
- Activation rate (first verify / total signups)
- Top error codes from audit log
- Any user-reported P0 bugs

### 7.3 NPS Collection

At Day 14, send NPS email (Loops automation):

```
Subject: Quick question from the CERNIQ founder

Hi [Name],

CERNIQ has been running your agents for 2 weeks now.

One question: On a scale of 0-10, how likely are you to recommend
CERNIQ to a friend or colleague building AI agents?

[0] [1] [2] [3] [4] [5] [6] [7] [8] [9] [10]

(Takes 10 seconds. Genuinely shapes what we build next.)

— Erwin
```

Detractors (0-6): Personal email from Erwin within 24h. "What would it take to get to a 9?"
Promoters (9-10): "Would you be willing to write 2 sentences about CERNIQ for our site?"

---

## 8. Support Escalation Matrix

| Issue Type                    | Severity | Response Time | Owner            | Channel                |
| ----------------------------- | -------- | ------------- | ---------------- | ---------------------- |
| API completely down           | P0       | 5 min         | On-call engineer | PagerDuty → #incidents |
| Verify returning wrong result | P0       | 15 min        | On-call engineer | #incidents             |
| User can't register agent     | P1       | 1 hour        | Engineering      | #beta-support          |
| Docs wrong / misleading       | P1       | 4 hours       | DRI              | GitHub Issue           |
| SDK bug (blocks integration)  | P1       | 4 hours       | SDK owner        | GitHub Issue           |
| Feature request               | P2       | 24 hours      | PM               | #feedback-inbox        |
| General question              | P3       | 48 hours      | Anyone           | Discord / email        |

### 8.1 User-Facing Status

Keep `cerniqstatus.io` (or Instatus page) updated. Post to it for any P0/P1 incident.

### 8.2 Escalation Path

```
User reports issue
  → Erwin triages (within 2h during business hours)
  → If infra/security: create incident in #incidents
  → If SDK/docs: file GitHub Issue, assign sprint
  → If policy/UX question: personal reply + add to FAQ
  → If repeated question (3+ users): add to docs, link in Discord
```

---

## 9. First $500 MRR Gate

Gate criteria before upgrading any user to a paid plan:

```
[ ] Stripe billing fully wired (G-2 gap — see WORK_BOARD.md)
[ ] Pricing page live at cerniqapp.com/pricing
[ ] Plan limits enforced at verify level (FREE: 10K/month, PRO: 1M/month)
[ ] Invoice generation tested end-to-end
[ ] Churn webhook handled (downgrade to FREE on failed payment)
[ ] At least 3 design partners verbally committed to paying
```

### 9.1 Suggested Pricing (Phase 1)

| Plan           | Price      | Limit                           | Features                                |
| -------------- | ---------- | ------------------------------- | --------------------------------------- |
| **Free**       | $0         | 10K verifies/month, 10 req/sec  | 1 principal, community support          |
| **Developer**  | $49/month  | 500K verifies/month, 50 req/sec | 5 agents, email support                 |
| **Pro**        | $199/month | 5M verifies/month, 500 req/sec  | Unlimited agents, SLA, webhooks         |
| **Enterprise** | Custom     | Unlimited                       | Custom SLA, KMS, DPA, dedicated support |

These are not finalized — see OD-003 (OPERATOR_DECISIONS.md).

---

## 10. Common Beta Failure Modes & Fixes

### "I get INVALID_SIGNATURE on every call"

**Cause 95% of the time:** Agent was registered with a public key, but the JWT is being signed by a different key.

**Fix:**

```bash
# 1. Confirm which key the agent has
cerniq agents get --id agent_xyz --show-public-key

# 2. Confirm what key your SDK is using
# In TypeScript:
const agent = await cerniq.agents.get('agent_xyz');
console.log(agent.publicKey); // should match

# 3. If mismatch, re-register the agent
cerniq agents rotate-key --id agent_xyz
```

### "My SPEND_LIMIT_EXCEEDED denial fires too soon"

**Cause:** Policy spend limit set in wrong currency, or daily vs per-call confusion.

**Fix:**

```bash
# Check the policy
cerniq policy get --agent agent_xyz

# If limit is "1000 USD per day" but you're spending 100 per call:
# 10 calls = $1,000 → hits limit on call 10. That's correct.
# If you want $1,000 per CALL, set callLimit: 1000.
```

### "Trust score is very low (WATCH band, score 210)"

**Cause:** New agent has no behavioral history. BATE AGE_COHORT gives +0.5/day up to +100.

**Fix:** Normal — score will rise naturally. To accelerate:

```bash
# 1. Make diverse verify calls across different scopes
# 2. Ensure calls come from consistent IPs (R-2 geo rule)
# 3. Avoid rapid-fire calls in bursts (R-1 velocity rule)
# 4. After 7+ distinct active days, AGE_COHORT bonus kicks in fully
```

### "Audit log shows AGENT_NOT_FOUND but agent exists"

**Cause:** Token was signed with agent ID that doesn't match. Or wrong `principalId` in the API key.

**Fix:**

```bash
# Confirm agent belongs to your principal
cerniq agents list | grep agent_xyz

# Confirm your API key is for the right principal
cerniq auth whoami

# If they don't match, you're using the wrong API key.
```

### "Webhook not receiving events"

**Cause:** Either no webhook configured, or webhook URL isn't publicly reachable.

**Fix:**

```bash
# 1. Check webhook config
cerniq webhooks list

# 2. If using localhost for development, use ngrok:
ngrok http 3000
cerniq webhooks create --url https://xxxx.ngrok.io/webhooks/cerniq --events agent.revoked

# 3. Verify HMAC signature in your handler:
const sig = req.headers['x-cerniq-signature'];
const expected = createHmac('sha256', process.env.CERNIQ_WEBHOOK_SECRET)
  .update(req.rawBody).digest('hex');
if (sig !== expected) throw new Error('Invalid signature');
```

---

## 11. Beta Graduation Criteria

A beta user "graduates" to production when:

```
[ ] hasFirstVerify = true
[ ] hasFirstDenial = true (they've seen a policy work)
[ ] has ≥ 7 days of verify activity
[ ] No P0 support issues in last 7 days
[ ] NPS response collected (even if score is low)
[ ] On paid plan OR explicitly confirmed free tier is sufficient
```

At graduation: send "You're officially a production CERNIQ user" email + Discord badge.

---

## 12. Feedback → Roadmap Pipeline

1. All feedback lands in `#feedback-inbox`.
2. Every Sunday, Erwin reviews and tags each item: `feature-request`, `bug`, `docs`, `pricing`, `integration`.
3. Items tagged `feature-request` with ≥3 independent reports → filed as `OD-XXX` in `OPERATOR_DECISIONS.md`.
4. Monthly: review ODs against Phase 2 plan. Update `WORK_BOARD.md` with new modules based on top requests.

**Priority rules:**

- Security bug → P0, fix before any new feature.
- "I can't complete my integration" → P1, fix within 1 sprint.
- "I wish X existed" → backlog, unless ≥3 design partners want it.
- "X would be nice" → maybe, add to Phase 2 wish list.

---

_Runbook version: 1.0 | CERNIQ Phase 1 Beta_  
_Last updated: 2026-05-04_  
_Next review: after first 50 users onboarded_
