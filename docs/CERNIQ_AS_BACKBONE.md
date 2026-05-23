---
title: CERNIQ as backbone — multi-project adoption playbook
status: draft
last-reviewed: 2026-05-02
owner: operator (Erwin)
audience: CERNIQ contributors + sister-project operators (FORGE, CerniQ, Apex, Bimba)
---

# CERNIQ as backbone — multi-project adoption playbook

> **Thesis.** CERNIQ is not just one of the operator's projects — it is
> the cryptographic identity, policy enforcement, and audit substrate
> that the operator's other four production systems (FORGE, CerniQ,
> Apex, Bimba) consume to make their own AI-agent surfaces trustable.
> This document is the first written articulation of that integration
> contract.

## 1. Why this exists

The operator runs five concurrent production-grade systems:

| System | Domain                                              | Agent surface                             |
| ------ | --------------------------------------------------- | ----------------------------------------- |
| FORGE  | Manufacturing execution (CMMS, scheduling, SPC)     | Operator copilot, AI rail, CAPA agents    |
| CerniQ | ALM for Puerto Rico cooperativas (40+ quant models) | Close cockpit, AI analyst (pending)       |
| Apex   | KLytics APEX FX command center                      | Reconcile workflow, paper-trade runway    |
| Bimba  | Space mission intelligence OS                       | Mission analyst agents (Phase 1 baseline) |
| CERNIQ | Neutral identity / policy / audit for AI agents     | (substrate — has no first-party agents)   |

Each system today **invents its own** answer to:

- "Who is this AI agent that just made a decision?"
- "Was the agent authorized to do this thing within these limits?"
- "Can a regulator inspect the trail of decisions and verify it wasn't
  rewritten?"

That's four parallel re-implementations of the same problem — and four
parallel attack surfaces. **CERNIQ is the consolidation play.**

Once CERNIQ goes live, the four sister projects integrate as relying
parties (RPs). They issue scoped policies, bind agents to those
policies, and call `/v1/verify` before every consequential action.
CERNIQ becomes the cross-cutting backbone the way Stripe became the
cross-cutting payment substrate for early SaaS.

## 2. The integration contract (per-project)

### 2.1 What CERNIQ provides

- **Identity**: a public-key-rooted `AgentIdentity` per RP, scoped per
  RP-tenant. RP holds nothing private.
- **Policy issuance**: a signed JWT (Ed25519) with scope, spend limit,
  domain allow-list, and TTL. RP keeps a copy and presents it on each
  call.
- **Verify endpoint**: `POST /v1/verify` returns `valid: true|false` +
  `denialReason` + `scopesGranted` + `auditEventId` in <80 ms (Phase 3).
- **Audit chain**: every decision (verify or denial) is appended to
  the CERNIQ audit chain, signed, and exportable as NDJSON.
- **Trust score (BATE)**: per-agent rolling score 0-1000 based on
  behavior. RP can refuse below threshold via `minTrustScore` on
  verify.
- **JWKS** at `/.well-known/jwks.json` for offline verification when
  CERNIQ is unreachable (signed policy still holds).

### 2.2 What the RP provides

- API key (`X-CERNIQ-Verify-Key`) — verify-scoped, distinct from any
  management key. Scoped to `/v1/verify` and `/v1/agents/:id/status`.
- Per-agent registration: the RP creates the `AgentIdentity` row,
  passing the agent's public key. The agent generates the private key
  client-side and never shares it.
- Per-decision verify call wrapping each consequential action — the
  RP's existing authorization layer is _not_ replaced; CERNIQ sits
  _underneath_ it as a final cryptographic gate.

### 2.3 Recommended consumption pattern

```ts
// in the RP (FORGE / CerniQ / Apex / Bimba) — per-action verify
import { Cerniq } from '@cerniq/sdk';

const cerniq = new Cerniq({
  baseUrl: process.env.CERNIQ_BASE_URL,
  verifyKey: process.env.CERNIQ_VERIFY_KEY,
});

const verdict = await cerniq.verify({
  policyJwt: policy.signedToken,           // issued at agent-bind time
  agentSignature: signedAction,            // agent signed canonical(action)
  action: { kind: 'capa.close', payload }, // domain-specific
  requestedAmount: '0',                    // for non-spend, '0'
  minTrustScore: 700,                      // RP's risk floor
  jti: crypto.randomUUID(),                // per-call unique
  now: new Date().toISOString(),
});

if (!verdict.valid) {
  // RP UI shows verdict.denialReason — never auto-retries on CERNIQ denials
  return denyToUser(verdict.denialReason);
}

// CERNIQ auditEventId goes into the RP's own audit row for cross-link
await rpAudit.append({ cerniqAuditEventId: verdict.auditEventId, ... });
```

## 3. Per-project integration plan

Each project adopts CERNIQ in three phases. Phase 0 (decide) and
Phase 1 (shadow) are non-disruptive; Phase 2 (enforce) is the cutover.

### 3.1 FORGE (~/Desktop/forge)

- **Agent surfaces**: AI Rail, copilot, CAPA agents, scheduling
  optimizer, Andon escalation agent.
- **Phase 0**: file `docs/decisions/00XX-cerniq-as-identity-substrate.md`
  in FORGE's repo. Identify the 6 cross-bible "decision points" (RBAC
  v11 transitions) where CERNIQ gating belongs.
- **Phase 1 (shadow)**: dual-call CERNIQ verify alongside existing RBAC,
  log delta to a side table. No UX change. Validates that CERNIQ denials
  match the operator's policy intent before enforcing.
- **Phase 2 (enforce)**: CERNIQ verify is the gate. RBAC remains
  upstream (role-based access to the _function_); CERNIQ gates _agent
  authorization_ within the function.
- **Risk**: FORGE has 1 088 tests (Bible matrix). Shadow phase must
  not regress any. Plan a `--filter cerniq-shadow` test ring.

### 3.2 CerniQ (~/Desktop/cerniq)

- **Agent surfaces**: agent layer (12 contracts, 4 core agents — see
  `project_cerniq_agent_layer.md`), terminal & swarm CLI dispatch
  (`scripts/swarm/`), pending AI analyst.
- **Phase 0**: CERNIQ becomes the _trust gate_ for the agent layer's
  per-tenant HTTP surface (`project_cerniq_agent_api.md`). The
  cost-breaker pattern stays CerniQ-side; CERNIQ handles identity +
  policy + audit upstream.
- **Phase 1**: CERNIQ verify on every agent-layer ingress, denial log
  to `agent_cerniq_denials` side table. Eval harness gets a new
  CERNIQ-denial-rate metric.
- **Phase 2**: enforce. Agent calls without an CERNIQ-valid policy are
  rejected at the per-tenant edge.
- **Risk**: CerniQ has CAMEL cert + model cards + RLS (Supreme Bible
  Vol I+II). CERNIQ denial reasons must surface in the model card audit
  trail. Cross-document mapping needed.

### 3.3 Apex (~/Desktop/apex)

- **Agent surfaces**: paper-trade runway (M3 next), Slice 2 reconcile
  workflow under `APEX_RECONCILE_VIA_WORKFLOW` flag, future
  cinematic-mode auto-trade actions.
- **Phase 0**: file an Apex ADR. The 4 personas (Erwin / Risk /
  Compliance / Operator) each have CERNIQ implications: Compliance
  needs the audit chain export, Risk needs the trust-score gating,
  Operator needs the denial UX.
- **Phase 1**: shadow on reconcile workflow only. Apex feedback memory
  forbids "LLM calls on auditor artifacts" (#5) — CERNIQ denials
  preserve this because CERNIQ itself does no LLM inference.
- **Phase 2**: enforce on cinematic-mode auto-trade actions before
  any production trade. Paper-trade can run shadow indefinitely.
- **Risk**: Apex's swarm is rules-based, not LLM. CERNIQ adds
  cryptographic identity to those rule executions — useful for the
  Compliance persona but nominal new latency.

### 3.4 Bimba (~/Desktop/bimba)

- **Agent surfaces**: mission analyst agents (Phase 1 baseline). 94
  unstaged files on `feat/bimba-stabilization` per memory — adoption
  delayed until that branch lands.
- **Phase 0**: stabilize first; CERNIQ planning happens after the
  feature branch merges.
- **Phase 1+**: same shadow → enforce pattern as the others.

## 4. Cross-cutting concerns

### 4.1 Tenant isolation across projects

Each project is a distinct CERNIQ `Principal`. A FORGE agent's policy
is invisible to a CerniQ verify call (per CLAUDE.md invariant 5). The
operator's portfolio is **multi-Principal under one operator account**
— CERNIQ dashboard lists all four as siblings, no cross-Principal
data flows.

### 4.2 Single audit-chain root, per-Principal slices

Currently CERNIQ uses one global audit chain (per ARCHITECTURE.md §15
open question 3). For multi-project use, exporters slice the chain by
`principalId` for SOC2 evidence. Per-principal chain rooting is a
future ADR — for now, the slice-and-verify protocol is documented in
`docs/decisions/0005-audit-chain-canonicalization.md`.

### 4.3 Cross-project denial taxonomy

The 9 CERNIQ denial reasons (CLAUDE.md invariant 6) are _neutral_ —
they do not encode FORGE / CerniQ / Apex / Bimba domain semantics.
Each project translates CERNIQ denials into its own user-facing
language. Translation tables live per-project in
`<project>/docs/cerniq-denial-mapping.md` (template provided in §5).

### 4.4 Webhook fan-out

Each project subscribes to its own subset of CERNIQ events
(`agent.revoked`, `policy.expired`, `trust_score_changed`). HMAC-signed
per ADR-0008 line of the webhook spec. Cross-project event sharing is
**not** a feature — each project's webhook subscription stays
inside its own Principal.

## 5. Translation table template

Each project copies this template to its own repo at
`docs/cerniq-denial-mapping.md`:

| CERNIQ denialReason    | RP user message (English)                            | RP user message (Spanish, where applicable)                 | RP UX surface           |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| `AGENT_NOT_FOUND`      | "Agent identity not recognized."                     | "Identidad de agente no reconocida."                        | Toast + audit row       |
| `AGENT_REVOKED`        | "This agent's access has been revoked."              | "El acceso de este agente ha sido revocado."                | Modal + force re-auth   |
| `INVALID_SIGNATURE`    | "The request signature could not be verified."       | "La firma de la solicitud no pudo ser verificada."          | Toast + retry-once      |
| `POLICY_REVOKED`       | "The policy authorizing this action was revoked."    | "La política que autorizaba esta acción fue revocada."      | Modal + admin alert     |
| `POLICY_EXPIRED`       | "The authorizing policy has expired."                | "La política que autoriza ha expirado."                     | Modal + reissue prompt  |
| `SCOPE_NOT_GRANTED`    | "This agent isn't authorized for this action."       | "Este agente no está autorizado para esta acción."          | Inline + admin alert    |
| `SPEND_LIMIT_EXCEEDED` | "This action would exceed the spend limit."          | "Esta acción excedería el límite de gasto."                 | Modal + budget review   |
| `TRUST_SCORE_TOO_LOW`  | "Action blocked: agent trust score below threshold." | "Acción bloqueada: puntuación de confianza demasiado baja." | Modal + manual override |
| `ANOMALY_FLAGGED`      | "Action paused for review (unusual activity)."       | "Acción pausada para revisión (actividad inusual)."         | Modal + ops queue       |

Severity ordering is **fixed** (CLAUDE.md invariant 6). Translation is
RP-local; do not re-prioritize.

## 6. Operator decisions blocking adoption

Per `OPERATOR_DECISIONS.md`:

| OD     | Why it blocks adoption                                                                    |
| ------ | ----------------------------------------------------------------------------------------- |
| OD-001 | BATE weights — until locked, `TRUST_SCORE_TOO_LOW` thresholds are interim                 |
| OD-002 | Cold-start policy — affects every newly registered agent at FORGE / CerniQ / Apex / Bimba |
| OD-003 | Pricing tiers — affects whether each sister project is on Free / Developer / Growth       |
| OD-004 | Audit retention horizon — affects per-project SOC2 evidence offer                         |
| OD-005 | Webhook DLQ depth — affects per-project event-loss SLOs                                   |
| OD-006 | Verify rate limit — affects per-project capacity planning                                 |

A new entry **OD-007** is proposed:

> **OD-007 — Status page hosting choice.** Statuspage / self-hosted /
> Cloudflare Status API. Default: self-hosted on the dashboard
> (`status.cerniq.io` reads `incidents.{open,history}.json` published
> from management API). Due: before Phase 1 GA.

## 7. Roll-out order

Recommended (by lowest blast-radius first):

1. **Apex**: shadow on reconcile-workflow only. Smallest agent-action
   surface; Compliance persona benefits immediately.
2. **CerniQ**: shadow on agent layer ingress. Validates the
   per-tenant + RLS interaction pattern.
3. **FORGE**: shadow across the 6 RBAC-v11 transition points. Largest
   surface, but well-tested (1 088 tests).
4. **Bimba**: after `feat/bimba-stabilization` merges.

Enforcement (Phase 2) follows the same order, with a minimum 30-day
shadow period per project before flipping the gate.

## 8. Non-goals (explicit)

- CERNIQ is **not** the agent runtime. CerniQ's agent layer, FORGE's AI
  Rail, Apex's swarm — they keep running their own runtimes. CERNIQ is
  the cryptographic checkpoint.
- CERNIQ is **not** the policy authoring UI. Each project authors
  policies through its own admin surface and registers them with CERNIQ.
- CERNIQ is **not** a multi-tenant SaaS for external customers — yet.
  The four sister projects are CERNIQ's first customers. External
  customers come after Phase 1 hardening (per `docs/spec/01_MASTER.md`).

## 9. Cross-references

| Topic                                            | Source                                        |
| ------------------------------------------------ | --------------------------------------------- |
| Architecture                                     | `docs/ARCHITECTURE.md`                        |
| Capacity plan (per-RP capacity bumps)            | `docs/CAPACITY_PLAN.md` §14                   |
| Failure modes (per-component FMEA)               | `docs/FAILURE_MODES.md`                       |
| Retention policy (per-RP DSAR + audit retention) | `docs/RETENTION_POLICY.md`                    |
| Threat model                                     | `docs/THREAT_MODEL_v2.md`                     |
| Identity contract                                | `docs/spec/CERNIQ_API_SPEC.yaml` § Identity   |
| Policy contract                                  | `docs/spec/CERNIQ_API_SPEC.yaml` § Policy     |
| Verify contract                                  | `docs/spec/CERNIQ_API_SPEC.yaml` § Verify     |
| BATE algorithm                                   | `docs/BATE_ALGORITHM.md`                      |
| MCP control plane                                | `docs/decisions/0008-mcp-as-control-plane.md` |
| Auth0 bridge                                     | `docs/decisions/0009-auth0-bridge.md`         |
| Operator decisions                               | `OPERATOR_DECISIONS.md`                       |
