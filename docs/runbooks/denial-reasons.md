<!-- @generated — do not edit; run `pnpm gen:runbook-docs` -->
<!-- Source: docs/runbooks/denial-reasons.yaml -->

# AEGIS Denial-Reason Runbook

Operator and relying-party guidance for every reason in
`DENIAL_REASON_PRECEDENCE` (top-wins order). Generated from
`docs/runbooks/denial-reasons.yaml` — edit that file, not this one.

Reasons are listed in canonical precedence order (rank 1 wins ties).

| Rank | Reason | Severity | Description |
| ---: | ------ | -------- | ----------- |
| 1 | `PLAN_LIMIT_EXCEEDED` | warning | Plan tier monthly verify quota exhausted (billing pre-gate). |
| 2 | `AGENT_NOT_FOUND` | warning | No agent identity matches that ID. |
| 3 | `AGENT_REVOKED` | warning | The agent has been revoked. |
| 4 | `INVALID_SIGNATURE` | critical | The request token signature did not verify. |
| 5 | `POLICY_REVOKED` | warning | The policy was revoked. |
| 6 | `POLICY_EXPIRED` | info | The policy has expired (or was never found). |
| 7 | `SCOPE_NOT_GRANTED` | warning | The action / domain is outside the policy scope. |
| 8 | `TRIAL_EXHAUSTED` | warning | Lifetime free-trial verify quota exhausted; upgrade to a paid plan. |
| 9 | `SPEND_LIMIT_EXCEEDED` | warning | The amount exceeds the policy spend limit. |
| 10 | `TRUST_SCORE_TOO_LOW` | warning | The agent trust score is below the threshold for this action. |
| 11 | `ANOMALY_FLAGGED` | critical | BATE flagged this request as anomalous. |
| 12 | `INTENT_MISMATCH` | critical | The actual call deviated from the declared intent manifest. |

---

## 1. `PLAN_LIMIT_EXCEEDED`

🟡 **WARNING** — Plan tier monthly verify quota exhausted (billing pre-gate).

### Relying-party action

Direct the user to upgrade their AEGIS plan. Do NOT retry — the gate is monthly-quota-bound, not transient. Surface the upgrade link from the billing portal.

### Operator check

Confirm Stripe subscription state matches AEGIS plan. If the principal recently upgraded, the quota counter may not have reset yet (cache TTL up to 60s). If stale, force-refresh via `aegis-cli billing sync --principal <id>`.

### Dashboard query

```
principalId:{{id}} AND denialReason:PLAN_LIMIT_EXCEEDED
```

### SDK docs

_(link pending operator review)_

---

## 2. `AGENT_NOT_FOUND`

🟡 **WARNING** — No agent identity matches that ID.

### Relying-party action

The agent ID embedded in the token is unknown to AEGIS. Either the agent was deleted, never registered, or the token was issued by a different AEGIS deployment. Caller should re-register the agent via `agents.create()` if expected to exist.

### Operator check

Look up the principalId in the audit log for recent agent delete/revoke events. If unexpected, check identity.module for a recent migration that may have orphaned agents.

### Dashboard query

```
agentId:{{id}}
```

### SDK docs

_(link pending operator review)_

---

## 3. `AGENT_REVOKED`

🟡 **WARNING** — The agent has been revoked.

### Relying-party action

The agent is intentionally revoked — do NOT auto-retry. If the revocation was an error, contact the principal owner to re-register or restore.

### Operator check

Pull the audit-log entry for the revocation event: who initiated, when, what reason was logged. If revocation was operator-initiated (key compromise / policy), it stays.

### Dashboard query

```
agentId:{{id}} AND eventType:agent.revoked
```

### SDK docs

_(link pending operator review)_

---

## 4. `INVALID_SIGNATURE`

🔴 **CRITICAL** — The request token signature did not verify.

### Relying-party action

Either the agent's private key has rotated (re-issue token with current key) OR the token was tampered with in transit (SEV investigation). Do NOT silently retry — log a security event.

### Operator check

Compare the agent's published JWKS against the kid embedded in the signature. If kids match but verify still fails, the token bytes were modified between issuance and verify — escalate.

### Dashboard query

```
agentId:{{id}} AND denialReason:INVALID_SIGNATURE
```

### SDK docs

_(link pending operator review)_

---

## 5. `POLICY_REVOKED`

🟡 **WARNING** — The policy was revoked.

### Relying-party action

Re-request a fresh policy from the principal owner. The old policy is permanently revoked.

### Operator check

Audit-log lookup for policy revocation. Verify it was operator-initiated (vs. automated expiry — different reason).

### Dashboard query

```
policyId:{{id}} AND eventType:policy.revoked
```

### SDK docs

_(link pending operator review)_

---

## 6. `POLICY_EXPIRED`

🔵 **INFO** — The policy has expired (or was never found).

### Relying-party action

Request a fresh policy. POLICY_EXPIRED is expected at the end of each policy lifetime and should be a normal-flow refresh trigger, not an alert.

### Operator check

Usually no action needed. If expiry rate is anomalously high, investigate whether issued policies have insufficient TTL for the workload.

### Dashboard query

```
principalId:{{id}} AND denialReason:POLICY_EXPIRED
```

### SDK docs

_(link pending operator review)_

---

## 7. `SCOPE_NOT_GRANTED`

🟡 **WARNING** — The action / domain is outside the policy scope.

### Relying-party action

The agent attempted an action / merchant / domain not covered by the granted policy scope. Request a broader policy from the principal owner if the action is legitimate.

### Operator check

Inspect the policy's `scopes` field vs. the request's `action` / `merchantId` / `merchantDomain`. Check whether the agent's behavior matches its expected workflow.

### Dashboard query

```
agentId:{{id}} AND denialReason:SCOPE_NOT_GRANTED
```

### SDK docs

_(link pending operator review)_

---

## 8. `TRIAL_EXHAUSTED`

🟡 **WARNING** — Lifetime free-trial verify quota exhausted; upgrade to a paid plan.

### Relying-party action

The principal is on the free trial and has used all lifetime verify calls. Direct them to upgrade their AEGIS plan. HTTP 402 (Payment Required). Do NOT retry.

### Operator check

Verify the principal's trial usage in billing — should match the trial-quota counter. If counter is wrong (e.g. expired trial flag was reset), reconcile via `aegis-cli billing sync`.

### Dashboard query

```
principalId:{{id}} AND denialReason:TRIAL_EXHAUSTED
```

### SDK docs

_(link pending operator review)_

---

## 9. `SPEND_LIMIT_EXCEEDED`

🟡 **WARNING** — The amount exceeds the policy spend limit.

### Relying-party action

The transaction amount exceeds the per-period spend cap in the policy. Either reduce the transaction or request a higher cap from the principal owner.

### Operator check

Confirm `spend:{policyId}:day:{date}` (or month) counter matches expected. If the agent is hitting the cap repeatedly, surface the trend to the principal.

### Dashboard query

```
policyId:{{id}} AND denialReason:SPEND_LIMIT_EXCEEDED
```

### SDK docs

_(link pending operator review)_

---

## 10. `TRUST_SCORE_TOO_LOW`

🟡 **WARNING** — The agent trust score is below the threshold for this action.

### Relying-party action

The agent's BATE-computed trust score is below the policy's minimum band. The action will be denied until the trust score recovers (typically requires positive operator-observed behavior across the next several verify cycles).

### Operator check

Inspect agent's recent BATE signals. Likely contributors: anomaly flags, RP fraud reports, sudden behavior shift. Surface to the principal if remediation is needed.

### Dashboard query

```
agentId:{{id}} AND denialReason:TRUST_SCORE_TOO_LOW
```

### SDK docs

_(link pending operator review)_

---

## 11. `ANOMALY_FLAGGED`

🔴 **CRITICAL** — BATE flagged this request as anomalous.

### Relying-party action

BATE detected behavioral anomaly (timing, geo, action pattern). Do NOT auto-retry — escalate to fraud/security review. Caller should log a security event with the request correlation ID.

### Operator check

Pull the BATE signal that flagged this request. If false positive, mark via `aegis-cli signals dismiss <id>`. If true positive, escalate to fraud team and consider freezing the agent.

### Dashboard query

```
agentId:{{id}} AND signalType:ANOMALY AND denialReason:ANOMALY_FLAGGED
```

### SDK docs

_(link pending operator review)_

---

## 12. `INTENT_MISMATCH`

🔴 **CRITICAL** — The actual call deviated from the declared intent manifest.

### Relying-party action

The agent's actual tool call deviated from the intent it declared at policy-issuance time (ADR-0016). Under STRICT reconciliation this fails closed; under GRADUATED, it may pass with a flag depending on tolerance. Do NOT auto-retry — the agent's behavior diverged from its declared intent, which is itself a security signal.

### Operator check

Pull the intent manifest from `intent.declared` audit events vs. the actual call params. Determine whether divergence is a bug in the agent (intent under-specified) or behavioral drift (intent mis-stated). Surface to the principal owner for review.

### Dashboard query

```
agentId:{{id}} AND denialReason:INTENT_MISMATCH
```

### SDK docs

_(link pending operator review)_

---
