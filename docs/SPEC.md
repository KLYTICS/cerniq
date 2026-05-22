# OKORO — Architectural Specification (Distilled)

> Source of truth: the OKORO internal master suite (5 docs, KLYTICS).
> This file is the engineering-relevant subset. When in doubt, the master suite wins.

---

## Mission

Provide neutral, platform-agnostic, ACP-compatible **identity, authorization, attestation, and audit** for AI
agents. Every agent-initiated action passes through OKORO. The verify endpoint is the entire architecture's
load-bearing surface; everything else is in service of getting it correct, fast, and auditable.

## Layered model

| Layer | Module | Responsibility |
| --- | --- | --- |
| L1 — Identity | `identity` | Per-agent Ed25519 keypair, principal binding, status (ACTIVE / SUSPENDED / REVOKED) |
| L2 — Policy | `policy` | Scoped, time-bounded permissions; instant revoke; OKORO-signed JWTs |
| L3 — BATE | `bate` | Trust score 0–1000, signal ingestion, scorer kernel, rule-based v1 / ML v2 |
| L4 — Audit | `audit` | Append-only OKORO-signed events; SOC2/FINRA/COSSEC export |

## Verify hot path (`POST /v1/verify`)

Implementation: [`apps/api/src/modules/verify/verify.service.ts`](../apps/api/src/modules/verify/verify.service.ts).

Latency budget:
- Phase 1 (origin only): **<200 ms p99**
- Phase 3 (Cloudflare Workers edge): **<80 ms p99 globally**

Step ordering (deviation = security regression):

1. Decode token shape (no DB hit).
2. Load agent (Redis 60 s → Postgres). Reject if missing or revoked.
3. Verify Ed25519 signature against agent public key.
4. Load policy (Redis 30 s → Postgres). Reject if expired/revoked.
5. Scope check (`action.split('.')[0]`).
6. Domain allow-list.
7. Spend limits (Redis counters, atomic incrBy).
8. Trust score read (precomputed on agent record).
9. Spend record / audit / BATE signal: **fire-and-forget, never block the response**.

Failure modes:
- **Redis miss**: degrades to a Postgres query each (~10 ms RTT).
- **Redis outage**: agent/policy queries still work; spend tracking falls back to durable Postgres aggregates (alarming threshold tracked in backlog).
- **Postgres outage**: `/health/ready` reports degraded. Edge cache at CF Workers (Phase 3) keeps a 30 s "valid" window.

## Token formats

### Agent → Relying-party token (per-request, signed by agent)

Compact JWT, EdDSA / Ed25519. Short TTL (≤ 60 s).
```
header.payload.signature
{ alg: 'EdDSA', typ: 'JWT' }
{
  sub: agentId,
  pid: policyId,
  act: 'commerce.purchase',
  amt: 347.0,
  cur: 'USD',
  dom: 'delta.com',
  iat, exp, jti
}
```

### Policy capability token (issued by OKORO, signed by OKORO Ed25519)

Returned at policy creation. Lets relying parties verify offline that OKORO issued the policy. Same JWT shape; payload includes `scopes[]` and `label`.

### Audit record signature

Ed25519, OKORO-held (separate keypair from the policy-signing key). Public key at `GET /v1/.well-known/jwks.json` (and `GET /v1/.well-known/audit-signing-key` as a single-key convenience endpoint). Rationale: `docs/THREAT_MODEL_v2.md` § 4.2.

## Trust band cutoffs

| Band | Range | Treatment |
| --- | --- | --- |
| PLATINUM | 750–1000 | Pre-approved at most relying parties |
| VERIFIED | 500–749 | Standard verification |
| WATCH | 250–499 | Enhanced verification, lower limits |
| FLAGGED | 0–249 | Most relying parties reject |

Scoring kernel: [`apps/api/src/modules/bate/bate.scorer.ts`](../apps/api/src/modules/bate/bate.scorer.ts). Pure function; deterministic; replayable.

## Phase milestones

| Phase | Gate | Deliverable | Status |
| --- | --- | --- | --- |
| 0 — Spec | Now | Master suite + this scaffold | ✓ |
| 1 — MVP | After CERNIQ Gate 1 | Identity, policy, verify, audit, dashboard, billing | scaffolded |
| 2 — BATE | $500 MRR | Signal pipeline, scorer, anomaly detection, webhooks | scaffolded |
| 3 — Edge & Enterprise | $5K MRR | CF Workers, delegation chains, ACP connector, SOC2 Type I | docs only |

## What lives where in this repo

```
apps/api                NestJS 11 — every layer above
apps/dashboard          Next.js 16 — developer-facing UI (Phase 1 minimal)
packages/sdk-ts         npm: @okoro/sdk (TypeScript)
packages/sdk-py         PyPI: okoro (scaffold only)
workers/cf-verify       Cloudflare Worker, Phase 3 hot path
docs/                   THREAT_MODEL.md, SPEC.md, ADRs (incoming)
```
