# ADR-0012 — Pluggable policy engine via PolicyEngine interface

**Status**: accepted
**Date**: 2026-05-02
**Deciders**: sid=enterprise-backbone-arch (operator: erwin)
**Supersedes**: none

## Context

The Phase 0 verify algorithm decides whether a tool call is allowed by
walking a fixed set of checks: agent status, signature, policy status,
expiration, scope match, spend limits, trust band, anomaly. Each is
hand-coded in `verify.algorithm.ts`. This works and ships.

Two enterprise demands push past hand-coded:
1. **Custom rules per relying party.** "Block all `commerce.purchase`
   from agents below `PLATINUM` between 22:00–06:00 UTC unless the
   merchantDomain is on our nightly-batch allow list." We can either
   bake every such rule into core (untenable) or expose a policy DSL.
2. **Auditor-facing rule clarity.** SOC2 / ISO 27001 / DORA reviewers
   want declarative "here is the rule, here is the evaluator" — they
   reject "the rule is implicit in 200 lines of TypeScript."

Two industry-standard policy engines fit:
- **AWS Cedar** (Apache 2.0, AWS) — verifiable static analysis,
  human-readable syntax, used by Verified Permissions. Ed25519-friendly,
  WASM-portable.
- **Open Policy Agent (OPA) Rego** (Apache 2.0, CNCF) — declarative
  Datalog dialect, ubiquitous in K8s shops, rich tooling.

We commit to *neither one* as the only engine — we commit to the
*interface* that lets either (or both) plug in. AEGIS's builtin engine
(the Phase 0 hand-coded logic) is one implementation of this interface.

## Decision

1. **`PolicyEngine` interface** in
   `apps/api/src/common/policy-engine/engine.interface.ts`:
   ```ts
   export interface PolicyEngine {
     readonly id: 'builtin' | 'cedar' | 'opa';
     evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult>;
   }
   ```
   Input carries: agent snapshot, policy snapshot, requested action,
   amount, currency, merchant context, time, trust band. Output: `decision`
   (APPROVE / DENY / FLAG), `denialReason` (one of the locked enum from
   ADR-0004), `obligations[]` (post-decision actions like "log",
   "notify"), `engineMetadata` (free-form, audited).
2. **Adapters shipped:**
   - `BuiltinPolicyEngine` — wraps current `verify.algorithm.ts` checks.
     Default. Zero dependencies.
   - `CedarPolicyEngine` (M-033) — uses `@cedar-policy/cedar-wasm`.
     Compile policies at create-time, evaluate at verify-time.
   - `OpaPolicyEngine` (M-034) — sidecar `opa eval` over HTTP, OR
     embedded `@open-policy-agent/opa-wasm`. Decide at integration time.
3. **Engine selection per principal.** `Principal.policyEngine`
   field (default `'builtin'`). Verify path picks the engine to evaluate
   the policy by reading the principal config. Mixing engines across
   tenants is supported; mixing inside a single principal is NOT (one
   engine per tenant for now; multi-engine per tenant is a v2 problem).
4. **Denial precedence stays locked.** ADR-0004's denial enum is the
   contract; engines MAY NOT invent new denial reasons. If an engine
   produces an unrecognized denial, AEGIS surfaces `POLICY_REJECTED`
   (added to enum if unanimous, else mapped). Cedar/OPA policies that
   need finer-grained reasons emit them as `engineMetadata.subReason`
   for audit, but the public API stays stable.
5. **Hot path constraint preserved.** ADR-0003 said the verify hot path
   runs unmodified on Cloudflare Workers. Cedar-WASM and OPA-WASM both
   run in Workers. The `PolicyEngine` interface adds zero NestJS / DI /
   Node deps — pure functions only.
6. **Policy compile step.** Cedar/OPA policies are compiled at create
   time, validated against the engine's static analyzer, and stored in
   `AgentPolicy.compiledArtifact` (bytea). Verify-time loads the artifact;
   no string-eval at hot path. Compile errors surface as 422 at
   `POST /v1/policies`, never at verify time.

## Consequences

### Positive
- Customers can express domain-specific rules in industry-standard
  syntax. "Send us your Cedar/OPA policy, we'll plug it in."
- Auditor-facing artifact: the policy is the rule. Reviewers read Cedar
  schema; we don't translate.
- Enables marketplace plays: "AEGIS-certified policy bundles" for
  PCI-DSS, HIPAA, GDPR. Pre-written, audited, drop-in.
- A breaking change to one engine (Cedar v3, OPA v2) doesn't break the
  others — interface absorbs the divergence.

### Negative
- Two more engines to test, version-pin, security-monitor.
- Policy DSL learning curve for customers who don't know Cedar/OPA.
  Mitigation: `BuiltinPolicyEngine` covers 80% of cases without any DSL.
- Static-analysis guarantees only as good as the engine's. Cedar's
  formal model is solid; OPA's is weaker. Customers picking OPA accept
  that trade-off.

### Neutral
- New folder: `apps/api/src/common/policy-engine/`.
- Verify algorithm refactor (M-019) calls `engine.evaluate()` instead
  of hand-coded checks. Behavior preserved bit-for-bit by
  `BuiltinPolicyEngine`. Peer holds verify path; my work is interface
  + builtin scaffold only.
- Audit log gains `policyEngineId` + `engineMetadata` columns (M-026).

## Alternatives considered

### Alt A: Pick one (Cedar)
Rejected for ecosystem reasons: K8s/CNCF shops want OPA, AWS-native
shops want Cedar. Locking out half the market is poor strategy.

### Alt B: Pick neither, stay hand-coded forever
Works for v1, breaks at the first enterprise that demands custom rules.
We lose deals.

### Alt C: Build our own policy DSL
Tempting (vendor lock-in, brand). Rejected: SOC2 reviewers reject
homegrown evaluators ("show us the formal semantics") — Cedar/OPA both
have peer-reviewed semantics.

## How to reverse this decision

If pluggability proves over-engineered for our market, drop the
interface and inline `BuiltinPolicyEngine`. Adapters delete cleanly;
the verify path is one branch shorter. ~200-line delete. No data
migration unless customers used Cedar/OPA — then a 90-day deprecation
window with policy translation.

## References

- AWS Cedar: https://www.cedarpolicy.com/
- OPA Rego: https://www.openpolicyagent.org/docs/latest/policy-language/
- Cedar formal model: https://github.com/cedar-policy/cedar-spec
- ADR-0003 — portable verify path (engines stay framework-free).
- ADR-0004 — denial precedence (locked, engines respect it).
- WORK_BOARD M-019 (verify wiring), M-033 (Cedar), M-034 (OPA), M-026
  (schema columns for engine metadata).
