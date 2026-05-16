# ADR-0016 — Intent-bound attestation (`@aegis/intent-manifest`)

**Status**: accepted
**Date**: 2026-05-15
**Deciders**: operator (Erwin Kiess-Alfonso) — three decisions locked in
session 2026-05-15.
**Closes**: agentic-landscape gap #5 (intent-bound attestation) from
`docs/SESSION_HANDOFF.md` 2026-05-12; provides the package backbone for
Testament Book I §3 wedge claim.

## Context

The May-2026 agentic-landscape survey identified five gaps where no
existing platform vendor (OpenAI, Anthropic, OAuth/MCP/CIMD, SPIFFE/SPIRE)
is structurally incentivized to build neutral infrastructure:

1. Cross-vendor agent identity bridge
2. Offline-verifiable verify tokens
3. TTL-correct ephemerality
4. Deny-list / revocation propagation
5. **Intent-bound attestation** — binding the verify token to a declared
   intent manifest the gateway reconciles against actuals.

Gap #5 is the most defensible because:

- Anthropic / OpenAI SDKs block by regex on tool name, not by binding
  the verify token to a structured intent envelope.
- OAuth/MCP authorization scopes are static and long-lived; intent
  manifests are per-tool-call and last 30-60s.
- AEGIS already sits at the tool-call checkpoint (Testament Book I §3
  — "three lines of code in an MCP server"). Issuance + reconciliation
  is a natural extension of the existing verify-token surface.

## Decision

Ship `@aegis/intent-manifest` — a framework-free TypeScript package
that issues, signs, verifies, and reconciles intent manifests. The
package is publish-1.0 ready behind the three operator-locked
decisions documented below.

### Locked decisions (operator 2026-05-15)

#### DECISION 1 — IntentClaim envelope shape

**Locked**: keep all three shapes in publish-1.0.

```ts
type IntentClaim = HttpCallClaim | CommerceActionClaim | ToolInvocationClaim;
```

Rationale: each shape maps to a distinct AEGIS adoption wedge per
Testament Book IV — `http-call` for agent platforms (Browserbase-class),
`commerce-action` for ACP merchants + treasury (mirrors policy vocab),
`tool-invocation` for MCP wedge. Picking one would force the other
two into a future port at higher cost than carrying the union now.
Compiler-enforced `assertNever` in `reconcile.ts` guarantees a new arm
in the future becomes a single switch case + test.

Deprecation path: operator may reject a kind at issuance time in a
future 1.x release without removing the type member — relying parties
that already integrated against a deprecated shape are unaffected by
the type contract change, only by the issuance refusal.

#### DECISION 2 — Reconciliation strictness defaults + `graduated` semantics

**Locked**:

| Mode | Behavior |
| ---- | -------- |
| `strict` | ANY mismatch yields `INTENT_MISMATCH` denial. Default mode if `reconciliation` field is omitted at issuance. |
| `advisory` | Mismatches recorded in result but `recommendedDenialReason = null`. Emits audit event + BATE signal for forensic visibility. |
| `graduated` | `over-call-count` tolerated up to `floor(maxCalls × (1 + tolerance/100))`, default tolerance 20%. NON-count mismatches (`wrong-merchant`, `over-amount-cap`, `wrong-method`, `wrong-endpoint`, `arg-shape-mismatch`) ALWAYS strict regardless of tolerance. |

Rationale: `strict` default protects the operator's security posture
out-of-the-box; relying parties must explicitly opt into laxer modes
per manifest. `graduated` tolerance applies only to count overshoots
because the semantic mismatches (wrong merchant, over amount cap) are
unambiguously bad regardless of how many times they happen. `floor`
not `ceil` so the tolerance is friendlier at small `maxCalls`
(declared=2 @ 20% → threshold=2; declared=10 @ 20% → threshold=12).

#### DECISION 3 — `INTENT_MISMATCH` placement in denial precedence

**Locked**: append at end of `DENIAL_REASON_PRECEDENCE` (after
`ANOMALY_FLAGGED`). New precedence is 12 reasons, top-wins:

```text
PLAN_LIMIT_EXCEEDED   (billing pre-gate)
AGENT_NOT_FOUND
AGENT_REVOKED
INVALID_SIGNATURE
POLICY_REVOKED
POLICY_EXPIRED
SCOPE_NOT_GRANTED
TRIAL_EXHAUSTED
SPEND_LIMIT_EXCEEDED
TRUST_SCORE_TOO_LOW
ANOMALY_FLAGGED
INTENT_MISMATCH       ← new
```

Rationale: append-at-end is the only placement that does NOT require an
API minor version bump (per CLAUDE.md root invariant 6 + comment in
`packages/types/src/constants.ts:55-56`). Relying parties on older
clients receive `INTENT_MISMATCH` as an unrecognized denial reason and
fall through to `denialReasonRank() === Number.POSITIVE_INFINITY`,
which their existing escalation code already handles
(forward-compatible). Mid-chain insertion would shift the rank of every
later reason, breaking RP retry/escalation code that pre-encodes rank
constants.

Mirror surfaces updated in lockstep:

1. `packages/types/src/constants.ts` — `DENIAL_REASON_PRECEDENCE`
2. `apps/api/src/modules/verify/verify.dto.ts` — `DenialReason` union
3. `apps/api/src/modules/verify/algorithm/verify.ports.ts` — `DenialReason` union
4. `apps/api/src/common/policy-engine/engine.interface.ts` — `DenialReason` union
5. `docs/spec/AEGIS_API_SPEC.yaml` — `VerifyResponse.denialReason.enum`
6. `packages/verifier-rp/src/types.ts` — `DenialReason` union (RP observability)
7. `tests/cross-package/denial-precedence-enum.spec.ts` — `CANONICAL` fixture

## Invariant preservation (CLAUDE.md root)

| # | Invariant | How preserved |
| - | --------- | ------------- |
| 2 | Verify portability | `@aegis/intent-manifest` has zero Nest / DI / Node-only imports. Reconciliation kernel is a pure function; ports to Cloudflare Worker as-is. |
| 3 | Audit append-only | Reconciliation outcomes generate new audit events; manifests are never mutated. |
| 4 | No silent failures | `IntentMismatchKind` is a closed enum; `VerifyResult` is a typed union; `assertNever` enforces discriminator exhaustiveness at compile time. |
| 5 | Multi-tenant isolation | `principalId` carried on every manifest body; verifier-side checks reject cross-principal manifests. |
| 6 | Denial precedence stability | `INTENT_MISMATCH` appended at end — forward-compatible, no API minor bump, parity-test guarded. |
| 7 | Contracts centrally owned | Denial reason added to `packages/types` constant; all six wire surfaces mirror by file edit, not by re-derivation. |
| 8 | SDKs runtime-portable | Kernel uses `@noble/ed25519` + `@noble/hashes` only; identical edge-runtime compatibility as `@aegis/audit-verifier`. |

## Phasing

**Phase 0 (this commit)** — Lock the kernel:

- `packages/intent-manifest/` — 24 tests, typecheck clean.
- Kernel emits literal `'INTENT_MISMATCH'` (no @aegis/types runtime dep).
- README transitioned from "USER-INPUT-NEEDED" to "locked".

**Phase 1 (separate commit)** — Wire `INTENT_MISMATCH` into 7 wire surfaces.

- Single atomic commit so parity test stays green throughout.
- Verified via `pnpm test:parity` post-commit.

**Phase 2 (gated on Phase 1, separate ADR)** — Runtime issuance:

- New `apps/api/src/modules/intent/` module behind
  `AEGIS_INTENT_MANIFEST_ENABLED` env flag.
- `intent.service.ts` issues `SignedIntentManifest` alongside the verify
  token at `/v1/verify` (or via a separate `/v1/intent` endpoint —
  decided in Phase 2 ADR).
- Verify path stays portable: reconciliation happens in
  `verify.algorithm.ts` via a `IntentReconcilerPort` (mirrors policy
  engine port shape — ADR-0012).
- Audit event added: `intent.declared`, `intent.reconciled`,
  `intent.mismatch`.

**Phase 3 (gated on Phase 2 + customer telemetry)** — Edge port:

- Reconciliation in `workers/cf-verify` for the edge verify path.
- Compatible with shadow-mode rollout (M-049 pattern).

## Rejected alternatives

- **Pick one IntentClaim shape**: forces a port for the other two later
  at higher cost; loses cross-wedge applicability. (Decision 1 rejected
  options B and C.)
- **Default `advisory` strictness**: friendlier for early adopters but
  weakens security posture out-of-the-box; operator must remember to flip
  to strict per manifest. (Decision 2 rejected option B.)
- **Drop `graduated` mode entirely**: simpler kernel but loses the
  count-tolerance use case that customers will need for legitimate
  retry/backoff patterns. (Decision 2 rejected option C.)
- **Reuse `ANOMALY_FLAGGED` for intent mismatch**: avoids wire-level
  surgery but collapses two distinct forensic signals (BATE rule fire
  vs. declared-intent violation) into one bucket; degrades operator
  dashboard fidelity. (Decision 3 rejected option B.)
- **Surgical mid-chain insertion of `INTENT_MISMATCH`**: most rigorous
  semantic placement but requires API minor version bump + RP retry
  code update across all integrated customers. (Decision 3 rejected
  option C — defer to a future ADR if forensic signal weighting
  demands re-ordering.)

## Consequences

Positive:

- AEGIS owns the intent-bound attestation surface before standards lock
  in (Testament Book I §1 — eighteen-month NIST window).
- Per-tool-call sub-minute manifest binds the existing `TOKEN_TTL_MIN_*`
  envelope to a declared semantic intent — closes the "static OAuth
  scope vs. dynamic tool-call" mismatch.
- Forensic signal: operators can distinguish "agent declared X, did Y"
  from "agent triggered BATE rule R" — sharper incident response.
- Cross-vendor portability: every relying party that already integrates
  the verify token receives the manifest in the same response shape; no
  new endpoint or auth flow required.

Negative:

- Three claim shapes triple the surface area of any future kernel
  change. Mitigated by `assertNever` compile-time enforcement.
- `graduated` mode adds a tunable that operators must size correctly.
  Mitigated by 20% default + documented `floor()` semantics + tests.
- New denial reason expands the `DENIAL_REASON_PRECEDENCE` from 11 to
  12 reasons. Forward-compatible per Decision 3 rationale.

## References

- `packages/intent-manifest/` — package source
- `docs/SESSION_HANDOFF.md` 2026-05-12 — landscape gap audit (gap #5)
- `docs/THE_AEGIS_TESTAMENT.md` Book I §3 — tool-call wedge
- ADR-0004 — denial precedence contract
- ADR-0012 — policy engine port pattern (template for Phase 2 wiring)
- `packages/types/src/constants.ts` — `DENIAL_REASON_PRECEDENCE`
- `tests/cross-package/denial-precedence-enum.spec.ts` — wire parity gate
- CLAUDE.md root — invariants 2/3/4/5/6/7/8
