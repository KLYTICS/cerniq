# RP Onboarding — AEGIS Intent Manifest

> Per-vertical integration guide for the developer at a relying party
> (merchant, treasury platform, broker-dealer) wiring `@aegis/verifier-rp`
> into their request path. Companion to the AEGIS-side operator runbook
> (`docs/runbooks/intent-manifest-enable.md`) and the security model
> (`docs/THREAT_MODEL_INTENT_MANIFEST.md`).
>
> Closes the documentation-side mitigation for OD-019.c (IM-T4 —
> `merchantId`-optional gap). Cited in the IM-T4 threat entry as the
> companion to the per-vertical example READMEs.
>
> Last reviewed: `2026-05-16`. Reflects code as of commits `5e44480`
> (Phase 2 module + ADR-0017), `7b36258` (`verifier-rp.verifyIntent` +
> `sdk-ts.IntentClient` + OpenAPI), `e5b696c` (vertical examples),
> `2cabeba` (Phase 2.1 Prisma adapter), `06ffff9` (IM-T2 fix —
> `expectedVerifyTokenJti` required), `cc7fa14` (threat model addendum),
> `0fd8018` (operator runbook).

---

## TL;DR

Three lines on the RP side, plus the keyword `expectedVerifyTokenJti`:

```ts
import { verifyIntent } from '@aegis/verifier-rp';

const outcome = verifyIntent({
  manifest,                                     // SignedIntentManifest from your handler input
  actuals: [observationFromRequest(req)],       // your domain-specific observation
  publicKeysByKid: await aegisJwks.keys(),      // cached /.well-known/audit-signing-key
  expectedVerifyTokenJti: verifyJwt.jti,        // REQUIRED — compile-error if omitted
});
if (outcome.kind === 'denied') return res.status(403).json({ reason: outcome.reason.kind });
```

`expectedVerifyTokenJti` is a **required** input as of commit `06ffff9`
(closes IM-T2 cross-RP manifest replay — see threat model entry IM-T2
and `packages/verifier-rp/src/intent.ts:71`). Omitting it is a
TypeScript compile-error, not a runtime warning.

---

## Per-vertical configuration matrix

Concrete defaults for the three shipped verticals. Operators MUST treat
every "merchantId REQUIRED" cell marked `YES` as policy — see warning 2
in § 5 for the IM-T4 footgun this defends against.

| Vertical                  | Recommended action verb                          | merchantId REQUIRED? | Rationale                                                                                                                                                       | `ReconciliationStrictness`                                          | Amount cap structure                                                                       |
| ------------------------- | ------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **ACP merchant**          | `acp.payment` (e.g. `stripe.charge`, `adyen.checkout`) | **YES**              | Counterparty merchant identity IS the binding — agent purported to charge MERCHANT-X must not silently land at MERCHANT-Y. Per `examples/intent-fintech-acp/README.md`. | `strict` (default)                                                  | `{ amount: "200.00", currency: "USD" }` — per-call cap; ISO 4217 currency code             |
| **Treasury (ISO 20022)**  | `iso20022.pacs.008` (or `pacs.009`, `pain.001`)  | **YES — beneficiary IBAN/BIC** | Wrong-beneficiary is unrecoverable in seconds. `merchantId` carries the beneficiary identifier (IBAN `DE89...` or BIC + acct). Per `examples/intent-treasury-iso20022/README.md`. | `graduated` tolerance ≤ 5% OR `strict`. Non-count mismatches stay strict regardless — `packages/intent-manifest/src/reconcile.ts:232`. | `{ amount: "50000.00", currency: "EUR" }` — ISO 4217; EUR/USD/GBP per corridor             |
| **Broker-dealer (FINRA)** | `finra.equity.buy` / `finra.equity.sell` (per side) | **YES — venue MIC** | `merchantId` carries the venue (`NASDAQ`, `NYSE`, `IEX`, MIC code). A routing-table compromise that silently rewrites venue is caught the same as a wrong agent. Per `examples/intent-broker-dealer-finra/README.md`. | `strict` — no tolerance on equity orders. FINRA Rule 3110 leaves no room. | `{ amount: "19500.00", currency: "USD" }` — notional cap (qty × limit price). Per-call.    |

### IntentMismatchKind → vertical supervisory-event mapping

The kernel's closed-enum `IntentMismatchKind`
(`packages/intent-manifest/src/types.ts:173`) routes directly into
each vertical's supervisory ledger. No free-form parsing — switch
on the enum value.

| `IntentMismatchKind`      | ACP merchant                          | Treasury (ISO 20022)                                  | Broker-dealer (FINRA Rule 3110)                |
| ------------------------- | ------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `wrong-endpoint`          | Wrong action verb (charge → refund)   | Wrong message type (`pacs.008` → `pacs.009`)          | Wrong side / symbol / order type               |
| `wrong-method`            | n/a (commerce-action)                 | n/a                                                   | n/a                                            |
| `wrong-merchant`          | Wrong merchant → chargeback risk      | **Wrong beneficiary → FinCEN suspicious-activity**    | Wrong venue (routing-table compromise)         |
| `over-amount-cap`         | Over-charge (refund + dispute)        | Over-wire (treasury policy breach)                    | Oversized notional (slippage / attack)         |
| `over-call-count`         | Duplicate charge                      | Duplicate wire                                        | Duplicate order submission                     |
| `arg-shape-mismatch`      | n/a (commerce-action)                 | n/a                                                   | n/a (commerce-action verticals)                |
| `manifest-expired`        | Stale-intent attempt → 403            | Stale-intent attempt → wire blocked                   | Stale-intent execution attempt                 |
| `manifest-not-yet-valid`  | Clock skew or replay → 403            | Clock skew or replay → wire blocked                   | Clock skew or replay                           |

For broker-dealers specifically the kind → Rule 3110 mapping is already
documented in `examples/intent-broker-dealer-finra/README.md` (mismatch
table, lines 48–60). Treasury platforms should mirror that pattern into
their internal CFO supervision dashboard.

---

## The integration code pattern

The wire surface delivers a `SignedIntentManifest` alongside the verify
token. Your existing `AegisVerifier` already decodes the verify JWT —
extract `jti` from there and pass it to `verifyIntent`.

```ts
import { verifyIntent } from '@aegis/verifier-rp';
import type { SignedIntentManifest } from '@aegis/intent-manifest';

// Your existing JWKS cache for the AEGIS audit signing key family.
// Same key bag the verify-token verifier already uses (ADR-0011 §3 +
// ADR-0017 — intent manifests share the audit signing key family).
const aegisJwks = createJwksCache({
  url: 'https://api.aegis-labs.com/.well-known/audit-signing-key',
  ttlSeconds: 60,                      // ≤ manifest TTL; see § 4
});

app.post('/api/charge', async (req, res) => {
  // Your existing AegisVerifier already decoded the verify token.
  // Extract jti from its decoded claims.
  const verifyJwt = req.aegis.decoded;            // { sub, jti, iat, exp, ... }
  const manifest: SignedIntentManifest = req.body.intentManifest;

  const outcome = verifyIntent({
    manifest,
    actuals: [observationFromRequest(req)],       // ActualCallObservation[]
    publicKeysByKid: await aegisJwks.keys(),
    // REQUIRED — closes IM-T2 cross-RP manifest replay (commit 06ffff9).
    // Compile-error if omitted; do NOT alias to `undefined` to silence it.
    expectedVerifyTokenJti: verifyJwt.jti,
    // OPTIONAL — belt-and-braces for treasury / broker-dealer where a
    // jti collision (rare) would otherwise allow body substitution.
    // expectedVerifyTokenSha256B64Url: sha256B64Url(verifyTokenBytes),
  });

  if (outcome.kind === 'denied') {
    // Closed enum: 'manifest_signature' | 'verify_token_binding_mismatch'
    //            | 'reconciliation_mismatch'
    return res.status(403).json({ reason: outcome.reason.kind });
  }

  // ...process the charge / dispatch the wire / route the order...

  // Async-emit actuals back to AEGIS for the cross-RP penalty travel.
  // Idempotency-Key MUST be unique per distinct reconciliation attempt.
  await aegisClient.intent.recordActuals({
    manifestId: manifest.body.manifestId,
    idempotencyKey: req.id,                       // your request id
    actuals: [actualPayloadFromHandler(req)],
  });
});
```

### What `verifyIntent` does in order

Per `packages/verifier-rp/src/intent.ts:121-188`, the function runs
three checks in fixed order. Each step assumes prior steps passed:

1. **Signature integrity** — `verifyManifest()` over the canonical
   pre-image. Fail → `denied { kind: 'manifest_signature' }` with the
   kernel cause.
2. **Verify-token binding** — `manifest.body.verifyTokenJti ===
   expectedVerifyTokenJti`. Fail → `denied
   { kind: 'verify_token_binding_mismatch', field: 'jti', ... }`. Optional
   SHA-256 cross-check fires after this if you passed
   `expectedVerifyTokenSha256B64Url`.
3. **Semantic reconciliation** — `reconcileIntent()` walks every
   actual against the declared intent. Fail (per strictness policy)
   → `denied { kind: 'reconciliation_mismatch', result }` with the
   typed `IntentMismatch[]` array. Otherwise `approved`.

Never throws on user-recoverable failure. Throws ONLY on structurally
illegal inputs (non-`Uint8Array` public keys, missing fields the type
system already prevents) — those are programmer errors, not RP-runtime
errors.

---

## JWKS caching guidance

The AEGIS audit signing key family is published at
`/.well-known/audit-signing-key`. Your verifier caches it; AEGIS is NOT
on your hot path post-issuance (per IM-T6 defense + threat model §
"Trust assumptions" item 3).

| Vertical                  | Recommended JWKS cache TTL | Why                                                                                                                                                                  |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ACP merchant**          | ≤ 60 s                     | Matches `intent.module.ts:113` TTL upper bound; rotation completes within one manifest window.                                                                       |
| **Treasury (ISO 20022)**  | ≤ 60 s                     | Wire dispatch latency dominates; shorter TTL means a smaller compromise window if AEGIS rotates emergency keys post-incident.                                        |
| **Broker-dealer (FINRA)** | ≤ 60 s                     | Pre-trade and post-trade are both on this cache; sub-minute rotation ceiling keeps the Rule 3110 evidence trail anchored to currently-trusted keys.                  |

### Why ≤ manifest TTL

A stale JWKS cache that outlives manifest TTL re-opens the IM-T6
threat (signing-key substitution at JWKS — see threat model entry).
Concretely: if AEGIS rotates the audit signing key in response to a
compromise alert and your RP cache holds the old key for 5 minutes,
a manifest forged under the compromised key during that window
verifies as valid.

The audit chain itself is signed under the same key family —
`aegis_audit_chain_verifier` periodic checks detect chain divergence
on the AEGIS side, but RP-side detection requires fresh JWKS. Keep
the cache TTL at or below the manifest TTL (`60 s`) and you bound
the RP-side exposure to one manifest window.

OD-019.a (separate intent signing key) would limit blast radius
further — under a separate key, an audit-key compromise would NOT
forge manifests. Until OD-019.a lands, the shared-key reality means
a fast JWKS rotation cadence at the RP is the primary defense.

---

## Operator-side warnings — what NOT to do

Each warning below cites the specific defense it preserves. Treat
violations as production-blocking review findings.

### 1. DON'T use `advisory` mode in production for high-value verticals

`advisory` strictness records mismatches but issues NO denial
(`packages/intent-manifest/src/reconcile.ts:226`). The `INTENT_MISMATCH_OBSERVED`
BATE signal still fires (cross-RP penalty travels), but YOUR handler
processes the deviant action.

Acceptable use: telemetry-only sandbox where you want forensic
visibility before turning on enforcement. Unacceptable use: any
treasury / broker-dealer / ACP path in production.

Threat connection: IM-T9 (BATE signal poisoning via advisory mode).
A coalition of advisory-mode RPs can collectively poison a victim
agent's trust score — operator should default to `strict`.

### 2. DON'T omit `merchantId` for treasury / broker-dealer (IM-T4 footgun)

`CommerceActionClaim.merchantId` is OPTIONAL in the kernel type
(`packages/intent-manifest/src/types.ts:105`). If you omit it, the
`wrong-merchant` mismatch check is **silently disabled** — the
reconciler has no declared counterparty to compare against.

For ACP this is recoverable via chargeback. **For treasury and
broker-dealer it is not.** A wire to the wrong account or a route
to the wrong venue is the entire attack the intent manifest exists
to prevent.

Per IM-T4 mitigation guidance and OD-019.c, the operator policy is:

- **Treasury (`iso20022.pacs.008`, `pacs.009`, `pain.001`):**
  `merchantId` MUST carry the beneficiary IBAN or BIC + account. Never
  omit. Reject manifests at your gateway that have `kind:
  'commerce-action'` + an `iso20022.*` action + missing `merchantId`.
- **Broker-dealer (`finra.equity.*`, `finra.option.*`):** `merchantId`
  MUST carry the venue MIC code (`NASDAQ`, `NYSE`, `IEX`, `BATS`).
  Never omit. Reject manifests that have `kind: 'commerce-action'` +
  a `finra.*` action + missing `merchantId`.
- **ACP merchants (`acp.payment`, payment-rail charges):** `merchantId`
  SHOULD carry the merchant identifier. Omission only acceptable for
  rare flows where merchant is genuinely runtime-determined (e.g.
  marketplace facilitator with split routing).

OD-019.c proposes mechanizing this via a per-claim-action policy that
flags `merchantId`-required action verbs and rejects manifests that
omit it. Until OD-019.c lands, this is RP-side enforcement
responsibility — document it in your gateway code.

### 3. DON'T forget `expectedVerifyTokenJti`

Now a TypeScript compile-error per commit `06ffff9`
(`packages/verifier-rp/src/intent.ts:71`). Flagging it here for the
edge case of `// @ts-ignore` discipline failures or JavaScript callers
without type checks.

If you find yourself wanting to pass `undefined` to silence the
compiler: STOP. The threat (IM-T2 cross-RP manifest replay) is
real — an attacker who intercepts a manifest issued for verify-token
T against RP-A can present it to RP-B (different jti) and have
RP-B honor it as long as the signature checks out. The jti binding
is the entire defense.

If the verify token genuinely lacks a `jti` (it shouldn't —
AEGIS-issued tokens always include one), the integration is
mis-wired upstream.

### 4. DON'T skip NTP on the RP host

Manifest TTL is clamped server-side to `[30, 60]` seconds
(`apps/api/src/modules/intent/intent.module.ts:113`). Clock skew
beyond the TTL window means manifests AEGIS considers valid get
rejected by your RP as `manifest-expired` (or `manifest-not-yet-valid`
in the negative-skew direction).

Threat connection: IM-T7 (clock skew exploitation). The tight 30–60 s
TTL is the defense; it depends on RP-side time sync.

Requirement: NTP or equivalent on every RP host that calls
`verifyIntent`. Verify with `chronyc tracking` or equivalent; aim
for offset within 30 s of the AEGIS API's clock.

---

## Reference

| Artifact                                                                   | Purpose                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `docs/decisions/0016-intent-bound-attestation.md`                          | Kernel design — claim shape lock, strictness semantics, denial-reason wire string                                  |
| `docs/decisions/0017-intent-manifest-runtime-issuance.md`                  | Phase 2 runtime issuance design (D1/D2/D3); OD-018/019/020 sub-decision catalog                                    |
| `docs/runbooks/intent-manifest-enable.md`                                  | Operator-side production flip sequence + smoke + observability                                                     |
| `docs/THREAT_MODEL_INTENT_MANIFEST.md`                                     | Security model — 14 numbered threats (IM-T1 … IM-T14), per-vertical compliance touchpoints, key-compromise scenarios |
| `examples/intent-fintech-acp/`                                             | ACP merchant runnable demo — strict mode, $200 USD cap, merchant binding                                           |
| `examples/intent-treasury-iso20022/`                                       | Treasury runnable demo — `iso20022.pacs.008`, graduated 5%, beneficiary binding (IM-T4 footgun documented)         |
| `examples/intent-broker-dealer-finra/`                                     | Broker-dealer runnable demo — `finra.equity.buy`, strict mode, venue binding (Rule 3110 mapping table)             |
| `packages/verifier-rp/src/intent.ts`                                       | `verifyIntent` — the function this guide integrates                                                                |
| `packages/verifier-rp/src/intent.ts:71`                                    | `expectedVerifyTokenJti` REQUIRED input — IM-T2 closure                                                            |
| `packages/intent-manifest/src/types.ts:88`                                 | `IntentClaim` discriminated union (`http-call` / `commerce-action` / `tool-invocation`)                            |
| `packages/intent-manifest/src/types.ts:100-111`                            | `CommerceActionClaim` shape — note `merchantId?` (the IM-T4 gap)                                                   |
| `packages/intent-manifest/src/types.ts:173-181`                            | `IntentMismatchKind` closed enum (8 values)                                                                        |
| `packages/intent-manifest/src/reconcile.ts:215-238`                        | `mapDenialReason` — graduated tolerance only relaxes `over-call-count`; non-count mismatches stay strict           |
| `apps/api/src/modules/intent/intent.module.ts:113`                         | TTL bounds clamp `[30, 60]` seconds                                                                                |
| `apps/api/src/modules/bate/bate.weights.ts:57`                             | `INTENT_MISMATCH_OBSERVED` weight (−100) + per-window cap (300) — cross-RP penalty math                             |
| `OPERATOR_DECISIONS.md` OD-019                                             | Five sub-decisions surfaced by the Phase 2/2.1 cascade — this doc closes OD-019.c documentation-side               |

### Related runbooks

- `docs/runbooks/intent-manifest-enable.md` — AEGIS operator runbook for the production flip.
- `docs/runbooks/denial-reasons.md` — wire-level denial reason catalog (`INTENT_MISMATCH` at position 11).

### Open follow-ups that affect RP integrators

- **OD-019.a — Separate intent-signing key family.** Until landed, the
  audit and intent signing keys share a family. Treasury and
  broker-dealer integrators should keep JWKS TTL ≤ 60 s as the primary
  defense-in-depth control.
- **OD-019.b — Verify-wire emission of intent decision.** Today
  `/v1/intent/{id}/actuals` is the only surface emitting
  `INTENT_MISMATCH`. If OD-019.b lands in Phase 3, `/v1/verify` will
  emit it inline — your `AegisVerifier` will surface the denial without
  a separate `verifyIntent` call. Plan integration accordingly.
- **OD-019.c — `merchantId`-required action-verb policy.** Until
  landed, the warning in § 5.2 is RP-side responsibility. Once landed,
  AEGIS-side issuance will reject manifests that omit `merchantId` for
  registered high-value action verbs — your gateway-side check becomes
  belt-and-braces.
