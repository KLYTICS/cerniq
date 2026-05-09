# AEGIS — Compliance Bundle

> **Audience:** customer security reviewers, procurement legal,
> compliance officers, third-party auditors.
> **Classification:** PUBLIC · ENGINEERING
> **Last updated:** 2026-05-05
> **Distribution:** ship as-is to enterprise prospects under NDA.

This document maps AEGIS's product surfaces to the controls and
clauses that enterprise customers, regulators, and auditors actually
ask about. Each row points to the **evidence** — the file path, ADR,
endpoint, or runbook section that backs the claim.

---

## Table of contents

1. [SOC 2 Trust Services Criteria](#1-soc-2-trust-services-criteria)
2. [ISO/IEC 27001:2022 Annex A](#2-isoiec-270012022-annex-a)
3. [GDPR](#3-gdpr)
4. [PCI DSS (where applicable)](#4-pci-dss-where-applicable)
5. [EU AI Act](#5-eu-ai-act)
6. [NIST CSF 2.0 cross-reference](#6-nist-csf-20-cross-reference)
7. [How to use this document](#7-how-to-use-this-document)
8. [What AEGIS is NOT in scope for](#8-what-aegis-is-not-in-scope-for)

---

## 1. SOC 2 Trust Services Criteria

AEGIS targets **SOC 2 Type II** for the Security, Availability, and
Confidentiality TSCs. Privacy TSC is in scope for principals
processing PII; Processing Integrity is informational (the audit
chain is the artifact).

### Common Criteria (CC)

| Control | Title | AEGIS evidence |
|---------|-------|----------------|
| CC1.1 | Demonstrates commitment to integrity and ethical values | `docs/SECURITY.md`, `docs/THREAT_MODEL_v2.md` |
| CC2.1 | Internal communication of policies | `CLAUDE.md` (engineering invariants), `WORK_BOARD.md` (active tickets) |
| CC3.1 | Specifies suitable objectives | `docs/spec/01_MASTER.md` § thesis, `docs/MASTER_ENGINEERING_HANDOFF.md` |
| CC4.1 | Monitors performance against criteria | `docs/CAPACITY_PLAN.md` (SLA tables), `docs/INCIDENT_RUNBOOK.md` § 5 |
| CC5.1 | Selects and develops control activities | All ADRs (`docs/decisions/0001..0013`) |
| CC6.1 | Implements logical access controls | `apps/api/src/modules/auth/api-key.guard.ts`, `docs/SECURITY.md` § Auth |
| CC6.2 | Manages user authentication | `apps/api/src/modules/auth0/`, `idp-clerk/`, `idp-workos/` (3 IdP adapters) |
| CC6.3 | Restricts access based on role | API key scopes (FULL vs VERIFY_ONLY); RLS migrations on every tenant table |
| CC6.6 | Logical access boundaries | Multi-tenant isolation via `principalId` (CLAUDE.md invariant 5); RLS |
| CC6.7 | Restricts physical access | KMS provider's HSM (out-of-scope; inherited from AWS / GCP / Vault SOC 2) |
| CC6.8 | Protects against malicious software | `helmet` middleware, dependency pinning, `pnpm audit` in CI |
| CC7.1 | Detects events that could compromise the system | BATE engine — 5 anomaly rules + DPoP signal (`apps/api/src/modules/bate/bate.anomaly.ts`) |
| CC7.2 | Monitors system performance | Prometheus metrics + OTel traces; `metrics.service.ts`; `audit-chain-integrity.yml` nightly |
| CC7.3 | Evaluates security events | `docs/INCIDENT_RUNBOOK.md` § 1 (chain break) + § 3 (mass revoke) |
| CC7.4 | Responds to identified events | Same — incident runbook |
| CC7.5 | Recovery from identified events | DR scenarios in `docs/FAILURE_MODES.md` (4 cascading scenarios) |
| CC8.1 | Authorizes system changes | ADR process; PR review with code-reviewer agent; spec-sync.yml CI |
| CC9.1 | Identifies and mitigates risks | `docs/THREAT_MODEL_v2.md` (31 STRIDE threats) + `docs/ARCHITECTURE_AUDIT.md` (22 findings, all High / Crit closed) |
| CC9.2 | Manages vendors and third parties | KMS adapters (AWS / GCP / Vault) — vendor-neutral; IdP adapters — vendor-neutral |

### Additional Criteria — Availability (A)

| Control | Title | AEGIS evidence |
|---------|-------|----------------|
| A1.1 | Capacity demand is monitored and managed | `docs/CAPACITY_PLAN.md` (Little's Law sizing, p99 SLA) |
| A1.2 | Environmental protections | KMS HSM (inherited); region-failover plan in `docs/INCIDENT_RUNBOOK.md` § 8 |
| A1.3 | Recovery procedures tested | `docs/FAILURE_MODES.md` § DR — quarterly DR rehearsal (mandatory cadence) |

### Additional Criteria — Confidentiality (C)

| Control | Title | AEGIS evidence |
|---------|-------|----------------|
| C1.1 | Confidentially identified | Public keys only; private keys never enter AEGIS (CLAUDE.md invariant 1) |
| C1.2 | Confidentially protected | TLS 1.3 in transit; KMS-encrypted at rest; webhook secrets envelope-encrypted (round-12 peer's `webhook-secret-cipher.ts`) |

### Additional Criteria — Privacy (P)

| Control | Title | AEGIS evidence |
|---------|-------|----------------|
| P1.1 | Privacy notice | Public privacy policy (operator-supplied); `docs/RETENTION_POLICY.md` § 3 |
| P3.1 | Personal information collected lawfully | IdP federation; consent gathered upstream by Auth0 / Clerk / WorkOS |
| P5.1 | Personal information accessible by data subject | `GET /v1/me/onboarding`, dashboard self-service |
| P5.2 | Personal information correctable | Dashboard edit + audit row on every change |
| P6.1 | Personal information disposable | GDPR Art. 17 redaction (ADR-0006); `docs/INCIDENT_RUNBOOK.md` § 7 |

---

## 2. ISO/IEC 27001:2022 Annex A

The 2022 edition reorganized controls into 4 themes (Organizational,
People, Physical, Technological). The mapping below covers the 33
Technological controls and the relevant Organizational ones.

### Organizational controls (selected)

| Control | Title | AEGIS evidence |
|---------|-------|----------------|
| A.5.7 | Threat intelligence | BATE engine ingests fraud reports from RPs (`/v1/agents/:id/report`) |
| A.5.10 | Acceptable use of information assets | API ToS + per-key scopes |
| A.5.15 | Access control | API key guard + IdP federation; principal-scoped RLS |
| A.5.23 | Information security for use of cloud services | KMS adapters (AWS / GCP / Vault); region-locked deployments |
| A.5.30 | ICT readiness for business continuity | DR plan + quarterly rehearsal (`docs/FAILURE_MODES.md`) |
| A.5.34 | Privacy and protection of PII | GDPR Art. 17 (ADR-0006); region residency (`docs/EU_RESIDENCY.md`) |

### Technological controls

| Control | Title | AEGIS evidence |
|---------|-------|----------------|
| A.8.1 | User endpoint devices | N/A — AEGIS is a server product |
| A.8.2 | Privileged access rights | Admin endpoints gated by `X-AEGIS-Admin` token (separate from FULL keys) |
| A.8.3 | Information access restriction | Multi-tenant RLS + `principalId` on every query |
| A.8.4 | Access to source code | GitHub repo; CODEOWNERS; PR review |
| A.8.5 | Secure authentication | API keys bcrypt-hashed (`api-key.service.ts`); IdP federation |
| A.8.6 | Capacity management | `docs/CAPACITY_PLAN.md` |
| A.8.7 | Protection against malware | Helmet + CSP; image scanning in CI |
| A.8.8 | Management of technical vulnerabilities | `pnpm audit` + Dependabot + `docs/ARCHITECTURE_AUDIT.md` |
| A.8.9 | Configuration management | All env via Zod-validated `config.schema.ts`; no runtime config drift |
| A.8.10 | Information deletion | Redaction endpoint (ADR-0006); KMS shadow strategy (`docs/RETENTION_POLICY.md`) |
| A.8.11 | Data masking | Pino redact list (`req.headers.x-aegis-api-key` etc.) in `app.module.ts` |
| A.8.12 | Data leakage prevention | Same — log redaction; audit chain commits to hashes only |
| A.8.13 | Information backup | Postgres point-in-time recovery; KMS-shadow keys retained 7y |
| A.8.14 | Redundancy of information processing facilities | Multi-region readiness (`docs/INCIDENT_RUNBOOK.md` § 8) |
| A.8.15 | Logging | **Audit chain — tamper-evident, signed, third-party verifiable.** `packages/audit-verifier/` is the artifact |
| A.8.16 | Monitoring activities | Prometheus + OTel; BATE anomaly detector |
| A.8.17 | Clock synchronization | NTP at the host layer; ISO 8601 timestamps in payloads |
| A.8.18 | Use of privileged utility programs | `aegis` CLI scoped to ops actions; admin endpoints behind separate token |
| A.8.19 | Installation of software on operational systems | Container immutability; CI deploy only |
| A.8.20 | Networks security | TLS 1.3; CORS allowlist (`apps/api/src/common/security/cors-allowlist.ts`) |
| A.8.21 | Security of network services | Helmet; rate limiting (`@nestjs/throttler`); request body limits |
| A.8.22 | Segregation of networks | Per-tenant DB schemas (RLS) |
| A.8.23 | Web filtering | N/A |
| A.8.24 | Use of cryptography | Ed25519 only (CLAUDE.md mandate); `@noble/ed25519`; AES-256-GCM for webhook secrets |
| A.8.25 | Secure development life cycle | ADR process; PR review; spec-sync CI; threat model maintained |
| A.8.26 | Application security requirements | Zod schemas at every boundary; `noUncheckedIndexedAccess` |
| A.8.27 | Secure system architecture and engineering principles | `docs/ARCHITECTURE.md`; ADR portfolio |
| A.8.28 | Secure coding | `eslint.config.mjs`; CLAUDE.md quality bar; code-reviewer agent |
| A.8.29 | Security testing in development and acceptance | E2E test harness (15 suites); `tests/cross-package` |
| A.8.30 | Outsourced development | N/A (in-house) |
| A.8.31 | Separation of development, test and production environments | `NODE_ENV` enforced; separate Railway / Neon projects per env |
| A.8.32 | Change management | Git + ADRs; `docs/SESSION_HANDOFF.md` log |
| A.8.33 | Test information | Seed script + fixtures only; no prod data in dev/test |
| A.8.34 | Protection of information systems during audit testing | Read-only DB role for audit access |

---

## 3. GDPR

The GDPR requirements that touch AEGIS directly. Customers acting
as Data Controllers retain primary GDPR responsibility; AEGIS as
Data Processor (per the standard DPA shipped with enterprise
contracts) implements the controls below.

| Article | Title | AEGIS evidence |
|---------|-------|----------------|
| Art. 5 | Principles relating to processing | Lawfulness via API key consent; data minimization (only public keys, hashed PII); accuracy via audit chain |
| Art. 6 | Lawfulness of processing | Customer-supplied consent; AEGIS processes per contract |
| Art. 17 | Right to erasure ("right to be forgotten") | **ADR-0006 audit redactability.** Null PII columns, keep `*Hash` commitments + signature. Chain stays verifiable. Procedure in `docs/INCIDENT_RUNBOOK.md` § 7 |
| Art. 25 | Data protection by design and by default | Public-keys-only architecture; principal-scoped queries by default |
| Art. 28 | Processor obligations | DPA template (operator-supplied); subprocessor list |
| Art. 30 | Records of processing | The audit chain itself IS the record |
| Art. 32 | Security of processing | TLS 1.3, KMS HSM, Ed25519 signing, multi-tenant isolation, the full SOC 2 stack |
| Art. 33 | Notification of breach | `docs/INCIDENT_RUNBOOK.md` § 1 (chain break); 72-hour notification triggered by SEV-1 |
| Art. 35 | Data Protection Impact Assessment | `docs/THREAT_MODEL_v2.md` § 11 + `docs/RETENTION_POLICY.md` § 9 |
| Art. 44 | Cross-border transfers | EU residency mode (`docs/EU_RESIDENCY.md`) keeps EU principal data EU-local |

### Why the audit chain stays verifiable through GDPR erasure

The signed payload (`AuditChainPayload`) commits to **hashes** of the
PII fields, not the raw values. The DB stores raw + hash side-by-side.
Erasure nulls the raw column; the hash stays; the signature still
verifies because it was computed over the hash, not the raw value.

This is ADR-0006 in one sentence: **commit to the hash, redact the
raw, the chain stays valid**. `@aegis/audit-verifier` honors this:
its verification walks the chain using the persisted payload (with
hashes), so an exported NDJSON works regardless of whether the raw
PII is still present in the DB.

---

## 4. PCI DSS (where applicable)

**AEGIS is NOT in PCI scope by default.** AEGIS does not see, store,
process, or transmit cardholder data. The integration patterns in
`docs/INTEGRATION_PATTERNS.md` § 2-3 keep the PCI scope on the
customer's PSP side (Stripe / Adyen / etc.), not in AEGIS.

The controls below apply when an AEGIS deployment is bundled with
the customer's PCI environment (e.g. they ship our verifier inline
in their checkout). In that case AEGIS is in **PCI Zone B** at most.

| Requirement | Title | AEGIS evidence |
|-------------|-------|----------------|
| Req. 1 | Install and maintain network security controls | TLS 1.3; helmet; CORS allowlist |
| Req. 2 | Apply secure configurations | Zod-validated config; immutable containers |
| Req. 3 | Protect stored account data | **N/A — AEGIS does not store cardholder data.** SPTs / PSP tokens pass through; never persist |
| Req. 4 | Protect cardholder data with strong cryptography during transmission | TLS 1.3 at every hop |
| Req. 5 | Protect against malicious software | Image scanning in CI |
| Req. 6 | Develop and maintain secure systems | `CLAUDE.md` quality bar; ADR process |
| Req. 7 | Restrict access by business need | Multi-tenant RLS; per-key scopes |
| Req. 8 | Identify users and authenticate access | API keys bcrypt-hashed; IdP federation |
| Req. 9 | Restrict physical access | Inherited from cloud provider |
| Req. 10 | Log and monitor all access | **Tamper-evident audit chain — third-party verifiable** |
| Req. 11 | Test security regularly | E2E suite; quarterly DR rehearsal; pentest cadence |
| Req. 12 | Support information security with policies | `docs/SECURITY.md`; `CLAUDE.md` |

---

## 5. EU AI Act

AEGIS is **infrastructure** under the EU AI Act, not an AI system per
se (no model deployed by AEGIS makes safety-relevant decisions on
its own). Customers using AEGIS to gate their own AI agents inherit
specific obligations; AEGIS provides the evidence layer.

| Article | Title | AEGIS evidence |
|---------|-------|----------------|
| Art. 12 | Record-keeping | Audit chain captures every agent action; tamper-evident; verifiable for ≥ 6 years (configurable per `docs/RETENTION_POLICY.md`) |
| Art. 13 | Transparency to deployers | The 9-reason canonical denial precedence + the BATE score per agent are observable to the customer |
| Art. 14 | Human oversight | Trust-band thresholds + denial precedence enable override workflows; revocation is instant |
| Art. 15 | Accuracy, robustness, cybersecurity | Threat model + 5 anomaly rules + replay defence + KMS rotation |
| Art. 17 | Quality management system | ADR process; spec-sync CI; mandatory ADR for any invariant change |

For high-risk AI applications (Annex III), AEGIS supplies the
evidence layer that the customer's quality management system needs.
The customer remains the Provider / Deployer; AEGIS is the
"infrastructure for transparency" they integrate.

---

## 6. NIST CSF 2.0 cross-reference

For US customers / federal procurement.

| Function | Category | AEGIS coverage |
|----------|----------|----------------|
| Identify | Asset Management (ID.AM) | Per-tenant agent / policy / API-key inventory in dashboard |
| Identify | Risk Assessment (ID.RA) | `docs/THREAT_MODEL_v2.md` |
| Protect | Identity Management (PR.AA) | Ed25519 + IdP federation; bcrypt API keys |
| Protect | Data Security (PR.DS) | KMS HSM; TLS 1.3; envelope encryption |
| Protect | Platform Security (PR.PS) | Helmet + CSP + rate limit |
| Detect | Continuous Monitoring (DE.CM) | Prometheus + OTel + BATE anomaly + nightly chain integrity |
| Detect | Adverse Event Analysis (DE.AE) | BATE 5-rule detector |
| Respond | Incident Management (RS.MA) | `docs/INCIDENT_RUNBOOK.md` |
| Respond | Mitigation (RS.MI) | Mass-revoke endpoint; instant policy revocation |
| Recover | Incident Recovery (RC.RP) | `docs/FAILURE_MODES.md` § DR scenarios |
| Govern | Policy (GV.PO) | `CLAUDE.md` invariants; ADR portfolio |

---

## 7. How to use this document

**Customer security review path:**
1. Receive the customer's questionnaire (CAIQ, SIG, custom).
2. Map their questions to a row above. Most map directly.
3. Send them the row's AEGIS-evidence link as the answer.
4. For the 5–10% of questions the table doesn't cover, escalate to
   AEGIS engineering and add a row to this doc.

**Procurement / legal review path:**
1. Send this entire document under NDA.
2. Send the standard DPA + the BAA (if HIPAA in scope).
3. Send the most recent SOC 2 report (when available).

**Auditor review path:**
1. Send this document.
2. Provision a read-only DB role + a JWKS-pinned NDJSON export.
3. Show the auditor `npx @aegis/audit-verifier verify` running
   green against their export.

---

## 8. What AEGIS is NOT in scope for

Setting expectations explicitly so customers don't ask AEGIS to do
things AEGIS deliberately does not:

- **Card processing.** AEGIS gates agent identity, not payment auth.
  PCI Zone A stays with the PSP.
- **AML / sanctions screening.** Customer's compliance stack screens
  the transaction; AEGIS authorizes the agent making it.
- **HIPAA-protected health information.** Out of scope unless the
  customer adopts the HIPAA-readiness add-on (separately scoped BAA).
- **Anti-money laundering rules.** AEGIS is not a transaction-monitor.
- **The customer's own SOC 2.** AEGIS provides evidence; the
  customer's controls are the customer's own.
- **End-user authentication.** That's the IdP's job (Auth0 / Clerk /
  WorkOS); AEGIS handles the *agent* layer above the user layer.

---

*This document is generated and maintained alongside the codebase.
File a PR if any row's evidence link is wrong or stale.*
