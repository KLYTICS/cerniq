# OKORO — Behavioral Attestation Engine (BATE)

> Internal whitepaper. Defines the trust score model that every BATE
> implementation (rule-based v1, ML v2) must agree on at the interface.

---

## 1. The score in one paragraph

Every agent has an integer score in `[0, 1000]`. New agents start at
**500** ("VERIFIED" band). Score changes are **deltas accumulated from
weighted signals**, clamped at the boundary, and decay-corrected for
agent age. The current score and band are read from
`AgentIdentity.trustScore` / `trustBand`; history lives in
`TrustScoreHistory` with one row per delta.

---

## 2. Trust bands

| Band     | Range     | Default relying-party action                      |
|----------|-----------|---------------------------------------------------|
| PLATINUM | 750–1000  | Pre-approved up to policy spend limit             |
| VERIFIED | 500–749   | Standard verification (default acceptance)        |
| WATCH    | 250–499   | Enhanced verification, lower spend limits suggested|
| FLAGGED  | 0–249     | Reject by default                                 |

Bands are advisory — relying parties choose their own thresholds. The
band string is included in `/v1/verify` responses for convenience.

---

## 3. Scoring formula (conceptual)

```
score = clamp(
    BASELINE
  + Σ ( signal_weight(s) * source_weight(s.source) * recency_factor(s)
        for each signal s in agent.signal_history )
  + verification_bonuses(agent.principal)
  + age_correction(agent.age)
,  0, 1000)
```

| Term                   | Description                                                         |
|------------------------|---------------------------------------------------------------------|
| `BASELINE`             | 500 — neutral starting point                                        |
| `signal_weight(s)`     | From the weight table below                                         |
| `source_weight(s)`     | `1.0` for verified relying parties, `0.0–0.3` otherwise             |
| `recency_factor(s)`    | `exp(-age_days / 30)` — older signals fade                          |
| `verification_bonuses` | `+50` for email-verified principal, `+150` for KYC-verified         |
| `age_correction`       | `min(0, 30 - age_days) * -2` (small early penalty, then 0)          |

The clamp keeps the score in `[0, 1000]`. The recency window means a
clean year of behavior plateaus at the maximum natural score.

---

## 4. Signal weight table  · **OPERATOR INPUT NEEDED**

> These weights are placeholders. The operator must set them before BATE
> goes live. See `WORK_BOARD.md` M-007 (BLOCKED ON OPERATOR).
>
> When you write the final weights in this table, also encode them in
> `apps/api/src/modules/bate/bate.weights.ts` so they're code-reviewable
> and unit-testable.

### Positive signals (raise score)

| Signal type                  | Weight | Cap per day | Notes                                  |
|------------------------------|--------|-------------|----------------------------------------|
| `CLEAN_TRANSACTION`          | +2     | +20         | Capped to prevent score-farming        |
| `PRINCIPAL_KYC_VERIFIED`     | +150   | once        | One-time bonus, persists               |
| `CONSISTENT_GEOGRAPHY`       | +1     | +10         | Geo over rolling 7-day window          |
| `NORMAL_VELOCITY`            | +1     | +10         | Within expected request rate           |

### Negative signals (drop score)

| Signal type                  | Weight | Cap per day | Notes                                  |
|------------------------------|--------|-------------|----------------------------------------|
| `RELYING_PARTY_FRAUD_REPORT` | -300   | -500        | Verified RP only; capped to limit war  |
| `VELOCITY_ANOMALY`           | -50    | -200        | E.g., 10× rolling p95                  |
| `GEOGRAPHIC_INCONSISTENCY`   | -75    | -200        | New country + new MCC + within 1 hour  |
| `SPEND_PATTERN_DEVIATION`    | -50    | -200        | E.g., 5× normal txn size on new domain |
| `POLICY_VIOLATION_ATTEMPT`   | -25    | -100        | Tried to exceed scope                  |
| `FAILED_VERIFY_SPIKE`        | -50    | -200        | >5 failures/min (signature, expiry)    |
| `DELEGATION_CHAIN_ANOMALY`   | -100   | -300        | Phase 3                                |

> **TODO operator**: confirm weights or replace. Recommended pre-launch:
> simulate against a 30-day mock signal stream to ensure no agent flips
> band more than 3× per day under normal use.

---

## 5. Cold-start trust accelerator  · **OPERATOR INPUT NEEDED**

A brand-new agent at score 500 may still be rejected by relying parties
that demand `>= 600`. We need a "trust accelerator" path so legitimate
new agents can climb fast without history:

> **Operator must choose** the accelerator policy. Candidates (pick one
> or design your own):
>
> 1. **KYC-only**: KYC-verified principal → start at 650.
> 2. **Pre-certified runtime**: Agents declaring runtime = `anthropic`
>    or `openai` start at 575 (provider has done some screening).
> 3. **Sponsorship**: An existing PLATINUM agent in the same principal
>    can vouch (start at 600).
> 4. **Okoro Verified Developer**: Operator-curated allow-list for
>    early customers; +100 baseline.
>
> Until decided, default behavior: every new agent starts at 500. KYC
> bonus applies (+150 → 650).

When chosen, encode in `apps/api/src/modules/bate/bate.cold-start.ts`.

---

## 6. Anomaly detection — rule-based v1

Implemented in `apps/api/src/modules/bate/anomaly/` as pure functions
that emit signals (which then flow into the scoring formula above).

### R-1: Velocity anomaly
- Maintain rolling 60-second request count per agent in Redis.
- If count > `5 * mean(last_24h_per_min)` AND count > 30, emit
  `VELOCITY_ANOMALY` (severity = `HIGH`).

### R-2: Geographic inconsistency
- Track last seen country per agent (GeoIP lookup at the API edge).
- If new country + previous country < 1 hour ago AND distance > 1000 km,
  emit `GEOGRAPHIC_INCONSISTENCY` (severity = `HIGH`).

### R-3: Spend pattern deviation
- Maintain rolling 7-day average txn size per agent per merchant
  category.
- If new txn > 5× rolling average AND txn > $100, emit
  `SPEND_PATTERN_DEVIATION` (severity = `MEDIUM`).

### R-4: Failed verify spike
- Count failed verifies (any denial reason) per agent per minute.
- If > 5 in 60s, emit `FAILED_VERIFY_SPIKE` (severity = `MEDIUM`).

### R-5: Policy violation attempt
- Any `SCOPE_NOT_GRANTED` or `SPEND_LIMIT_EXCEEDED` emits
  `POLICY_VIOLATION_ATTEMPT` (severity = `LOW`).

---

## 7. ML v2 (future, post Phase 1)

- **Isolation Forest** baseline on the multivariate signal stream
  (velocity, spend deviation, scope diversity, geographic hops).
- Trained nightly on the previous 30 days of signals; deployed as a
  shadow scorer first, gates on metric: false-positive rate < 0.5%.
- **Never replaces rules outright** — rules remain authoritative for
  hard fraud signals. ML adds nuance (e.g., "this pattern resembles a
  known synthetic-identity ring").

---

## 8. Score change webhooks

Whenever a score crosses a band boundary, emit `okoro.agent.trust_score_changed`:

```json
{
  "agentId": "agt_...",
  "oldScore": 749,
  "newScore": 752,
  "oldBand": "VERIFIED",
  "newBand": "PLATINUM",
  "reason": "Accumulated CLEAN_TRANSACTION signals",
  "timestamp": "2026-05-15T12:00:00Z"
}
```

Webhook delivery: `apps/api/src/modules/webhooks/` (M-008).

---

## 9. What BATE is **not**

- Not a credit score. We do not sell aggregated agent scores to third
  parties without explicit principal consent.
- Not a substitute for relying-party fraud detection. A trust score
  reduces base-rate risk; it does not prove the current request is
  legitimate.
- Not deterministic across rollouts. Score deltas have a small jitter
  to make scoring-farming harder; reproducibility is at the band level
  ("would a clean agent be VERIFIED?"), not the integer level.
