# LAUNCH — Enterprise-quality gates

> Complement to [`LAUNCH.md`](LAUNCH.md) and [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md).
> LAUNCH.md sequences the deploy. PRODUCTION_CHECKLIST is the engineering gate.
> **This file** is what makes the launch *enterprise-quality* vs *MVP-shipped* — the non-engineering surfaces a Fortune-500 prospect's security/legal team will probe in their first week.

## Why "enterprise quality" is more than green CI

You can have 0 critical CVEs, 17 typecheck-clean workspaces, p99 17ms, and *still* lose a $500K deal because:
- There's no public security disclosure address.
- The status page is "just trust us"
- The DPA template doesn't exist when GC asks for it
- "Who do we call at 2am?" has no answer

These rows are the gap. Most are 1-2 hours of work apiece, not weeks.

---

## A. Trust posture (customer-visible)

| # | Gate | Status | Owner | How to verify |
| - | --- | --- | --- | --- |
| A.1 | `cerniq.io/privacy` live | ☐ | operator | `curl -fsS https://cerniq.io/privacy` returns 200 with current text |
| A.2 | `cerniq.io/terms` live | ☐ | operator | same |
| A.3 | `cerniq.io/.well-known/security.txt` per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116.html) | ☐ | operator | `curl https://cerniq.io/.well-known/security.txt` returns Contact, Expires, Preferred-Languages |
| A.4 | `cerniq.io/security` posture page (links to threat model summary, SOC2 roadmap, KMS posture, encryption-in-transit + at-rest claims) | ☐ | operator | manual review — must match `docs/SECURITY.md` |
| A.5 | `cerniq.io/trust` page or trust portal (status, DPA, sub-processors, audit reports) | ☐ | operator | manual review |
| A.6 | `status.cerniq.io` reachable; reflects API health | ☐ | operator (OD-007 decision) | reads `incidents.{open,history}.json` from API per OD-007 default |
| A.7 | DPA template ready for EU/UK enterprise prospects | ☐ | operator + legal | based on existing audit-redaction capability (ADR-0006) |
| A.8 | Sub-processors list published | ☐ | operator | derived from `docs/COMPLIANCE_BUNDLE.md` — must list Railway, Vercel, Stripe, Auth0, any KMS provider, any analytics |

> Template starters in [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) and [`docs/COMPLIANCE_BUNDLE.md`](docs/COMPLIANCE_BUNDLE.md). The threat model lives at [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

---

## B. Crisis readiness

| # | Gate | Status | Owner | How to verify |
| - | --- | --- | --- | --- |
| B.1 | On-call rotation defined for D-0 to D+7 (operator is reachable 24×7 or has a backup) | ☐ | operator | written rotation; PagerDuty / on-call calendar |
| B.2 | Slack `#incidents` channel exists with `SLACK_INCIDENT_WEBHOOK` plumbed | ☐ | operator | inbound webhook test fires a message |
| B.3 | `security@cerniq.io` mailbox monitored | ☐ | operator | send a test report; auto-acknowledge in <1h |
| B.4 | `incidents@cerniq.io` mailbox monitored | ☐ | operator | same |
| B.5 | DR runbook (`docs/DR_RUNBOOK.md`) tested in a tabletop within 30 days | ☐ | operator | dated entry in `docs/SESSION_HANDOFF.md` |
| B.6 | Rollback path rehearsed for each surface | ☐ | engineering | dry-run `railway rollback` and `vercel promote` against a staging deploy |
| B.7 | Backup restore tested against a staging Postgres in last 30 days | ☐ | operator | dated entry per OD-009 follow-up |
| B.8 | Public incident communication template drafted | ☐ | operator | template lives at `docs/INCIDENT_COMMS_TEMPLATE.md` (author if missing) |

---

## C. Customer-facing observability

| # | Gate | Status | Owner | How to verify |
| - | --- | --- | --- | --- |
| C.1 | `GET /v1/health` returns 200 publicly (no auth) | ☐ | covered by smoke | `scripts/launch-smoke.sh api` |
| C.2 | `GET /v1/health/version` returns `version`, `gitSha`, `buildAt` | ☐ | covered by smoke | same |
| C.3 | `GET /.well-known/audit-signing-key` returns Ed25519 JWK | ☐ | covered by smoke | same |
| C.4 | `GET /.well-known/pricing.json` returns current ladder | ☐ | covered by smoke | same |
| C.5 | OpenAPI spec at `https://api.cerniq.io/v1/openapi.json` (or doc URL) | ☐ | engineering | matches `docs/spec/CERNIQ_API_SPEC.yaml` |
| C.6 | Prometheus metrics endpoint authenticated and documented | ☐ | engineering | `curl /metrics -H Authorization: Bearer $METRICS_TOKEN` |
| C.7 | Customer-facing status page renders red/yellow/green per surface | ☐ | operator (OD-007) | per A.6 |

---

## D. Legal + contractual

| # | Gate | Status | Owner | How to verify |
| - | --- | --- | --- | --- |
| D.1 | Privacy policy reviewed by counsel (or formal "self-attestation" if pre-counsel) | ☐ | operator + counsel | dated review trail |
| D.2 | Terms of service reviewed by counsel | ☐ | operator + counsel | same |
| D.3 | Master Subscription Agreement (MSA) ready | ☐ | operator | template, even if minimal |
| D.4 | DPA template GDPR Art. 28 ready (per A.7) | ☐ | operator | template aligned to `docs/COMPLIANCE_BUNDLE.md` |
| D.5 | Acceptable Use Policy ready | ☐ | operator | covers agent-driven actions, abuse, rate limits |
| D.6 | Open-source license notice (`NOTICE.md`) up to date | ☐ | engineering | `NOTICE.md` in repo root reflects current deps |
| D.7 | Trademark, copyright assertions on every customer-visible surface | ☐ | operator | footer on docs.cerniq.io, app.cerniq.io |

---

## E. Audit-readiness (SOC2 trajectory)

These are not required for launch but ARE required for the first enterprise customer's vendor review. They're table-stakes asks within 90 days of GA.

| # | Gate | Status | Owner |
| - | --- | --- | --- |
| E.1 | Audit chain integrity workflow runs on cron and reports green | ☐ | engineering |
| E.2 | Access reviews documented (who has Railway/Vercel/Stripe/AWS access) | ☐ | operator |
| E.3 | Vendor list with risk ratings (Railway, Vercel, Stripe, Auth0, Sentry, etc.) | ☐ | operator |
| E.4 | Background-check policy (if any employees beyond operator) | ☐ | operator |
| E.5 | Code review policy: every prod change goes through PR + review | ☐ | engineering — codified in branch protection rules |
| E.6 | Secrets management policy: keys never on disk outside of provider stores | ☐ | engineering + operator |
| E.7 | Incident retrospective template in `docs/incidents/` | ☐ | engineering |
| E.8 | Quarterly key rotation per `infra/kms/rotation-runbook.md` scheduled | ☐ | operator |

---

## F. Communications

| # | Gate | Status | Owner |
| - | --- | --- | --- |
| F.1 | Launch announcement post drafted (blog at cerniq.io/blog/launch) | ☐ | operator |
| F.2 | Twitter / LinkedIn post drafted | ☐ | operator |
| F.3 | Show HN / Product Hunt draft (optional) | ☐ | operator |
| F.4 | Customer-direct email to existing waitlist (if any) | ☐ | operator |
| F.5 | Beta customer template message ready (per `docs/BETA_ONBOARDING_RUNBOOK.md`) | ☐ | operator |
| F.6 | Press inquiry handler — `press@cerniq.io` monitored | ☐ | operator |

---

## G. Brand + design (post the "cerniq.io is live" milestone)

| # | Gate | Status | Owner |
| - | --- | --- | --- |
| G.1 | Favicon, OG images, Twitter card on cerniq.io | ☐ | operator |
| G.2 | Brand guidelines reachable internally (skill `brand-voice` ready in this repo) | ☐ | operator |
| G.3 | Logo files (SVG, PNG, dark/light) in `brand/` | ☐ | operator |

`brand/` exists in this repo per the tree — verify contents during pre-launch.

---

## H. Internal — finance & ops

| # | Gate | Status | Owner |
| - | --- | --- | --- |
| H.1 | Stripe live mode activated + bank account verified | ☐ | operator |
| H.2 | Sales-tax handling decided (Stripe Tax on/off) | ☐ | operator |
| H.3 | Invoicing flow for Enterprise tier defined | ☐ | operator |
| H.4 | Refund policy documented (24h refund window per OD-003?) | ☐ | operator |
| H.5 | Internal financial dashboard (Stripe, AWS, Railway, Vercel monthly spend) | ☐ | operator |

---

## I. Cross-cutting drift to close

Aggregated from the audit work in this branch (`feat/launch-readiness`):

| # | Issue | File | Severity |
| - | --- | --- | --- |
| I.1 | `STRIPE_PRICE_SCALE` missing from `apps/api/src/config/config.schema.ts` | `apps/api/src/config/config.schema.ts` | **launch-blocking** |
| I.2 | Dashboard reads both `CERNIQ_API_URL` and `CERNIQ_API_BASE_URL` | `apps/dashboard/` | low |
| I.3 | API direct `process.env` reads bypass Zod validation | `apps/api/src/` | medium |
| I.4 | `infra/railway/api.service.json` references legacy `AUDIT_ED25519_*` names | `infra/railway/api.service.json` | low (both names accepted at boot) |
| I.5 | `.changeset/config.json` missing `@cerniq/verifier-rp`, `@cerniq/mcp-*` in linked set | `.changeset/config.json` | medium (delays clean lockstep publishes) |
| I.6 | `.github/workflows/release.yml` only builds `@cerniq/types` + `@cerniq/sdk` | `.github/workflows/release.yml` | medium |
| I.7 | No `release-sdk-py.yml` for PyPI | (missing) | medium |
| I.8 | No `release-cli.yml` for goreleaser | (missing) | medium |
| I.9 | `docs.cerniq.io` subdomain not yet deployed (OD-022) | DNS + Vercel | medium |
| I.10 | Auth0 v4 SDK not yet installed in `apps/dashboard` | `apps/dashboard/package.json` | **launch-blocking** if per-user login is required for v1 |

I.1 is the only definite engineering-blocking item; the rest are either documentation/decision items or accepted-known gaps.

---

## J. Sign-off

```text
A. Trust posture:      ☐ all checked
B. Crisis readiness:   ☐ all checked
C. Customer observability: ☐ all checked
D. Legal:              ☐ all checked
E. Audit-readiness:    ☐ ≥6/8 checked (E is 90-day target, not launch-day blocker)
F. Communications:     ☐ ≥4/6 checked
G. Brand:              ☐ all checked
H. Finance + ops:      ☐ all checked
I. Drift closed:       ☐ I.1 + I.10 closed; I.5–I.8 can defer if not publishing day-1

Engineering lead:     _______________   Date: ___________
Operator (Erwin):     _______________   Date: ___________
```

When this AND `LAUNCH.md` §10 AND `docs/PRODUCTION_CHECKLIST.md` all show green, you are enterprise-launch-ready.
