# AEGIS — Threat Model: Intent Manifest (ADR-0016 + ADR-0017)

> Feature-specific addendum to `docs/THREAT_MODEL.md`. Covers the intent-
> manifest issuance, signing, verification, reconciliation, and BATE feedback
> surfaces shipped across commits `5e44480` (Phase 2 module), `7b36258`
> (adoption surface), `2cabeba` (Phase 2.1 Prisma adapter), `e5b696c`
> (vertical examples), and `0fd8018` (operator runbook).
>
> Threat numbering (`IM-T*`) is scoped to this document — does not collide
> with the master `docs/THREAT_MODEL.md` `T*` numbers. Status column reflects
> the state as of `2026-05-16`.

---

## Scope

**Covered:**

- The wire surface (`POST /v1/intent`, `POST /v1/intent/{id}/actuals`, `GET /v1/intent/{id}`).
- The framework-free kernel (`@aegis/intent-manifest` — `signManifest`, `verifyManifest`, `reconcileIntent`).
- The relying-party adoption surface (`@aegis/verifier-rp.verifyIntent`).
- AEGIS-side issuance + reconciliation (`apps/api/src/modules/intent/**`).
- The BATE feedback loop (`INTENT_MISMATCH_OBSERVED` → trust score → cross-RP `TRUST_SCORE_TOO_LOW` denial).
- The Phase 2.1 Postgres storage (`IntentManifest` + `IntentActual` tables).

**NOT covered** (governed elsewhere):

- AEGIS infrastructure compromise — `docs/SECURITY.md`.
- KMS provider compromise (`AuditSignerService` key custody) — `docs/SECURITY.md` + `docs/decisions/0011-audit-chain-signing.md`.
- General API surface (rate limiting, throttling) — master `docs/THREAT_MODEL.md` T4.
- Stripe/billing surfaces — orthogonal subsystem.

---

## Trust boundaries

```
agent host (private key)
    │
    │ HTTPS + signed verify-token JWT
    ▼
AEGIS API (issuance: POST /v1/intent)
    │
    │ AuditSignerService signs manifest body (Ed25519 over canonical JSON)
    │ kid published at /.well-known/audit-signing-key
    ▼
relying party (verifier-rp.verifyIntent)
    │
    │ relies on cached JWKS, NEVER calls AEGIS on verify hot path
    ▼
relying party processes action
    │
    │ POSTs actuals back: POST /v1/intent/{id}/actuals (with Idempotency-Key)
    ▼
AEGIS reconciliation
    │
    ├── audit chain entry (append-only, signed)
    ├── BATE.ingestSignal(INTENT_MISMATCH_OBSERVED)  on mismatch
    └── status: OPEN → RECONCILED (cache field)

```

### Trust assumptions

1. **Agent owns its private key.** AEGIS NEVER sees or stores it (CLAUDE.md invariant #1). The verify-token signature is what binds the manifest issuance request to the agent identity.
2. **AEGIS holds the audit-signing key family** (KMS-backed per M-051; env Ed25519 fallback for dev). The same key family signs both audit chain entries AND intent manifests (ADR-0011 §3 + ADR-0017). This is a deliberate single-rotation simplification; the alternative (separate intent signer) is **OD-019**, queued.
3. **Relying parties trust AEGIS's signature** over the manifest body. The RP caches the JWKS from `/.well-known/audit-signing-key` and verifies offline. AEGIS is NOT on the request hot path post-issuance.
4. **Clock skew is bounded by manifest TTL** (30–60 s per `intent.module.ts:113`). RPs and AEGIS must keep clocks within this window; NTP is RP responsibility.
5. **Tenant isolation is by `principalId`** on every load and mutation (CLAUDE.md invariant #5). The `IntentService.get()` returns 404 on cross-tenant access (`intent.service.ts:149-152`) — anti-enumeration discipline.

---

## Threat catalog

| #      | Threat                                               | Likelihood | Impact   | Mitigation                                                                                                    | Status     |
| ------ | ---------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| IM-T1  | Manifest signature forgery                           | Low        | Critical | Ed25519 over canonical JSON; signing key custody via KMS (M-051) or env fallback                              | Covered    |
| IM-T2  | Cross-RP manifest replay                             | High       | Medium   | `verifyTokenJti` binding ENFORCED as required input to `verifyIntent` (compile-error on omit); optional `expectedVerifyTokenSha256B64Url` for belt-and-braces | Covered    |
| IM-T3  | Scope overrun (declared X, did Y)                    | High       | High     | Strict reconciliation default; `IntentMismatchKind` closed enum; deny + BATE signal travels                   | Covered    |
| IM-T4  | Beneficiary substitution (treasury vertical)         | Medium     | Critical | `wrong-merchant` mismatch is ALWAYS strict regardless of graduated tolerance (reconcile.ts:232)               | Covered    |
| IM-T5  | Idempotency key abuse (replay or conflict)           | Medium     | Medium   | Deep-body equality check; same-key+different-body → typed `idempotency_conflict` (intent.adapter.prisma.ts)   | Covered    |
| IM-T6  | Signing key substitution at JWKS                     | Low        | Critical | RP JWKS cache TTL bounded; rotation requires AEGIS-side cooperation; audit chain provides tamper evidence    | Partial    |
| IM-T7  | Clock skew exploitation (TTL window evasion)         | Medium     | Low      | Tight 30–60 s TTL; `manifest-expired` + `manifest-not-yet-valid` mismatch kinds; RP NTP required             | Partial    |
| IM-T8  | Cross-tenant manifest read                           | Low        | High     | `principalId` enforced on every load; 404-on-mismatch anti-enumeration (intent.service.ts:149)                | Covered    |
| IM-T9  | BATE signal poisoning via advisory mode              | Medium     | Medium   | Per-window cap (300) and trust-band floor; relying parties self-select advisory at their own risk             | Partial    |
| IM-T10 | TTL extension (issued late, expires after action)    | Low        | Low      | TTL bounds clamped server-side `[30, 60]` (intent.module.ts:113); RP rejects expired manifests on reconcile  | Covered    |
| IM-T11 | Audit signer compromise → manifest forgery at scale  | Low        | Critical | KMS provider posture; audit chain divergence detection; rotation procedure tested                             | Partial    |
| IM-T12 | Database write-compromise mutating manifest rows     | Low        | High     | Signed body — mutation breaks signature on next verify; signed audit chain is ground truth                    | Covered    |
| IM-T13 | Manifest issued for revoked agent                    | Low        | Medium   | Agent revocation propagates to verify path; intent issuance gated by ApiKeyGuard + agent-belongs-to-principal | Partial    |
| IM-T14 | Idempotency-Key collision across distinct manifests  | Low        | Low      | Unique constraint scoped to `(manifestId, idempotencyKey)`; collision across manifests is harmless            | Covered    |

---

## Attack scenarios — narrative detail

### IM-T2 — Cross-RP manifest replay

**Scenario.** An AI shopping agent at relying party RP-A obtains a signed
manifest declaring "spend up to $200 at ACME-FLORIST." The agent (or an
attacker who intercepted the manifest) then presents the same manifest to
relying party RP-B (a different merchant), hoping RP-B will honor the
$200 cap and process a charge.

**Defense.** The manifest body includes `verifyTokenJti` and
`verifyTokenSha256B64Url` (mandatory fields per `IntentManifestBody`).
RPs MUST cross-check these against the verify token they're about to
honor. RP-B's verify token has a different `jti`, so the binding fails.

**Defense (closed in follow-up).** The `verifyTokenJti` cross-check is
now a REQUIRED input to `verifyIntent` (`packages/verifier-rp/src/intent.ts`
`VerifyIntentInput.expectedVerifyTokenJti`). Omitting it is a TypeScript
compile-error, not a runtime warning — forgetful integrators cannot ship
the unsafe variant by accident. Optional `expectedVerifyTokenSha256B64Url`
provides belt-and-braces against the (rare) jti-collision case where the
same jti was issued for two different verify-token bodies. Status moved
from "Partial" to "Covered" as of this commit.

### IM-T3 — Scope overrun (declared X, did Y)

**Scenario.** Agent declares an intent to `BUY 100 AAPL @ $195 limit`
but the OMS receives `BUY 100 AAPL @ MARKET` (different order type) or
`BUY 200 AAPL @ $195 limit` (different quantity).

**Defense.** `reconcileIntent` walks every actual against the declared
intent and emits typed `IntentMismatch` entries. In strict mode (default),
any mismatch → `recommendedDenialReason = 'INTENT_MISMATCH'`. The closed
8-kind enum maps directly to compliance ledger entries (broker-dealer
FINRA Rule 3110 example in `examples/intent-broker-dealer-finra/`).

**Cross-RP penalty.** Even if the RP that detects the mismatch is
advisory-only, the `INTENT_MISMATCH_OBSERVED` BATE signal fires
(`-100` per signal, capped at `-300` per window per
`bate.weights.ts:57`). The agent's trust score drops, and the next
`/v1/verify` against ANY relying party returns `TRUST_SCORE_TOO_LOW`.
This is the architectural payoff: penalty travels.

### IM-T4 — Beneficiary substitution (treasury vertical)

**Scenario.** An AI treasury agent declares an `iso20022.pacs.008` wire
to beneficiary `BENEF_GMBH_DE89AB`. The agent is compromised mid-flight
(prompt injection or token theft) and the actual SWIFT MT103 is sent
to `ROGUE_LLC_GB99XX`. The cost is unrecoverable in seconds.

**Defense.** `wrong-merchant` mismatch is ALWAYS strict regardless of
the reconciliation policy's tolerance setting — `reconcile.ts:232`'s
`mapDenialReason` only relaxes `over-call-count` under `graduated`.
This is **footgun-by-design**: operators who set `tolerance: 5` to
accommodate FX rounding still get strict denial on wrong-beneficiary.

**Operator guidance.** The treasury example
(`examples/intent-treasury-iso20022/README.md`) documents this
explicitly so an operator doesn't wrongly assume graduated mode
loosens all checks.

**Gap.** The `merchantId` field is OPTIONAL on `CommerceActionClaim`.
If the operator omits it, no wrong-merchant check fires. **Mitigation
guidance:** for any vertical where the counterparty identity is the
critical binding (treasury, payments to known merchant, broker-dealer
venue routing), the operator MUST populate `merchantId` (or
`merchantDomain`). Add this to per-vertical RP onboarding.

### IM-T6 — Signing key substitution at JWKS

**Scenario.** An attacker compromises the `/.well-known/audit-signing-key`
endpoint or its CDN cache and serves an attacker-controlled JWKS. The
attacker then forges manifests signed under their key; relying parties
whose JWKS cache fetches the malicious endpoint verify them as valid.

**Defense.**

- JWKS is served with cache-control headers; the rotation cadence is
  bounded by the cache TTL.
- The audit chain itself is signed under the same key family — any
  successful key substitution attack ALSO compromises audit chain
  integrity, which is detected by `aegis_audit_chain_verifier` periodic
  checks.
- TLS pinning at the AEGIS API and CDN is the perimeter defense.

**Partial.** JWKS cache poisoning at the relying-party CDN is outside
AEGIS's control. Documentation should advise RPs to set short JWKS cache
TTLs (≤ 60 s) for high-value verticals.

**OD-019 relevance.** Separating intent-signing key from audit-signing
key (per OD-019) would limit the blast radius: a substituted intent key
would NOT compromise audit chain integrity, and detection would have to
happen via a different surface (intent-specific signature divergence).
This is the defense-in-depth argument for OD-019.

### IM-T7 — Clock skew exploitation

**Scenario.** A relying party's clock is significantly off (e.g. +5 min).
A manifest issued at AEGIS time `t` with `expiresAt = t + 60` is read by
the RP at perceived time `t + 5m`. The RP thinks the manifest expired;
RP rejects. Conversely: RP clock is `-5m` skewed; RP accepts a manifest
AEGIS has already considered expired.

**Defense.** The 30–60 s TTL window is tight enough that even a 1-minute
clock skew fully invalidates a manifest from the RP's view. Both
`manifest-expired` and `manifest-not-yet-valid` are closed-enum
mismatch kinds the RP surfaces explicitly.

**Operator guidance.** RPs MUST run NTP. The operator runbook should
flag clock-sync as a prerequisite.

### IM-T8 — Cross-tenant manifest read

**Scenario.** Principal A guesses or exfiltrates principal B's
`manifestId` and calls `GET /v1/intent/{manifestId}` to read the body
(which contains intent details — for ACP, that's spending intent; for
treasury, that's beneficiary + amount).

**Defense.** `IntentService.get()` reads by `manifestId`, then asserts
`principalId` match. On mismatch, returns `null` → controller returns
404 (same shape as "not found"). Anti-enumeration: attacker cannot
distinguish "manifest doesn't exist" from "exists but not yours."

**Defense bonus.** `manifestId` is a ULID (`int_<26-char-ulid>`) — ~128
bits of entropy. Brute-force enumeration is infeasible at any practical
attacker scale.

### IM-T9 — BATE signal poisoning via advisory mode

**Scenario.** A malicious relying party configures `advisory` mode to
trigger `INTENT_MISMATCH_OBSERVED` signals against a victim agent
without denying the actual action. The signals drop the victim's
trust score, causing legitimate verify denials at other RPs.

**Defense.**

- BATE per-window cap of `-300` (3× the `-100` per-signal weight per
  `bate.weights.ts:99`) limits how much a single window can move the
  score. Repeated targeting over time is needed for sustained impact.
- Trust band cutoffs are at fixed values (`PLATINUM 750+`,
  `VERIFIED 500-749`, `WATCH 250-499`, `FLAGGED 0-249`); demoting an
  agent from PLATINUM to FLAGGED via mismatch alone requires
  `(750 - 250) / 100 = 5` cap-binding windows — at least multiple hours
  of sustained attack.
- The relying party's `reportWeight` (`RELYING_PARTY_WEIGHT_FLOOR=0.25`
  per `bate.weights.ts:128`) means an unverified RP's signals are
  weighted down.

**Partial.** A coalition of malicious-or-compromised RPs running in
advisory mode could collectively poison a victim's score. Mitigation:
operator should investigate sustained mismatch patterns from specific
RPs; verified RP onboarding should be the default.

### IM-T11 — Audit signer compromise

**Scenario.** The KMS-backed audit signing key (or its env fallback
in non-KMS deployments) is exfiltrated. The attacker can:

1. Forge new manifests for any agent at any RP.
2. Sign fake audit chain entries that look authentic.
3. The entire audit history becomes retroactively suspect.

**Defense.**

- KMS provider posture (per `docs/SECURITY.md`) — the key never leaves
  the HSM in production; env fallback is explicitly dev-only.
- Audit chain divergence detection: `aegis_audit_chain_verifier`
  periodic job recomputes the chain hash and alerts on mismatch.
- Rotation procedure (per `infra/observability/runbooks/`) covers the
  audit key family.

**OD-019 mitigation.** Separating intent-signing from audit-signing
limits this scenario: a compromised audit key still forges audit
entries, but intent manifests would require the separate intent key.
The cost of OD-019 is two rotation stories instead of one.

**Detection.** Anomalous signing patterns in `/metrics`
(`aegis_audit_signer_signed_total` rate spikes), structured-log
`msg=audit_signer_failure` entries, canary verifier checks.

**Response.** Rotate audit signing key; relying parties refresh JWKS
(forced by short cache TTL); replay audit chain from last known-good
checkpoint to identify tampered entries.

---

## Cryptographic choices

| Use                       | Algorithm                                    | Why                                                                                          |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Manifest body signing     | Ed25519 (`@noble/ed25519` v2)               | Same primitive as audit chain (ADR-0011) + verify tokens; one curve, one audited library    |
| Canonical pre-image       | `canonicalize()` — sorted-key JSON           | Stable bytes across runtimes; CF Worker / Nest / browser produce identical pre-images       |
| Signing key custody       | KMS (M-051) or env-derived (dev fallback)   | KMS for prod; env fallback rejected by `optional-kms-provider` preflight in production       |
| Signature encoding        | base64url                                    | URL-safe; matches verify-token + audit-chain convention                                      |
| Idempotency-key transport | HTTP header `Idempotency-Key`               | Standard pattern; deep-body equality is the canonical check                                  |
| Manifest ID generation    | ULID (`int_<26-char>`)                       | ~128 bits entropy; lexicographically sortable for time-ordered queries; same as audit-event-id |

### Pre-image domain separation note

`packages/intent-manifest/src/manifest.ts:6-10` flags a known issue:
the canonical pre-image is `canonicalize(body)` with NO domain
separator. If a future change shares the signing key family between
audit chain and intent manifests AND the audit chain pre-image format
is similar enough that a cross-protocol signature substitution becomes
feasible, we MUST add a domain-separation byte (`"intent-v1:"` prefix).
Currently the audit chain's pre-image shape is structurally different,
so this is a latent risk, not an active one. Documented for future
schema changes.

---

## Defense-in-depth recommendations

1. **Operators should consider OD-019** (separate intent-signing key) before high-volume rollout to verticals with adversarial threat models (treasury, broker-dealer).
2. **Relying parties should set `graduated` tolerance to `0`** (or use `strict` instead) for high-value verticals. Tolerance is for legitimate batch overrun (e.g. paying 10 invoices when you said up to 12), NOT for amount/merchant flexibility.
3. **RP-side strict mode should be default**; advisory only for telemetry sandboxes. The operator runbook
   (`docs/runbooks/intent-manifest-enable.md`) flags this.
4. **JWKS cache TTL should be ≤ manifest TTL** (60 s) for high-rotation deployments. Faster rotation means smaller compromise window.
5. **Always populate `merchantId` (or `merchantDomain`)** for `commerce-action` intents where the counterparty identity is critical. Omitting it disables the `wrong-merchant` check.
6. **Cross-check `verifyTokenJti` at the RP** before honoring the manifest. Currently caller responsibility; should be moved into `verifyIntent` as a required input — **filed for follow-up.**
7. **Run NTP at the RP.** Clock skew beyond manifest TTL window invalidates the binding.
8. **Per-vertical reconciliation policy** should be documented in RP onboarding. Defaults are deliberately strict; loosening them is a deliberate operator choice with documented trade-offs.

---

## Key compromise scenarios

### Audit signing key compromise (M-051)

- **Impact:** all manifest signatures retroactively suspect; all future signatures forgeable; audit chain integrity broken.
- **Detection:** anomalous signing patterns in `/metrics`; periodic `aegis_audit_chain_verifier` divergence; canary verifier checks.
- **Response:** rotate audit signing key via KMS rotation procedure; relying parties refresh JWKS (forced by short cache TTL); replay audit chain from last known-good checkpoint.
- **OD-019 impact:** if separate intent key shipped, audit compromise does NOT compromise manifests.

### Agent private key compromise

- **Impact:** attacker submits verify tokens AS the agent, can request manifest issuance.
- **Detection:** BATE anomaly signals (`VELOCITY_ANOMALY`, `GEOGRAPHIC_INCONSISTENCY`, `INTENT_MISMATCH_OBSERVED` if attacker overruns scope).
- **Response:** revoke the agent (`DELETE /agents/:id`); trust score floors to 0; downstream `/v1/verify` denials; existing manifests in-flight expire within 60 s.

### Database compromise (read-only)

- **Impact:** attacker reads all manifest contents — for ACP that's spending intent, for treasury that's beneficiary + amount, for broker-dealer that's order details.
- **Mitigation:** assume database contents are NOT confidential; the wire surface is already exposed to relying parties. Manifest bodies are NOT secret — they're declarations meant to be verified by third parties.
- **Response:** rotate keys; review audit chain integrity (which signs over manifest IDs not bodies); standard DB intrusion procedure.

### Database compromise (read-write)

- **Impact:** attacker can mutate `IntentManifest` rows (delete, edit, insert).
- **Defense:** signed body — any mutation breaks signature on the next `verifyManifest` call. Relying parties' offline verification catches the tampering.
- **Defense bonus:** the FK from `IntentActual.manifestId` has `ON DELETE RESTRICT` (per migration `20260516000000_add_intent_manifest_phase21`) — attacker cannot orphan reconciliation evidence by deleting manifests.
- **Detection:** signature verification failures at load time; structured-log spike in `intent_unexpected_failure` or `bate.ingestSignal rejected`.
- **Response:** audit chain is the ground truth; reconstruct from chain entries (which are signed independently).

---

## Operator security checklist

Before enabling intent-manifest in production:

- [ ] KMS provider configured (NOT env fallback) for audit signing key — verify via preflight `optional-kms-provider` check.
- [ ] Audit signing key rotation procedure tested in staging — confirms JWKS cache invalidation propagates to RPs.
- [ ] JWKS cache headers tuned for the rotation cadence — recommended `Cache-Control: max-age=60` for hot-rotation deployments.
- [ ] Relying party documentation explicitly warns about `advisory` mode — see `examples/intent-fintech-acp/README.md` for the recommended language.
- [ ] BATE `INTENT_MISMATCH_OBSERVED` weight tuned for the deployment risk profile (default `-100` with cap `300` per `bate.weights.ts:57`; raise for adversarial verticals).
- [ ] Per-vertical reconciliation policy recommendations published to RP onboarding (strict for treasury + broker-dealer; graduated with low tolerance for ACP batched payments only).
- [ ] NTP verified on RP infrastructure — clock skew within 30 s.
- [ ] Operator runbook (`docs/runbooks/intent-manifest-enable.md`) walkthrough completed by deploy team.

---

## Compliance touchpoints

| Standard            | Where intent-manifest contributes                                                                                                                                                                                                                                                                                                                                                                                       | Phase |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **SOC2 CC6.1**      | Logical access controls — `principalId` enforced on every manifest load + 404 anti-enumeration on cross-tenant access (`intent.service.ts:149`).                                                                                                                                                                                                                                                                       | 0     |
| **SOC2 CC6.7**      | System operations — change management — `INTENT_MISMATCH_OBSERVED` audit chain entries provide tamper-evident record of every reconciliation outcome. Append-only per CLAUDE.md invariant #3.                                                                                                                                                                                                                       | 0     |
| **SOC2 CC7.2**      | System monitoring — `/metrics` exposes 5 intent-specific Prometheus counters + histograms; structured logs cover every issuance + reconciliation + algorithm failure path.                                                                                                                                                                                                                                          | 0     |
| **NIST AI Agent Identity** (Feb 2026 concept paper) | Intent binding closes gap #5 from the May 2026 agentic-landscape audit — no other platform vendor structurally binds tokens to declared intent.                                                                                                                                                                                                                          | 0     |
| **FAPI 2.0 (RAR analog)** | The intent-manifest claim shape (`CommerceActionClaim`) is a richer-typed parallel to FAPI 2.0 Rich Authorization Requests. Where FAPI 2.0 RAR binds token issuance to action shape, AEGIS intent manifest binds token USE to action shape and adds runtime reconciliation evidence. Complementary, not competing.                                                                                          | 0     |
| **PCI DSS 6.4.x**   | For ACP merchants — intent binding provides cryptographic evidence that the agent's actual charge matched the user's authorized intent. Auditor-replayable supervision trail without storing card data in AEGIS.                                                                                                                                                                                                  | 0     |
| **FINRA Rule 3110** | For broker-dealers — `examples/intent-broker-dealer-finra/README.md` documents the `IntentMismatchKind` → supervisory ledger event mapping. Cryptographic supervision trail satisfies the "reasonable supervision" requirement for AI-mediated order routing.                                                                                                                                                       | 0     |
| **ISO 20022 (treasury)** | For corporate treasury — `iso20022.pacs.008` intent declaration + reconciliation gives the CFO a non-repudiable record of every wire's pre-execution intent and post-execution actual. Beneficiary substitution defense via strict `wrong-merchant` is the central control.                                                                                                                                  | 0     |

---

## Reference

| Artifact                                                          | Purpose                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `docs/THREAT_MODEL.md`                                            | Master AEGIS threat model — start here for platform-level threats                       |
| `docs/SECURITY.md`                                                | AEGIS security policy + KMS posture                                                     |
| `docs/decisions/0016-intent-manifest-kernel.md`                   | Kernel design + claim shape lock                                                        |
| `docs/decisions/0017-intent-manifest-runtime-issuance.md`         | Phase 2 runtime design (D1/D2/D3); OD-018/019/020 catalog                                |
| `docs/runbooks/intent-manifest-enable.md`                         | Operator runbook for production flip                                                    |
| `packages/intent-manifest/src/types.ts`                           | `IntentClaim` discriminator union + `IntentMismatchKind` closed enum                    |
| `packages/intent-manifest/src/manifest.ts:6-10`                   | Domain-separation note for future signing-key sharing                                   |
| `packages/intent-manifest/src/reconcile.ts:232`                   | `mapDenialReason` — graduated tolerance only relaxes `over-call-count`                  |
| `packages/verifier-rp/src/intent.ts`                              | Relying-party offline verification surface (`verifyIntent`)                              |
| `apps/api/src/modules/intent/intent.service.ts:149`               | Cross-tenant 404 anti-enumeration                                                        |
| `apps/api/src/modules/intent/intent.module.ts:113`                | TTL bounds clamp                                                                         |
| `apps/api/src/modules/bate/bate.weights.ts:57`                    | `INTENT_MISMATCH_OBSERVED` weight (-100) + cap (300)                                     |
| `examples/intent-fintech-acp/README.md`                           | ACP vertical operator guidance                                                          |
| `examples/intent-treasury-iso20022/README.md`                     | Treasury vertical + graduated-mode footgun documentation                                 |
| `examples/intent-broker-dealer-finra/README.md`                   | FINRA Rule 3110 supervisory mapping                                                     |

### Filed follow-ups from this threat model

1. ~~IM-T2 mitigation gap — move `verifyTokenJti` cross-check into `verifyIntent` as a required input.~~ **DONE** in follow-up commit (see status `Covered` above).
2. **IM-T6 / IM-T11 mitigation** — implement OD-019 (separate intent-signing key family) to limit blast radius of audit-key compromise.
3. **Domain separation** — when intent-manifest schema version bumps (v1 → v2), add explicit `"intent-v1:"` domain-separation byte to canonical pre-image to prevent cross-protocol signature substitution.
4. **RP onboarding checklist** — publish per-vertical reconciliation policy recommendations as a separate doc (`docs/RP_ONBOARDING_INTENT.md`).
