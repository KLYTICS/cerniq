---
title: CERNIQ for security engineers
audience: app-sec, infra-sec, AI-security teams reviewing CERNIQ as a control
last-reviewed: 2026-05-02
---

# CERNIQ for security engineers — what's enforced and what isn't

CERNIQ is a _cryptographic gate_ for agent actions. It supplies what an
identity / authorization / audit substrate should: per-agent identity
rooted in Ed25519, scoped policy as signed JWT, append-only audit chain
signed by CERNIQ, and a behavioral trust score that the relying party
sets thresholds against. Nothing else.

## What CERNIQ enforces

- **Identity is cryptographic, not asserted.** Every agent's private
  key lives client-side; CERNIQ holds only the public key. A compromised
  CERNIQ database does not compromise agents.
- **Policy is bounded and revocable.** Policies are signed JWTs with
  scope, spend cap, domain allow-list, TTL. Revocation is immediate
  via Redis-backed revocation cache — a relying party verifying online
  sees revocation in <1s.
- **Denial precedence is fixed.** The 9 reasons (CLAUDE.md invariant 6) are ordered so RPs always get the _most-restrictive_ reason on
  any request that fails multiple checks. Operators learn one ladder.
- **Audit is append-only and signed.** Hash-chained, CERNIQ-signed,
  exportable as NDJSON for SOC2 / FINRA / COSSEC evidence. Tamper
  detection is a unit test (`audit-chain.util.spec.ts`).
- **Spend is atomic.** Redis `INCRBY` with Lua-fallback ensures no
  TOCTOU race between two concurrent verify calls under the same
  policy spend cap.

## What CERNIQ does NOT enforce

These are explicit non-goals (see `CLAUDE.md` and
`docs/CERNIQ_AS_BACKBONE.md` § 8):

- **Agent runtime.** CERNIQ does not invoke LLMs, evaluate prompts, or
  inspect tool calls beyond the verify shape. Agent runtime security
  is the relying party's responsibility.
- **Network-layer protection.** CERNIQ is L7 only. Run your relying
  party behind a WAF / rate-limiter; CERNIQ's throttler protects CERNIQ
  itself, not the RP.
- **Data plane.** CERNIQ does not see the actual data the agent acts
  on. A successful `verify` says "this agent was authorized for this
  shape of action"; it does not say "this transaction is correct."
- **Anomaly detection beyond rules-based v1.** ML anomaly detection
  ships in M-020 (post-Phase 1). Until then, BATE is rule-based:
  velocity, geographic, spend pattern, failed-verify spike.

## Threat model

Read in this order:

1. `docs/THREAT_MODEL_v2.md` — 13 sections, full STRIDE table (31
   threats), 4-party trust model. Replaces v1.
2. `docs/ARCHITECTURE_AUDIT.md` — 22 findings, 1 Critical / 5 High /
   8 Medium / 6 Low / 2 Info, mapped to module IDs.
3. `docs/SECURITY.md` § Denial Precedence + § Key Handling.
4. `docs/SECURITY_RUNBOOK.md` (peer-shipped 2026-05-02) — incident
   response: key rotation, secret leak, audit chain breach.

## Crypto contract

- **One curve, one library.** Ed25519 (stdlib) + `jose` (TS) /
  `go-jose` (Go) / `python-jose` (Py). No alternates, no homegrown
  signing.
- **No private keys in CERNIQ.** This is invariant 1. The dashboard
  cannot show one because none exists server-side.
- **JWKS at `/.well-known/jwks.json`** — always-on, public, cached
  for 1h. Supports RP offline verification when CERNIQ is briefly
  unreachable.
- **Key rotation:** ADR-0011 + `M-023` AwsKmsAdapter. The KMS-backed
  rotation lifecycle keeps `kid` history queryable for audit-chain
  re-verification of pre-rotation events.
- **Post-quantum readiness:** ADR-0013 hybrid scaffold. Flag-flip
  controlled by OD-008 (peer-reserved).

## Cross-tenant isolation

- Every query takes `principalId` as the first argument
  (CLAUDE.md invariant 5).
- Postgres RLS migration landed by peer 2026-05-02 — defense-in-depth
  at the storage layer regardless of application-layer correctness.
- Audit chain slicing per `principalId` for SOC2 evidence — a
  customer's auditor cannot read another customer's chain.

## Reporting a security issue

- Public issues: do **not** open a GitHub issue. Email
  security@cerniq.io with PGP-encrypted details.
- The default response window is 72 hours. Coordinated disclosure
  follows the 90-day standard.

## Reference

- `docs/THREAT_MODEL_v2.md`
- `docs/ARCHITECTURE_AUDIT.md`
- `docs/SECURITY.md`
- `docs/SECURITY_RUNBOOK.md`
- `docs/decisions/{0008..0013}-*.md` — the enterprise-backbone ADRs.
