# OKORO — EU Data Residency & AI Act compliance

> Purpose: spell out how OKORO handles agent data for European principals,
> what the EU AI Act requires of us as an upstream identity provider, and
> what data flows are explicitly **forbidden** to cross the Atlantic.

**Status**: Draft v1. To be reviewed with Erwin's GDPR/AI Act counsel
before any EU customer goes live. Not a substitute for legal review.

---

## 1. Why this matters for OKORO

OKORO is positioned as a *neutral verification rail*. That positioning
collapses if a European bank, merchant, or cooperative cannot use OKORO
because we route their agent metadata through US infrastructure. EU
residency is therefore an enterprise-tier blocker AND a long-term
differentiator vs. Auth0/Stripe.

### EU AI Act articles that touch OKORO

| Article | What it requires | OKORO impact |
|---|---|---|
| Art. 50 §1 | AI systems that interact with humans must be designed so the human is informed of the interaction | OKORO audit log can serve as evidence of bot-disclosure timing |
| Art. 50 §2 | Synthetic content must be machine-detectable | Out of scope for OKORO |
| Art. 50 §3 | Deep-fake disclosure | Out of scope |
| Art. 52 | Transparency obligations for general-purpose AI | Indirect — relying parties using OKORO may rely on OKORO records to satisfy Art. 52 logging |
| Art. 60 (registry) | High-risk AI systems must register | Some OKORO *customers* (financial-services agents) qualify; OKORO-the-product likely does not, but is contributing to its customers' registry obligations |

### GDPR articles that touch OKORO

| Article | Requirement | OKORO posture |
|---|---|---|
| Art. 5 (data minimisation) | Process only what's needed | OKORO holds *only* public keys + transaction metadata. No private keys, no PII beyond email. |
| Art. 17 (right to erasure) | Delete on request | Hard problem with append-only audit chain — see § 4 below. |
| Art. 25 (privacy by design) | Engineer for privacy from the start | Captured in `docs/decisions/0002-non-custodial-key-policy.md` |
| Art. 28 (processor agreements) | DPA with sub-processors | Required: Railway, Cloudflare, Stripe, Datadog when EU customer data flows through them |
| Art. 30 (records of processing) | Maintain processing records | The audit chain plus the principal CRUD log satisfies this for OKORO's own processing |
| Art. 33 (breach notification) | 72-hour notification | RUNBOOK § 9 postmortem template + a customer-facing breach playbook (TBD) |
| Art. 44–49 (cross-border transfer) | Adequacy / SCCs / transfer impact assessment | The EU residency design below ensures EU agent data does not cross to US infrastructure |

## 2. Two-region design

| Region | Surface | Data store | Hosting |
|---|---|---|---|
| **US** (default) | `api.okorolabs.io` | Postgres `us-east-1` (Railway), Redis `us-east-1`, BullMQ `us-east-1` | Railway US |
| **EU** | `api.eu.okorolabs.io` | Postgres `eu-central-1` (Railway), Redis `eu-central-1`, BullMQ `eu-central-1` | Railway EU |
| **Edge** (Phase 3) | Cloudflare Workers global | KV trust score cache (regional) | Cloudflare |

**Routing rule**: a principal's region is set at registration (`region: 'US' | 'EU'`). All data for that principal — agents, policies, audit events, BATE signals, webhook deliveries — lives exclusively in that region's plane. Cross-region reads are forbidden.

**SDK behavior**: `@okoro/sdk` and `okoro` (Python) accept `baseUrl`. EU customers point at `api.eu.okorolabs.io`; the rest of the API is identical.

## 3. What can never leave the EU plane

- Audit events for EU principals
- BATE signals for EU agents
- Webhook payloads sent to EU customers (which contain agent IDs / scores)
- Public keys (technically not personal data, but easier policy: keep them home)
- API key prefixes (visible in dashboards but co-located with keys)

## 4. The append-only audit log vs Art. 17 (right to erasure)

This is the hard one. GDPR Art. 17 requires erasure on request. The OKORO audit chain is, by design, append-only and signed — *deleting* an event breaks the chain.

### The plan

1. **Tombstone, don't delete.** A subject access request that demands erasure produces an "erasure tombstone" event in the chain (signed, like every other event) that nullifies the original event's PII while preserving the chain's hash continuity. Tombstones replace the original event's `principalEmail` and any free-text fields with a sha256 of the original value, so re-association is impossible without the salt held in the erasure record (which itself becomes the cryptographic proof of the erasure request).

2. **Email is the only routinely-personal field.** Agent IDs, public keys, policy IDs are pseudonymous — they're cryptographically derived. They don't fall under GDPR personal data unless paired with a name/email.

3. **Erasure request workflow** (manual in v1, automated by Phase 2):
   - Customer files a DSAR via `gdpr@okorolabs.io`.
   - On-call verifies identity (matching API key principal_id + email).
   - Operator runs `pnpm --filter @okoro/api gdpr:erase --principalId p_xxx`.
   - Script writes erasure tombstones, hashes PII fields, retains the cryptographic skeleton for audit-chain integrity.
   - Within 30 days (Art. 12 §3 default), respond to the customer with proof of completion.

### What this rules out

- Single-table audit storage with simple `DELETE WHERE`. The chain breaks the moment you do that.
- Redacting via `UPDATE`. Same reason.
- Pretending the audit log is "just logs" — we treat it as a record-of-processing under Art. 30.

## 5. Sub-processor list (EU plane)

| Sub-processor | Purpose | Region | DPA |
|---|---|---|---|
| Railway | Postgres + Redis hosting | `eu-west-1` (Ireland) | TBD before EU GA |
| Cloudflare | Edge / WAF / KV (Phase 3) | global; pinned to EU for EU principals via routing rules | Cloudflare standard DPA |
| Stripe | Billing | EU billing entity | Stripe DPA |
| Sentry (optional) | Error monitoring | EU plane | Sentry DPA |

Sub-processor changes are notified to enterprise customers 30 days in advance.

## 6. SDK & dashboard implications

- **Dashboard** must let principals see and update their region (only at creation; switching mid-life is forbidden in v1).
- **SDK** quickstart docs show both `https://api.okorolabs.io/v1` and `https://api.eu.okorolabs.io/v1` examples.
- **Docs site** has a region picker that updates code snippets.

## 7. Open questions for legal review

- Does OKORO qualify as a "high-risk AI system" component under Annex III? Probably not — we're an identity rail, not a decision-making system. But the boundary case is when BATE's anomaly flagging effectively *blocks* an agent from a relying party. Document this.
- What's the right Schrems II analysis for US Cloudflare KV holding pseudonymous (agent ID) data? Likely fine since no PII, but worth documenting.
- Does the audit-chain *signing key* itself constitute personal data when bound to a specific person's verified identity? Edge case; lean toward "no" because it's pseudonymous.

## 8. What ships in v1 (origin only)

EU residency is a Phase 2.5 deliverable — between Phase 2 (BATE) and Phase 3 (edge). Until then, **OKORO is US-only**. EU principals are accepted but data lands in US-east-1. Disclose prominently:
- ToS / DPA boilerplate
- Dashboard banner during signup if browser locale is EU
- README

This is the responsible position for v1: don't lie about what we offer.

## 9. References

- [EU AI Act (Regulation (EU) 2024/1689)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
- [GDPR (Regulation (EU) 2016/679)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Schrems II ruling (CJEU C-311/18)](https://curia.europa.eu/juris/document/document.jsf?docid=228677)
- OKORO internal: `docs/SECURITY.md` § 3 (cryptographic choices that minimize EU compliance scope)
