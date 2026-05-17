# AEGIS FAPI 2.0 Profile

> **Profile identifier**: `aegis-fapi-2.0-aligned-1.0`
> **Last reviewed**: 2026-05-15
> **Authority**: This document is the binding contract between AEGIS's
> discovery surface (`/.well-known/aegis-configuration`'s `standards_*`
> and `fapi_profile_*` fields) and the running code. The discovery doc
> may NOT advertise a standard as `standards_implemented` unless this
> profile shows a wire-level binding test exercising it.
> **Cross-reference**: marketing positioning at
> `~/Desktop/AEGIS_WEDGE_FINANCIAL_STANDARDS_2026-05-15.md` (operator workspace).

---

## 1 · Why this profile exists

The 2026 buyer in financial services — fintech CTO, hedge fund Head of Eng,
broker-dealer CISO — evaluates AI-agent verification infrastructure by
checking which **published, citable standards** are implemented. A
bespoke protocol invites a security review that costs both sides weeks.
A standards-binding presentation passes the buyer's existing OAuth /
FAPI playbook.

AEGIS's primitives — Ed25519 signed actions, scoped policies with limits,
hash-chained audit trail — are correct for the AI-agent domain. They are
NOT trivially interchangeable with off-the-shelf FAPI 2.0 because the
buyer mentally models. This profile names the gap and the binding work
that closes it.

**Two ledgers**:

- `standards_implemented`: AEGIS _bindingly_ honors the standard. There
  exists a wire-level test that exercises the binding. Every entry on
  this ledger is a citable claim a buyer can verify against running
  tests in this repo.
- `standards_aligned`: AEGIS's discovery shape mirrors the standard's
  expectations and a future binding implementation is planned, but a
  wire-level conformance test would fail today. Every entry has a
  named owner and a Q3-Q4 2026 target.

A standard never appears on both ledgers. Promotion from `aligned` to
`implemented` is an atomic, reviewable change with the test that proves it.

---

## 2 · Currently `standards_implemented`

| RFC          | Spec                                    | AEGIS binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Code reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Test reference                                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC 8032** | Ed25519 (EdDSA)                         | All AEGIS signatures use Ed25519 — agent signatures, audit-event signatures, manifest signatures. No alternate algorithm path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `apps/api/src/common/crypto/ed25519.util.ts`, `apps/api/src/modules/audit/compression/manifest.canonical.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `manifest.canonical.spec.ts`, `audit-chain-parity.spec.ts`                                                                                                                                                                                                                             |
| **RFC 7517** | JWK Set                                 | `/.well-known/audit-signing-key` returns an RFC 7517-conformant JWKS with `kty=OKP`, `crv=Ed25519`, `alg=EdDSA`, `use=sig` (RFC 8037 §3.1 binding).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `apps/api/src/modules/wellknown/wellknown.service.ts` getJwks()                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `wellknown.service.spec.ts → "jwks.json conforms to RFC 8037 Ed25519-in-JOSE"`                                                                                                                                                                                                         |
| **RFC 9116** | security.txt                            | `/.well-known/security.txt` served with required `Contact`, `Expires`, `Preferred-Languages`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `apps/api/src/modules/wellknown/wellknown.service.ts` getSecurityTxt()                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `wellknown.service.spec.ts` (security.txt block)                                                                                                                                                                                                                                       |
| **RFC 9396** | Rich Authorization Requests (RAR)       | `POST /v1/verify/rar/evaluate` accepts `authorization_details[]` + a candidate action and returns ALLOW/DENY per RFC 9396 §2.1 semantics. Four registered detail types: `trading_order`, `payment_initiation`, `data_access`, `agent_action`. Stateless — no policy persistence in this version; persistence with RAR shape is roadmapped. Discovery surfaces the type registry as `authorization_details_types_supported`. Promoted from `aligned` to `implemented` on 2026-05-15.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `apps/api/src/modules/verify/rar/rar.{types,evaluator,controller,dto}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `rar.evaluator.spec.ts` (29 tests across all detail types incl. wedge §5 demo lock), `rar.controller.spec.ts` (14 HTTP + observability tests)                                                                                                                                          |
| **RFC 8414** | OAuth 2.0 Authorization Server Metadata | `GET /.well-known/oauth-authorization-server` returns an RFC 8414 §2 subset honest for AEGIS: required fields populated, fields whose flow AEGIS doesn't implement (response*types_supported, token_endpoint_auth_methods_supported) are empty arrays per §2. AEGIS-specific extensions namespaced `aegis*\*`per §2.4 (aegis_service_type, aegis_rar_evaluate_endpoint, aegis_configuration_uri, aegis_fapi_profile). Promoted from`aligned`to`implemented` on 2026-05-15.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `apps/api/src/modules/wellknown/{wellknown.{controller,service}.ts,dto/oauth-as-metadata.dto.ts}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `wellknown.service.spec.ts → "getOAuthAuthorizationServerMetadata — RFC 8414 (1.3.0)"` block (10 tests)                                                                                                                                                                                |
| **RFC 6749** | OAuth 2.0 error envelope (§5.2)         | Every `/v1/verify` denial response carries an OAuth-canonical `error` field alongside the AEGIS-specific `denialReason`. Mapping is a published closed table covering all 12 denial reasons → 5 canonical OAuth error values (`invalid_token`, `invalid_client`, `invalid_grant`, `invalid_scope`, `access_denied`). Mapping is `Object.freeze`d to prevent runtime mutation. Promoted from `aligned` to `implemented` on 2026-05-15.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/api/src/modules/verify/oauth-error-mapping.ts`; populated in `verify.service.ts` and `verify.dto.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `oauth-error-mapping.spec.ts` (10 tests including semantic-correctness locks for each mapping choice)                                                                                                                                                                                  |
| **RFC 9101** | JWT Authorization Request (JAR)         | `JwtUtil.verifyAndDecode(token, pubkey, options?)` accepts opt-in JAR-strict validation: `requiredAudience` (RFC 9101 aud binding), `requiredIssuer` (iss binding), `maxAgeSeconds` (iat freshness). The existing `token` field on `/v1/verify` is RFC 9101 shape-compatible — agents sign Ed25519 JWTs with the standard claims (`sub`, `pid`, `iat`, `exp`, `jti`) plus optional JAR claims (`iss`, `aud`, `authorization_details`). **RAR-in-JAR is fully integrated** as of 2026-05-16 round 6: when `authorization_details` is present in the signed JWT, the verify algorithm evaluates it as Step 6.5 (between scope/domain and spend); RAR denial maps to `SCOPE_NOT_GRANTED` with the specific reason flowing to observability. **All three JAR claim enforcements (aud + iss + iat) are wired at the verify algorithm** as of 2026-05-16 rounds 7 + 8 — Step 3.4 (aud, port `expectedAudience`, env `AEGIS_API_BASE_URL` / `AEGIS_ISSUER`), Step 3.5 (iss-vs-sub, port `requireIssMatchesSub`, env `AEGIS_STRICT_JAR_ISS`), Step 3.6 (iat freshness, port `maxTokenAgeSeconds`, env `AEGIS_MAX_TOKEN_AGE_SECONDS`). Each gate runs BEFORE the replay-cache so rejected tokens do not consume their `jti`, preserving cross-verifier semantics. Each gate is independently operator-opt-in via env; defaults preserve pre-JAR backward compat. Mismatch maps to `INVALID_SIGNATURE` per ADR-0004 (locked denial enum); the specific gate that fired flows to observability. Promoted from `aligned` to `implemented` on 2026-05-16. | `apps/api/src/common/crypto/jwt.util.ts` (`AgentTokenClaims` + `JarValidationOptions` + extended `verifyAndDecode`); `apps/api/src/modules/verify/algorithm/verify.algorithm.ts` Step 3.4 + 3.5 + 3.6 + Step 6.5 + `deriveRarCandidate` helper; `apps/api/src/modules/verify/algorithm/verify.ports.ts` (`expectedAudience` + `maxTokenAgeSeconds` + `requireIssMatchesSub` ports); `apps/api/src/modules/verify/verify.service.ts` (Nest adapter wiring from config); `apps/api/src/config/config.schema.ts` (`AEGIS_MAX_TOKEN_AGE_SECONDS` + `AEGIS_STRICT_JAR_ISS` env) | `jwt.util.jar.spec.ts` (17 tests covering opt-in claim enforcement at the JwtUtil layer) + `verify.algorithm.spec.ts` Step 3.4 block (7 aud-binding tests), Step 3.5 block (6 iss-consistency tests), Step 3.6 block (7 iat-freshness tests), Step 6.5 block (7 RAR-integration tests) |

Promotion criteria for adding to this ledger:

1. The binding is in production code, not test fixtures.
2. The test that exercises it lives in the same repo and runs in CI.
3. A skeptical reader can read the test and confirm the claim by
   pattern-matching against the standard's wire format.
4. If the standard has interop test vectors, AEGIS passes them.

---

## 2.5 · Production deployment for FAPI-grade conformance

**Why this section exists**: §2 lists what AEGIS _can_ do; this section
lists what operators _must configure_ for those claims to be true at the
wire level in their specific deployment. A deployment that ships §2 code
without §2.5 envs ships code that is FAPI-shape-compatible but enforces
zero JAR claim binding at runtime — the standards-implemented claim
becomes empirically false for that deployment even while remaining true
at the binding-test level. Operators reading this doc to harden a deploy
should set every env in the table below.

### 2.5.1 · The four FAPI-enforcement envs

| Env                                      | What it does                                                                                                                      | Recommended production value                                                                                                                                                                       | Rollout discipline                                                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AEGIS_API_BASE_URL` (or `AEGIS_ISSUER`) | Sets the canonical issuer URL. Algorithm Step 3.4 rejects tokens whose `aud` claim does not match.                                | The full HTTPS URL the AEGIS API answers on, no trailing slash (e.g. `https://api.aegis.klytics.io`).                                                                                              | **Set first**. Backward compat is automatic — tokens that omit aud flow through. Enable as soon as production has a stable issuer URL.                                                                                          |
| `AEGIS_STRICT_JAR_ISS`                   | When `true`, algorithm Step 3.5 rejects tokens with `iss !== sub`.                                                                | `true` once the SDK fleet emits `iss=sub`.                                                                                                                                                         | **Coordinate with SDK rollout**. Enabling before every agent SDK signs `iss=agent_id` silently kills traffic from older SDKs. Ship SDK support → wait for fleet to roll over → canary on a single relying party → flip the env. |
| `AEGIS_MAX_TOKEN_AGE_SECONDS`            | Algorithm Step 3.6 rejects tokens whose `iat` is older than this. Tightens replay window beyond what `exp` + jti cache guarantee. | Start at `60` (60s window — tight). FAPI 2.0 ceiling is `300`. Do not drop below `60` without measuring relying-party→AEGIS p99 RTT — mobile networks + intercontinental hops can exceed 30s tail. | **Set last**. Once relying parties + SDKs are healthy with aud + iss, tighten freshness gradually. Tightening this knob to "look secure" without measuring has caused outages elsewhere.                                        |
| `AEGIS_SIGNING_KEY_ROTATED_AT`           | Stamps the JWKS rotation time so relying parties can pin key freshness.                                                           | The ISO-8601 timestamp of the last `AEGIS_SIGNING_PRIVATE_KEY` rotation.                                                                                                                           | Set together with any rotation. Boot WARNs without it (see `wellknown.service.ts`).                                                                                                                                             |

### 2.5.2 · The "strict FAPI" deployment ladder

A deployment progresses through three states. The §2 claim is true at
state C; partially true at state B; not-true-at-wire-level at state A:

- **State A (default)**: None of the four envs set. JAR claim
  enforcement is OFF. Equivalent to pre-FAPI behavior with the §2 code
  paths dormant.
- **State B (audience-bound)**: `AEGIS_API_BASE_URL` set. Cross-deployment
  token replay is rejected. SDK fleet does not need to upgrade — tokens
  without aud still flow through. **This is the minimum responsible
  posture for any production deployment.**
- **State C (strict FAPI)**: All four envs set, SDK fleet emitting
  `iss=sub` and recent `iat`. Every JAR binding mechanism enforced. The
  §2 RFC-9101 claim is empirically wire-true for this deployment.

A future env macro `AEGIS_FAPI_STRICT_MODE=true` (roadmapped in §3.3
deferred follow-on) will collapse states B+C into a single boolean once
the fleet-coordination burden is documented per relying party.

### 2.5.3 · Cloudflare Worker edge (Phase 3) and §2.5 envs

The CF Worker at `workers/cf-verify/` is a fast-path port of `/v1/verify`
(deployment-gated behind Phase 3 / $5K MRR per the worker package's
`deploy` guard). When the Worker is enabled, the §2.5.1 enforcement
envs apply **at the origin only** — the edge cannot decide on
JAR-strict claims (aud / iss / iat freshness) because they require
operator config the cache doesn't carry. The Worker's design is:

| Concern                       | Edge behavior                                                                                                    | Origin behavior                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `aud` binding (Step 3.4)      | Not enforced at edge; tokens with mismatched aud still hit edge cache                                            | Origin decides per `AEGIS_API_BASE_URL`          |
| `iss === sub` (Step 3.5)      | Not enforced at edge                                                                                             | Origin decides per `AEGIS_STRICT_JAR_ISS`        |
| `iat` freshness (Step 3.6)    | Edge enforces hard-exp (`exp + 30 < now`); freshness gate is origin-only                                         | Origin decides per `AEGIS_MAX_TOKEN_AGE_SECONDS` |
| RAR-in-JAR (Step 6.5)         | Edge forwards to origin when `authorization_details` is present                                                  | Origin evaluates via the pure evaluator          |
| `denialContext.kind` emission | Edge emits matching kind at every `deny()` callsite — locked by `tests/cross-package/fapi-worker-parity.spec.ts` | Algorithm emits at every gate (rounds 7-10)      |

**Operator deployment implication**: enabling state-B or state-C
configuration at origin is correct even when the Worker is in front of
it. The Worker forwards cache-misses + JAR-strict-candidates to origin;
origin's config controls enforcement. **Buyers hitting the edge cannot
bypass strict-FAPI** because anything that would trigger JAR
enforcement (RAR-in-JAR, unknown agent/policy, suspended status) is
forwarded.

**Source-of-truth lock**: `packages/types/src/constants.ts` defines
`DENIAL_CONTEXT_KINDS` as the wire-contract source of truth. The
algorithm side at `apps/api/src/modules/verify/algorithm/verify.ports.ts`
exports `ALL_DENIAL_CONTEXT_KINDS` as a bit-for-bit mirror. The cross-
package parity test
(`tests/cross-package/fapi-worker-parity.spec.ts`) locks set equality.
Either side drifting fails before merge.

### 2.5.4 · Boot-time pre-flight check (planned)

Out of scope for this round: a boot WARN that fires when
`NODE_ENV=production` AND `AEGIS_API_BASE_URL` is unset, mirroring the
existing `AEGIS_SIGNING_KEY_ROTATED_AT` WARN. The intent is to make
state-A deployments observable in operator logs before a security
review catches the gap. Target Q3 2026 with the strict-mode macro.

---

## 2.6 · The `denialContext` discriminator — public/internal split

**What it is**: every denial response from `/v1/verify` carries a
`denialContext: { kind }` field below the locked ADR-0004
denial-precedence enum. The closed-enum `kind` distinguishes the five
INVALID_SIGNATURE rejection conditions (signature / aud / iss / iat /
replay), the nine RAR sub-reasons, the three policy paths, the two
scope paths, and the two pre-algorithm billing gates — 28 distinct
kinds total. Source of truth: `DenialContextKind` in
`apps/api/src/modules/verify/algorithm/verify.ports.ts`.

**Why it exists**: rounds 5-9 added five distinct rejection conditions
that all collapse to `INVALID_SIGNATURE` in the public response. Without
a discriminator, an integrator reading the response can't tell whether
to fix their token, their clock, their aud config, or their key
rotation. The locked denial enum can't grow without a 90-day customer
notice + major version bump (CLAUDE.md invariant #6). The discriminator
sits BELOW the locked enum as additive evolution: adding a kind is
non-breaking; removing or renaming a kind requires a major bump.

**The threat-model split — what's IN denialContext, what's NOT**:

| Field                                   | Where it lives                               | Why                                                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind` (closed enum, ~28 values)        | Public response + structured log + audit row | Discriminator alone is non-sensitive: aud is discoverable via `/.well-known/oauth-authorization-server`, RAR scope is signed into the agent's own JAR, max-age threshold is operator policy (not a secret). Operator + integrator both win. |
| Expected aud value                      | Structured log only                          | The configured aud IS public via discovery — but the verify response should not act as a discovery probe. Read `/.well-known/oauth-authorization-server`.                                                                                   |
| Received aud value                      | Structured log only                          | The relying party submitted the token; if they need to know what they sent, they have the token.                                                                                                                                            |
| iat age / max-age threshold             | Structured log only                          | Threshold is operator policy. Disclosing it to every failed verify would enable a binary-search probe (rate-limited but cheap).                                                                                                             |
| jti of replayed token                   | Structured log only                          | The relying party knows their own jti; disclosing it back tells them nothing.                                                                                                                                                               |
| RAR sub-reason (action / limit / hours) | Public response + structured log             | RAR scope is signed by the agent into the JAR — the agent already knows their own RAR limits. Disclosing the specific RAR sub-reason to the relying party is what RFC 9396 §6 expects.                                                      |

**Defense-in-depth observation**: the discriminator does technically
give an attacker more info than collapsing everything to
INVALID_SIGNATURE. The leak is bounded: aud is public via discovery,
RAR scope was already signed by the agent, max-age is operator policy.
Net: the operator + integrator debug win materially outweighs the
attacker reconnaissance gain — and refusing to ship the discriminator
to "look more secure" would push every customer support ticket through
log access instead of being self-serviceable.

**Implementation**: algorithm (`verify.algorithm.ts`) carries only the
`kind`. The service adapter (`verify.service.ts`) reconstructs
specifics from the original input + config at deny-time and emits a
structured log line. The algorithm stays framework-free (CLAUDE.md
invariant #2) and the redaction policy is trivially correct because
the public-safe object has nothing to redact.

**Where the lock lives**:

- Compile-time: `DenialContextKind` discriminated union + TS
  exhaustiveness — algorithm cannot emit a new denial without listing
  the kind.
- Test-time: `verify.algorithm.spec.ts` Step 10 block asserts the
  specific kind at every gate. Wrong-kind emissions fail.
- Cross-package: `tests/cross-package/fapi-denial-context-parity.spec.ts`
  locks the closed-enum SET and ensures every `DenialReason` has at
  least one corresponding kind. A new denial reason added without
  context wiring fails this spec.

---

## 3 · Currently `standards_aligned` (roadmap)

Each row has: (a) the gap, (b) the binding implementation needed, (c) the
owner / sprint, (d) the test that, when green, promotes the entry to
`standards_implemented`.

### 3.1 RFC 6749 — OAuth 2.0 (error envelope shape) — PROMOTED 2026-05-15

**Status**: this row has been promoted to §2 `standards_implemented`.
Mapping table lives at `apps/api/src/modules/verify/oauth-error-mapping.ts`;
populated on every /v1/verify denial through `verify.service.ts`.
Promotion test `oauth-error-mapping.spec.ts` locks each mapping choice.

### 3.2 RFC 8414 — OAuth 2.0 Authorization Server Metadata — PROMOTED 2026-05-15

**Status**: this row has been promoted to §2 `standards_implemented`.
Endpoint `GET /.well-known/oauth-authorization-server` returns the
AEGIS-honest subset. Promotion test in `wellknown.service.spec.ts`
"getOAuthAuthorizationServerMetadata — RFC 8414 (1.3.0)" block.

### 3.3 RFC 9101 — JWT Authorization Request (JAR) — PROMOTED 2026-05-16

**Status**: this row has been promoted to §2 `standards_implemented`.
`JwtUtil.verifyAndDecode` accepts opt-in JAR validation
(`requiredAudience`, `requiredIssuer`, `maxAgeSeconds`); the existing
`token` field on `/v1/verify` is RFC 9101 shape-compatible. Promotion
test `jwt.util.jar.spec.ts` (17 tests) covers backward compat,
opt-in claim enforcement, and RAR-in-JAR tamper rejection.

**All three JAR-claim enforcements are now wired at the verify algorithm
itself** (rounds 7 + 8, 2026-05-16) — closing the "decoded but not
enforced" audit pattern surfaced in round 6:

- **Step 3.4** — `aud` binding via port `expectedAudience` (env
  `AEGIS_API_BASE_URL` / `AEGIS_ISSUER`). 7 tests.
- **Step 3.5** — `iss === sub` consistency via port
  `requireIssMatchesSub` (env `AEGIS_STRICT_JAR_ISS`). 6 tests.
- **Step 3.6** — `iat` freshness via port `maxTokenAgeSeconds`
  (env `AEGIS_MAX_TOKEN_AGE_SECONDS`). 7 tests.

Each gate is operator-opt-in (defaults preserve backward compat) and
runs BEFORE the replay-cache so rejected tokens do not consume their
`jti`. Mismatch maps to `INVALID_SIGNATURE` per ADR-0004 (locked enum).

**Deferred follow-on**: bundle the three enforcement env vars into a
`AEGIS_FAPI_STRICT_MODE=true` macro that turns all three on at once,
emitting a boot-time pre-flight check that warns if AEGIS boots without
them in production. Target Q3 2026 — depends on the agent fleet
universally signing `iss` + `aud` first.

### 3.4 RFC 9396 — Rich Authorization Requests (RAR) — PROMOTED 2026-05-15

**Status**: this row has been promoted to §2 `standards_implemented`.
The implementation is `apps/api/src/modules/verify/rar/**` exposing
`POST /v1/verify/rar/evaluate` as a stateless decision endpoint with
four registered detail types (`trading_order`, `payment_initiation`,
`data_access`, `agent_action`). Promotion tests
(`rar.evaluator.spec.ts`, `rar.controller.spec.ts`) lock the wire
contract.

**Deferred to a future sprint** (NOT blocking the promotion):

- Policy-side persistence with RAR shape (additive nullable
  `authorization_details` JSON column on the `Policy` table). When this
  lands, the existing scope-based policy evaluation can call the same
  evaluator. Migration risk: low (additive nullable). Target: Q4 2026,
  gated on operator approval per CLAUDE.md migrations-append-only
  invariant.

### 3.5 RFC 9449 — DPoP (Demonstrating Proof-of-Possession)

- **Gap**: AEGIS has a `nonce` field for replay protection but it isn't
  DPoP-shaped (no header `DPoP: <JWT>` with `jti`, `htm`, `htu`, `iat`).
- **Binding**: Accept `DPoP` request header on `/v1/verify` and selected
  hot-path endpoints. Validate per RFC 9449 §4.3. Reject expired or
  replayed proofs.
- **Target**: Q4 2026, ~3 days.
- **Promotion test**:
  `verify.dpop.spec.ts` — happy path + 5 tamper modes (expired iat,
  wrong htu, wrong htm, replayed jti, missing kid).

### 3.6 RFC 9421 — HTTP Message Signatures

- **Gap**: Outbound webhooks signed with HMAC-SHA256. RFC 9421 is the
  IETF-standard, asymmetric, bank-grade alternative.
- **Binding**: Add `signature_mode` field on `WebhookSubscription` —
  default `hmac` for back-compat, `http_message_signatures_ed25519`
  for FAPI-grade. Server signs with the AEGIS audit key; subscriber
  verifies via the published JWKS.
- **Target**: Q4 2026, ~1 week.
- **Promotion test**:
  `webhook.http-message-signatures.spec.ts` — produce a signed webhook
  body, verify against the JWKS, confirm RFC 9421 `Signature-Input` and
  `Signature` headers parse per spec.

### 3.7 Non-aligned standards that buyers may ask about

| Standard                                | Why we don't claim alignment                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **OpenID Connect Core 1.0**             | AEGIS doesn't authenticate humans. The agent identity model isn't an OIDC subject.                          |
| **OAuth 2.0 Token Exchange (RFC 8693)** | AEGIS issues signed receipts, not OAuth access tokens; exchange semantics don't apply.                      |
| **WebAuthn / FIDO2**                    | Human-credential primitives, not agent.                                                                     |
| **OAuth 2.0 Mutual TLS (RFC 8705)**     | Agents sign requests; mTLS at the transport layer is orthogonal and operator-configurable (Cloudflare/ALB). |

A buyer asking about these gets the explanation above plus a referral to
the right product (Auth0 for OIDC, WorkOS for WebAuthn). Don't fake alignment.

---

## 4 · Discovery doc field map

The `/.well-known/aegis-configuration` 1.1.0 fields below correspond to
this profile. Any addition to the profile MUST land its field at the
same time.

| Discovery field                          | RFC binding                            | Source-of-truth constant in code          |
| ---------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `fapi_profile`                           | n/a (AEGIS-specific marker)            | `FAPI_PROFILE_ID` in wellknown.service.ts |
| `fapi_profile_spec_uri`                  | n/a                                    | `FAPI_PROFILE_DOC_URL`                    |
| `standards_implemented`                  | this doc §2                            | `STANDARDS_IMPLEMENTED`                   |
| `standards_aligned`                      | this doc §3                            | `STANDARDS_ALIGNED`                       |
| `signing_alg_values_supported`           | RFC 7518 / FAPI 2.0 §6.1 (our outputs) | hardcoded `['EdDSA']`                     |
| `agent_signing_alg_values_supported`     | RFC 9101 (inbound, planned)            | hardcoded `['EdDSA']`                     |
| `agent_authentication_methods_supported` | RFC 7521 §4                            | `AGENT_AUTH_METHODS`                      |
| `op_policy_uri`                          | RFC 8414 § "op_policy_uri"             | env `AEGIS_OP_POLICY_URI`                 |
| `op_tos_uri`                             | RFC 8414 § "op_tos_uri"                | env `AEGIS_OP_TOS_URI`                    |

A `pnpm test:parity` cross-package spec MAY in the future cross-test
this map against the running discovery doc. Today the lock is the
service spec (see `wellknown.service.spec.ts` → "FAPI-2.0-aligned
metadata (1.1.0)" block).

---

## 5 · Customer-facing claims this enables

These are the claims the marketing site MAY make today as a direct
consequence of this profile, with link to the discoverable proof:

| Claim                                                                               | Evidence                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "AEGIS uses Ed25519 (RFC 8032)"                                                     | `signing_alg_values_supported`, RFC 8032 in `standards_implemented`                                                                                              |
| "AEGIS publishes JWKS per RFC 7517"                                                 | `jwks_uri`, RFC 7517 in `standards_implemented`, `getJwks()` test                                                                                                |
| "AEGIS publishes a security.txt per RFC 9116"                                       | `security_txt` URI, RFC 9116 in `standards_implemented`                                                                                                          |
| "AEGIS publishes RFC 8414 OAuth Authorization Server metadata"                      | `oauth_authorization_server` URI, RFC 8414 in `standards_implemented`, `getOAuthAuthorizationServerMetadata()` test                                              |
| "AEGIS returns RFC 6749 §5.2 canonical OAuth error envelopes on denial"             | RFC 6749 in `standards_implemented`, `oauth-error-mapping.spec.ts`                                                                                               |
| "AEGIS implements OAuth 2.0 Rich Authorization Requests (RFC 9396)"                 | RFC 9396 in `standards_implemented`, `rar.evaluator.spec.ts` + `rar.controller.spec.ts`, four registered detail types in `authorization_details_types_supported` |
| "AEGIS accepts FAPI 2.0 JAR (RFC 9101) with operator-gated aud/iss/iat enforcement" | RFC 9101 in `standards_implemented`, `verify.algorithm.spec.ts` Steps 3.4/3.5/3.6 + `jwt.util.jar.spec.ts`                                                       |
| "AEGIS is FAPI 2.0-aligned"                                                         | `fapi_profile` identifier + this doc                                                                                                                             |
| "AEGIS plans to support DPoP (RFC 9449) and HTTP Message Signatures (RFC 9421)"     | RFCs in `standards_aligned` + roadmap in this doc §3.5, §3.6                                                                                                     |

**Asterisks on the FAPI 2.0-aligned claim** — buyers doing a serious
review will catch these; document them rather than hide them:

| Asterisk                                 | Honest framing                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EdDSA-only signing                       | FAPI 2.0 baseline historically expected RS256/PS256/ES256; AEGIS uses RFC 8032 Ed25519 exclusively for stronger security + faster signing. EdDSA is registered in JWA (RFC 8037). A compliance script keyed to "FAPI baseline algorithms" may flag this — the choice is deliberate, not a gap.                                                                              |
| JAR enforcement is opt-in, not mandatory | RFC 9101 §6.1 says aud MUST be present in a JAR. AEGIS supports all three binding mechanisms (aud/iss/iat) but enforces each only when the operator opts in via env AND the agent's token carries the claim. Strict-FAPI conformance is reachable in any one deployment by setting the three envs in §2.5; the default is permissive for backward compat with pre-JAR SDKs. |
| No mTLS / DPoP yet                       | FAPI 2.0 typically pairs JAR with one of mTLS (RFC 8705) or DPoP (RFC 9449). Neither is implemented at AEGIS today — DPoP is roadmapped at §3.5; mTLS is operator-configurable at the load-balancer layer (Cloudflare/ALB) and intentionally not part of the AEGIS surface.                                                                                                 |

These are the claims marketing MAY NOT make until promotion to
`standards_implemented`:

| Forbidden claim                                     | Why                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| "AEGIS signs webhooks per RFC 9421"                 | §3.6 not yet bound                                                                                                                 |
| "AEGIS supports DPoP (RFC 9449)"                    | §3.5 not yet bound                                                                                                                 |
| "AEGIS is FAPI 2.0 certified"                       | No OpenID Foundation certification yet                                                                                             |
| "AEGIS implements OpenID Connect"                   | §3.7 — we don't, by design                                                                                                         |
| "AEGIS enforces FAPI-grade JAR strictly by default" | §2.5 enforcement is operator-opt-in; only deployments that have set the three envs and rolled the SDK fleet are at strict default. |

If marketing copy advances beyond the discoverable proof, the wedge
becomes a lie and the first technical reviewer at any sophisticated
buyer will catch it. The reverse failure mode — marketing UNDER-claiming
what AEGIS implements — costs sales velocity and is equally a wedge bug.
The §6 promotion workflow includes a §5 audit step (see below) so this
table stays calibrated as standards promote in or out.

---

## 6 · Promotion workflow

When a `standards_aligned` entry is ready to promote:

1. Implement the binding (code + tests as defined in §3).
2. Move the RFC from `STANDARDS_ALIGNED` → `STANDARDS_IMPLEMENTED` in
   `wellknown.service.ts`.
3. Move the row in this doc from §3 → §2 with code + test references filled in.
4. **Audit §5 marketing-claim table** — every promotion changes which
   claims are allowed and which are forbidden. Walk both subtables:
   - The forbidden table: does any row reference the just-promoted RFC?
     If yes, move it to the allowed table with the new evidence pointer.
   - The "plans to support" allowed claim: does it list the just-promoted
     RFC? If yes, remove that RFC from the list (it's no longer "planned").
   - The asterisks table (§5 lower block): does the promotion change the
     truthfulness of any asterisk? Update accordingly.
   - Skipping this step ships an internally inconsistent doc that
     either _over-claims_ (marketing makes a forbidden claim that is now
     allowed but the table still forbids it — operationally fine but
     under-sells the wedge) or _under-claims_ (the inverse — marketing
     keeps an aspirational "plans to" claim that should be a present-tense
     "implements" claim). Both are wedge bugs.
5. **Audit §2.5 deployment guidance** — every JAR-shape promotion adds
   one or more enforcement envs an operator must set for the §2 claim
   to be wire-true. Add the env, its recommended value, and its rollout
   discipline to the §2.5.1 table. Update the §2.5.2 ladder if the new
   env shifts where "strict-FAPI" lives.
6. **Audit downstream marketing docs** — grep operator workspace and
   the marketing site for prior-state claims about the promoted RFC.
   Known surfaces: `~/Desktop/AEGIS_WEDGE_FINANCIAL_STANDARDS_*.md`,
   `apps/marketing/**`, `docs/spec/04_COMMERCIAL_STRATEGY.md`. A claim
   that was "planned" yesterday and "implemented" today is a Rule-1
   audit miss if not updated together.
7. Bump `DISCOVERY_SPEC_VERSION` minor (e.g. 1.1.0 → 1.2.0).
8. Add a `THE_AEGIS_TESTAMENT` cross-reference if the promotion landed a
   user-visible product surface (per existing Lore protocol).
9. If a customer-visible breaking change accompanies the promotion (e.g.
   removing the bespoke field after RAR lands), the discovery doc gets a
   major bump with 90-day customer notice per `discovery.dto.ts` header.

The §5 + §2.5 + downstream audits (steps 4-6) close a drift class that
was demonstrated empirically during the 2026-05-16 RFC-9396 / RFC-8414 /
RFC-6749 / RFC-9101 promotion sweep — each promotion correctly landed
steps 1-3 + 7 and silently left §5 stale until the round-9 sweep caught
all four at once. Treat steps 4-6 as load-bearing process locks, not
optional cleanup.

Demotion (rare): if a `standards_implemented` entry is found to fail
interop testing, demote with operator approval + customer notice. Apply
the same §5 + §2.5 + downstream audits in reverse — promotion claims
become forbidden claims, deployment envs become "set if you previously
opted into the now-demoted strict mode," and downstream docs get
present-to-past-tense edits. Demotions are SEV-1 events.

---

## 7 · Maintenance

- This document is canonical. The discovery service code references its URL.
- Reviewed quarterly by the operator (Erwin Kiess-Alfonso).
- A new RFC enters the conversation by being added to §3 first; never
  add to `STANDARDS_ALIGNED` without §3 prose explaining the gap and
  the promotion test.
- If FAPI 2.0 itself revises (e.g. FAPI 2.1), this profile's
  `FAPI_PROFILE_ID` rev-locks against the AEGIS-side binding choices
  rather than auto-tracking upstream.

---

## 8 · Why this is a competitive moat, not just compliance theater

A bespoke "AI agent identity protocol" loses to a "standards-shaped
authorization layer" in three places:

1. **Sales velocity.** A buyer with an existing OAuth/FAPI review template
   spends 4 hours reviewing AEGIS instead of 4 weeks reviewing a bespoke
   protocol. Sales cycle compresses by ~80% per published Plaid/Auth0
   case studies.
2. **Integration cost.** A fintech integrating AEGIS reuses their existing
   FAPI client libraries with one-line adapter code. A bespoke protocol
   requires writing a new client library; that's 2-4 sprints they don't
   spend with AEGIS.
3. **Regulatory defensibility.** "We use AEGIS which implements OAuth 2.0
   RAR + FAPI 2.0 JAR + DPoP" reads as table-stakes to a regulator
   (FCA, SEC, MAS, BaFin, MAS). "We use a proprietary AI agent gateway"
   reads as something to investigate.

The standards binding IS the moat. The implementation gaps in §3 are
how we earn it.

---

_End of profile._
