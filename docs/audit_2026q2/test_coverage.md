# AEGIS Test Coverage Audit — 2026 Q2

> Read-only review. Compares existing tests against the 6 architectural
> invariants in `CLAUDE.md`, the 9-reason denial precedence in
> `docs/SECURITY.md` § 6, and the v1 prototype validation suite at
> `/Users/money/Downloads/files (7)/aegis-test.js`.

## 0. Inventory of test surfaces

| Surface | File | Notes |
|---|---|---|
| API unit (verify algo, framework-free) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/verify/verify.algorithm.spec.ts` | 30+ cases, vitest-style, no Nest/DI. Best file in the repo. |
| API unit (verify algo, alt port) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/verify/algorithm/verify.algorithm.spec.ts` | Smaller, mirrors the same surface via an in-memory port harness. |
| API unit (verify service / DI wiring) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/verify/verify.service.spec.ts` | 7 cases — happy + 6 denials. Lacks POLICY_EXPIRED, SPEND_LIMIT_EXCEEDED, TRUST_SCORE_TOO_LOW, ANOMALY_FLAGGED, AGENT_NOT_FOUND-vs-INVALID_SIGNATURE precedence. |
| API unit (spend guard) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/verify/spend-guard.service.spec.ts` | 5 cases — per-tx, per-day, per-month, undefined caps. No cents/decimal precision, no concurrency, no month-rollover. |
| API unit (BATE) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/bate/bate.scorer.spec.ts` | Scorer math only — no integration with verify. |
| API unit (audit chain) | `/Users/money/Desktop/AEGIS/apps/api/src/common/crypto/audit-chain.util.spec.ts` | 5 cases: canonicalize, genesis, chain extension, payload tamper, prev-sig tamper. **Missing cross-key rejection**. |
| API unit (JWT) | `/Users/money/Desktop/AEGIS/apps/api/src/common/crypto/jwt.util.spec.ts` | 5 cases — round-trip, expired, foreign key, malformed, missing sub/pid. No `kid` test, no malformed-segment-by-segment. |
| API unit (Ed25519) | `/Users/money/Desktop/AEGIS/apps/api/src/common/crypto/ed25519.util.spec.ts` | (Inferred — present.) |
| API unit (well-known / kid) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/wellknown/wellknown.service.spec.ts` | kid derivation, JWKS shape. No rotation lifecycle. |
| API unit (webhook signing) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/webhooks/webhook.delivery.spec.ts` | Sign + recompute. **No replay-window enforcement test** (timestamp drift). |
| API unit (billing / plans) | `/Users/money/Desktop/AEGIS/apps/api/src/modules/billing/plans.spec.ts` | (Out of scope here.) |
| API unit (auth / api-key) | **MISSING** — `apps/api/src/modules/auth/api-key.service.ts` has **no** `.spec.ts`. | Critical gap. |
| API unit (identity, policy, audit services) | **MISSING** — none of `identity.service.ts`, `policy.service.ts`, `audit.service.ts` have spec files. | Multi-tenant isolation is unit-untested. |
| NestJS e2e harness | `/Users/money/Desktop/AEGIS/apps/api/test/setup-env.ts`, `jest-e2e.config.ts` | Harness only — **zero e2e specs in `apps/api/test`**. The load test is the only file there. |
| Root e2e (vitest) | `/Users/money/Desktop/AEGIS/tests/e2e/01_health…15_idempotency` + `property/denial_precedence.property.spec.ts` | Strong — lifts most of the v1 prototype suite. Still has soft-skips. |
| SDK | `/Users/money/Desktop/AEGIS/packages/sdk-ts/src/crypto.spec.ts` | Generate, sign, decode — **no SDK ↔ API round-trip test in this package**. (Round-trip is implicit in `tests/e2e`, but the SDK itself doesn't ship a self-test that talks to a real API.) |
| Scripts | `/Users/money/Desktop/AEGIS/scripts/verify-spec.spec.ts`, `generate-aegis-keys.spec.ts` | Spec coverage diff + keygen. |

---

## 1. Coverage matrix — critical scenarios vs. tests

Legend: ✓ covered, ~ partial / soft-skipped, ✗ missing.

| # | Scenario | Status | Test file (line) |
|---|---|---|---|
|  1 | Denial AGENT_NOT_FOUND fires | ✓ | `verify.algorithm.spec.ts:195`, `verify.service.spec.ts:114`, `tests/e2e/07_verify_denials.test.ts:39` |
|  2 | Denial AGENT_REVOKED fires | ✓ | `verify.algorithm.spec.ts:207`, `verify.service.spec.ts:122`, `tests/e2e/07_verify_denials.test.ts:54` |
|  3 | Denial INVALID_SIGNATURE fires | ✓ | `verify.algorithm.spec.ts:229,241`, `verify.service.spec.ts:107,137`, `tests/e2e/07_verify_denials.test.ts:64` |
|  4 | Denial POLICY_REVOKED fires | ✓ | `verify.algorithm.spec.ts:253`, `verify.service.spec.ts:153`, `tests/e2e/07_verify_denials.test.ts:74` |
|  5 | Denial POLICY_EXPIRED fires | ~ | `verify.algorithm.spec.ts:264,275`, `tests/e2e/07_verify_denials.test.ts:84` (wall-clock wait, soft). **Not in `verify.service.spec.ts`.** |
|  6 | Denial SCOPE_NOT_GRANTED fires | ✓ | `verify.algorithm.spec.ts:286,300`, `verify.service.spec.ts:162`, `tests/e2e/07_verify_denials.test.ts:97` |
|  7 | Denial SPEND_LIMIT_EXCEEDED fires | ~ | `verify.algorithm.spec.ts:311`, `tests/e2e/07_verify_denials.test.ts:106`. **Not in `verify.service.spec.ts`.** |
|  8 | Denial TRUST_SCORE_TOO_LOW fires | ~ | `verify.algorithm.spec.ts:322`, `tests/e2e/07_verify_denials.test.ts:127` (soft-skip). **Not in `verify.service.spec.ts`.** |
|  9 | Denial ANOMALY_FLAGGED fires | ~ | `verify.algorithm.spec.ts:333`, `tests/e2e/07_verify_denials.test.ts:158` (soft-skip if BATE not propagating). **Not in `verify.service.spec.ts`.** |
| 10 | Precedence: AGENT_REVOKED beats POLICY_REVOKED | ✓ | `verify.algorithm.spec.ts:350` |
| 11 | Precedence: AGENT_REVOKED beats POLICY_EXPIRED | ✗ | Implied transitively, not asserted directly. |
| 12 | Precedence: POLICY_REVOKED beats POLICY_EXPIRED | ✓ | `verify.algorithm.spec.ts:361`, `algorithm/verify.algorithm.spec.ts:73` |
| 13 | Precedence: SCOPE_NOT_GRANTED beats SPEND_LIMIT_EXCEEDED | ✓ | `verify.algorithm.spec.ts:372` |
| 14 | Precedence: SPEND_LIMIT_EXCEEDED beats TRUST_SCORE_TOO_LOW | ✗ | Not asserted. |
| 15 | Precedence: TRUST_SCORE_TOO_LOW beats ANOMALY_FLAGGED | ✓ | `verify.algorithm.spec.ts:383` |
| 16 | Precedence: AGENT_NOT_FOUND beats INVALID_SIGNATURE | ✗ | Not asserted (these can co-occur if a token decodes but the sub doesn't resolve and the sig verification would also fail). |
| 17 | Precedence: full property regression (top-wins under random combinations) | ✓ | `tests/e2e/property/denial_precedence.property.spec.ts:72` (fast-check, 12 runs). Excludes AGENT_NOT_FOUND + POLICY_EXPIRED dimensions. |
| 18 | Precedence: contract array is exactly the 9 reasons in the documented order | ✓ | `tests/e2e/property/denial_precedence.property.spec.ts:58`, `verify.algorithm.spec.ts:489` |
| 19 | Audit chain: genesis event signs + verifies | ✓ | `audit-chain.util.spec.ts:35` |
| 20 | Audit chain: chain extension (prev-sig included in second event) | ✓ | `audit-chain.util.spec.ts:48` |
| 21 | Audit chain: payload tamper detected | ✓ | `audit-chain.util.spec.ts:67` |
| 22 | Audit chain: prev-sig tamper detected | ✓ | `audit-chain.util.spec.ts:79` |
| 23 | Audit chain: cross-key verification rejected (wrong AEGIS pubkey) | ✗ | **No test signs with key A and tries to verify with key B.** The chain library would silently accept any pub key the caller passes — operationally caught by `wellknown` config, but not unit-tested in audit-chain. |
| 24 | Audit chain: reordering events (swap event N and N+1) | ~ | Indirectly via prev-sig tamper. No explicit "events in wrong order" test. |
| 25 | Audit chain: e2e produces signed events on real verify calls | ~ | `tests/e2e/10_audit_chain.test.ts` — checks event count + decisions, but **does not actually re-verify Ed25519 signatures against the well-known pubkey**. (Signature presence is asserted; cryptographic validity is not.) |
| 26 | Spend math: per-transaction cap | ✓ | `spend-guard.service.spec.ts:24` |
| 27 | Spend math: per-day cumulative | ✓ | `spend-guard.service.spec.ts:38` |
| 28 | Spend math: per-month cumulative | ✓ | `spend-guard.service.spec.ts:49` |
| 29 | Spend math: cents / sub-unit precision (e.g. 99.99 + 0.02) | ✗ | Service stores raw `number`; no test for fractional cents, JS float drift, or Decimal-backed totals. |
| 30 | Spend math: concurrent increments do not over-spend (TOCTOU) | ~ | `tests/e2e/09_spend_race.test.ts` — black-box "approved sum ≤ cap" assertion. **No unit test of the atomic Redis incrBy / Lua check path.** |
| 31 | Spend math: month-rollover (UTC vs. local TZ) | ✗ | `todayKeys()` slices ISO; no test pinning `Date.now` to 2026-04-30T23:59:59Z and exercising the boundary. |
| 32 | Multi-tenant: principal A cannot read agent of principal B | ~ | `tests/e2e/03_agent.test.ts:74` — **soft-skipped** unless `AEGIS_E2E_API_KEY_2` is set. **No unit-level service test.** |
| 33 | Multi-tenant: principal A cannot revoke / mutate principal B's agent | ✗ | Not tested at any level. |
| 34 | Multi-tenant: principal A cannot read principal B's audit log | ✗ | Not tested. |
| 35 | Multi-tenant: principal A cannot create policy under principal B's agent | ✗ | Not tested. |
| 36 | Multi-tenant: token signed by agent of principal A but submitted with API key of principal B | ✗ | Not tested. (Could either be allowed by design — verify is principal-agnostic — or be a leak. The contract is unclear and untested.) |
| 37 | API key: bcrypt cost configurable for tests | ✓ | `apps/api/test/setup-env.ts:5` (`API_KEY_BCRYPT_COST=4`). |
| 38 | API key: invalid key returns 401 | ✓ | `tests/e2e/02_principal.test.ts:32` |
| 39 | API key: missing key returns 401 | ✓ | `tests/e2e/02_principal.test.ts:39` |
| 40 | API key: revoked key is rejected after revocation | ✗ | **No test** — `api-key.service.ts` has no `.spec.ts` and no e2e revoke-then-use test. |
| 41 | API key: bcrypt verification is constant-time (no plaintext compare) | ✗ | Not asserted. |
| 42 | API key: prefix lookup is principal-scoped | ✗ | Not tested. |
| 43 | JWT: malformed segment (header / payload / sig) detection | ~ | `jwt.util.spec.ts:47` covers "not.a.token" but not segment-specific tampering (e.g. valid header + payload, garbage sig). |
| 44 | JWT: invalid signature | ✓ | `jwt.util.spec.ts:39` (foreign key) |
| 45 | JWT: expired exp | ✓ | `jwt.util.spec.ts:29` |
| 46 | JWT: missing sub / pid | ✓ | `jwt.util.spec.ts:53` |
| 47 | JWT: wrong `kid` (when kid rotation lands) | ✗ | Not tested. `wellknown.service.spec.ts` derives kid but JWT verify path doesn't assert on it. |
| 48 | JWT: `iat` in future / clock-skew tolerance | ✗ | Not tested. |
| 49 | JWT: `nonce`/`jti` replay protection on verify | ~ | `tests/e2e/08_replay_protection.test.ts` — same-jti twice; accepts both idempotent and denied behavior. **No unit-level jti store test.** |
| 50 | Webhook: HMAC payload includes timestamp | ✓ | `webhook.delivery.spec.ts:5` (Stripe-style `t=…,v1=…`) |
| 51 | Webhook: HMAC matches manual recomputation | ✓ | `webhook.delivery.spec.ts:10` |
| 52 | Webhook: replay window enforced (timestamp older than N seconds rejected) | ✗ | **No verifier-side test.** The signer emits a timestamp; the consumer-side window check (per `SECURITY.md` T-2 replay model, 15min) is not exercised. |
| 53 | Webhook: secret rotation invalidates old signatures | ✗ | Not tested. |
| 54 | SDK round-trip: SDK signs, API verifies | ~ | Implicit in `tests/e2e/06_verify_happy.test.ts` (uses `signTokenFor` from fixtures, which calls SDK). **No dedicated `packages/sdk-ts/src/*.spec.ts` test that hits a real or stub API.** |
| 55 | SDK round-trip: API signs (policy token), SDK decodes/uses | ~ | `tests/e2e/04_policy.test.ts` checks JWT compact form; no SDK-side decode-and-resign test. |
| 56 | Public `/v1/agents/:id/status` works without auth | ✓ | `tests/e2e/03_agent.test.ts:55` |
| 57 | `/.well-known/audit-signing-key` shape | ✓ | `tests/e2e/12_jwks.test.ts:16`, `wellknown.service.spec.ts:104` |
| 58 | 50× concurrent verify completes within latency budget | ~ | `tests/e2e/09_spend_race.test.ts` (TOCTOU only). **No latency-budget test in e2e** equivalent to v1 `suite_stress`. The `apps/api/test/load/verify.load.test.ts` exists but is a load harness, not a CI assertion. |
| 59 | Idempotency-Key: same key + same body → same row | ✓ | `tests/e2e/15_idempotency.test.ts:36` |
| 60 | Rate limit: burst returns 429 with Retry-After | ~ | `tests/e2e/14_rate_limit.test.ts` — **soft-skips** if throttle config is loose. |

---

## 2. Top 10 missing test cases, ordered by risk

| Rank | Test | Risk | Why it matters |
|---|---|---|---|
| **1** | Multi-tenant cross-principal write isolation (revoke / create-policy / read-audit on another principal's agent) — **9/10** | Critical | Invariant #5. A bug here is RCE-equivalent for tenants. Currently *only* the read path is tested, and that test is **soft-skipped** unless a second key is supplied. Adds a guarantee that the `principalId` filter isn't accidentally dropped from a `where:` clause. |
| **2** | API key revocation actually rejects the revoked key — **9/10** | Critical | `api-key.service.ts` has no spec. A regression here lets any leaked key live forever. v1 `aegis-test.js` did not cover this either; it must be added. |
| **3** | Audit chain cross-key rejection (sign with A, verify with B → false) — **9/10** | Critical | Invariant #3. Current spec proves `verify` returns true for the right key, but never asserts it returns false for a *valid-shape but wrong* key. A subtle constant-time comparison bug or mis-passed pubkey would not be caught. |
| **4** | Audit chain e2e: re-verify Ed25519 signatures of real audit events against `/.well-known/audit-signing-key` — **8/10** | High | `tests/e2e/10_audit_chain.test.ts` checks `signature.length > 20` but does not actually run `ed25519.verify`. A malformed signature, missing `prevHash`, or mis-canonicalised payload all pass today. |
| **5** | Spend math TOCTOU at the unit level — **8/10** | High | `tests/e2e/09_spend_race.test.ts` is black-box. The atomic Lua / `INCRBY`-then-check path inside `SpendGuardService.recordSpend` has no unit test that simulates two interleaved increments. The black-box test happens to pass when Redis isn't being adversarially scheduled. |
| **6** | JWT replay protection: same `jti` rejected at the unit layer — **8/10** | High | The e2e test (`08_replay_protection`) explicitly accepts both idempotent and denied behaviour, which means the contract is **untested as written**. Add a unit-level test against a `jtiStore` interface that asserts the *second* call fails. |
| **7** | Webhook replay window enforcement (consumer-side `t=…` older than N seconds rejected) — **7/10** | High | `SECURITY.md` § 9 T-2 specifies a 15-minute replay window. The signer test exists; the *verifier* / window-check has no test. |
| **8** | Spend math: cents precision and sub-unit math — **7/10** | High | All current tests use integer dollars. Real merchants charge $9.99, $0.30 fees, etc. Tests should pin a sequence like `[9.99, 0.30, 89.71]` against a `$100` cap and assert no float-drift breakage (or document the contract: amounts are integer cents). |
| **9** | JWT `kid` mismatch rejected once kid rotation lands — **6/10** | Medium-high | `wellknown.service.spec.ts` derives kid; `jwt.util.spec.ts` ignores it. Without this test, key rotation Phase 3 silently accepts tokens signed by retired keys. |
| **10** | SDK ↔ API round-trip in `packages/sdk-ts` — **6/10** | Medium | Currently the SDK has crypto unit tests and the e2e suite uses the SDK, but the SDK package has **no test that calls a stubbed API and verifies the wire shape it sends/receives**. Refactors to the SDK's HTTP layer (e.g. moving from `fetch` to `undici`) won't be caught by current tests until the e2e runs. |

---

## 3. v1 → v2 e2e test scaffold mapping

Each row = a test from `/Users/money/Downloads/files (7)/aegis-test.js`. Status columns:

- **Equivalent in NestJS repo** = path[:line] of closest existing test, or "—" if none.
- **Status** = `✓ kept` / `~ adapted` / `✗ missing` / `· obsolete by design`.

### Suite 1: Health & Infrastructure

| v1 test | Equivalent | Status |
|---|---|---|
| `Server is reachable` | `tests/e2e/01_health.test.ts` | ✓ kept (assumed — not read here, but file exists) |

### Suite 2: Principal Registration

| v1 test | Equivalent | Status |
|---|---|---|
| `Register a new principal` | `tests/e2e/02_principal.test.ts:44` | ~ adapted (soft-skip — endpoint may not be implemented yet) |
| `Duplicate email is rejected` | `tests/e2e/02_principal.test.ts:54` (inside the same probe) | ~ adapted |
| `Missing email is rejected` | — | ✗ missing |
| `Invalid API key is rejected` | `tests/e2e/02_principal.test.ts:32` | ✓ kept |

### Suite 3: Agent Identity

| v1 test | Equivalent | Status |
|---|---|---|
| `Register agent with valid Ed25519 public key` | `tests/e2e/03_agent.test.ts:29` | ✓ kept |
| `Invalid public key is rejected` | `tests/e2e/03_agent.test.ts:39` | ✓ kept |
| `Retrieve agent details` | `tests/e2e/03_agent.test.ts:47` | ✓ kept |
| `Public status endpoint works without auth` | `tests/e2e/03_agent.test.ts:55` | ✓ kept |
| `Cannot access another principal's agent` | `tests/e2e/03_agent.test.ts:74` | ~ adapted (soft-skip without 2nd key) |
| `Register second agent (same principal)` | `tests/e2e/03_agent.test.ts:64` | ✓ kept |

### Suite 4: Policy Engine

| v1 test | Equivalent | Status |
|---|---|---|
| `Create commerce policy with spend limits` | `tests/e2e/04_policy.test.ts:27` | ✓ kept |
| `Create data-read policy for agent 2` | `tests/e2e/04_policy.test.ts:66` | ✓ kept |
| `Expired expiresAt is rejected` | `tests/e2e/04_policy.test.ts:56` | ✓ kept |
| `List policies returns active policies` | `tests/e2e/04_policy.test.ts:39` | ✓ kept |
| `Sign a per-request token from policy token` | — (v2 signs client-side) | · obsolete by design — see `tests/e2e/05_token_sign.test.ts` for the new model |

### Suite 5: Verification Engine

| v1 test | Equivalent | Status |
|---|---|---|
| `Happy path: valid token, valid scope, within spend limit → APPROVED` | `tests/e2e/06_verify_happy.test.ts:25` | ✓ kept |
| `Spend limit: transaction over maxPerTransaction → DENIED` | `tests/e2e/07_verify_denials.test.ts:106` | ✓ kept |
| `Domain restriction: unlisted domain → DENIED` | `tests/e2e/07_verify_denials.test.ts:97` (subsumed under SCOPE_NOT_GRANTED) | ~ adapted (v1 returned `DOMAIN_NOT_ALLOWED` — that reason is **not in the v2 9-reason set** per `SECURITY.md` § 6, so v2 collapses it into SCOPE_NOT_GRANTED. **This is a behavior contract change worth a regression test asserting the renaming.**) |
| `Scope mismatch: requesting data-read with commerce policy → DENIED` | `tests/e2e/07_verify_denials.test.ts:97` | ✓ kept |
| `Tampered token → INVALID_SIGNATURE` | `tests/e2e/07_verify_denials.test.ts:64` | ✓ kept |
| `Policy revocation: revoke then verify → POLICY_REVOKED` | `tests/e2e/07_verify_denials.test.ts:74` | ✓ kept |
| `Agent revocation: revoke then verify → AGENT_REVOKED` | `tests/e2e/07_verify_denials.test.ts:54` and `tests/e2e/13_revocation_propagation.test.ts:28` | ✓ kept (and strengthened with cache-bust timing assertion) |

### Suite 6: BATE

| v1 test | Equivalent | Status |
|---|---|---|
| `Successful verifications incrementally improve trust score` | — | ✗ missing in e2e (only unit `bate.scorer.spec.ts`) |
| `Fraud report drops trust score` | — | ✗ missing in e2e (probed inside `07_verify_denials.test.ts:158` ANOMALY_FLAGGED but soft-skipped) |
| `CRITICAL report drops agent to FLAGGED band` | — | ✗ missing in e2e |
| `BATE history endpoint returns signals` | — | ✗ missing in e2e |

### Suite 7: Audit Log

| v1 test | Equivalent | Status |
|---|---|---|
| `Audit log returns events with AEGIS signatures` | `tests/e2e/10_audit_chain.test.ts:44` | ~ adapted (signature *presence* checked; **cryptographic validity not re-verified** — see Top-10 #4) |
| `Audit log captures denial events` | `tests/e2e/10_audit_chain.test.ts:74` | ✓ kept |

### Suite 8: Stress / Latency

| v1 test | Equivalent | Status |
|---|---|---|
| `50 pre-signed tokens verified concurrently, all under 3000ms total` | `apps/api/test/load/verify.load.test.ts` (load harness, not CI gate); `tests/e2e/09_spend_race.test.ts` covers concurrency-correctness but not latency p99 | ✗ missing as a **CI latency gate**. The harness is there but no assertion `avg<300ms, p99<500ms` runs on every PR. |

### Suites added in v2 (no v1 equivalent — appropriate)

- `tests/e2e/12_jwks.test.ts` — well-known endpoint
- `tests/e2e/14_rate_limit.test.ts` — throttler
- `tests/e2e/15_idempotency.test.ts` — Idempotency-Key
- `tests/e2e/property/denial_precedence.property.spec.ts` — fast-check property test on precedence
- `tests/e2e/11_webhook_delivery.test.ts` — webhook signing in transit

---

## 4. Test-quality observations

Positive:

- `verify.algorithm.spec.ts` (the framework-free one) is the gold standard: it tests **behavior at a public-API contract layer** with in-memory fakes, includes precedence assertions, and pins the contract array against `@aegis/types`. Refactoring the verify pipeline will not break these tests unless the contract changes.
- `audit-chain.util.spec.ts` correctly tests *behavioral invariants* (tamper detection, chain linkage) rather than internal helpers.
- `tests/e2e/property/denial_precedence.property.spec.ts` uses fast-check to randomise condition combinations — high-leverage for a small test budget.

Brittleness / over-fit concerns:

- `verify.service.spec.ts` reaches into the cache key format (`agent:status:${id}`, `policy:${id}`) — a Redis key refactor will cascade-break this test. Extract a typed `CacheKeys` module and depend on that.
- `tests/e2e/07_verify_denials.test.ts:84` uses a wall-clock 2.5s sleep to test POLICY_EXPIRED — flaky on slow CI. Use a fake clock at the algorithm layer instead (already feasible — `verifyAlgorithm.deps.now` is mockable).
- Several e2e tests **soft-skip** when functionality isn't wired (`POST /principals/register`, webhook delivery worker, BATE propagation, throttle limits, second principal key). Soft-skipped tests are invisible — surface them in CI output as `pending`/`xfail`, not silent returns.

Coverage of the 6 architectural invariants in `CLAUDE.md`:

| Invariant | Test surface | Status |
|---|---|---|
| 1 — Private keys never enter AEGIS | Negative test (server rejects a private-key body) | ✗ no explicit test that POST /agents/register with a 64-byte secret-key shape is rejected |
| 2 — Verify hot path is portable (no Nest imports) | `verify.algorithm.spec.ts` uses ports, no Nest | ✓ enforced by tests + types |
| 3 — Audit log append-only & signed | `audit-chain.util.spec.ts` | ✓ partially; no test asserts `UPDATE`/`DELETE` are blocked at the service layer |
| 4 — No silent failures | `verify.algorithm.spec.ts:457` (`audit always written when agent known`) | ✓ tested for verify; ✗ not tested for sibling services (BATE, webhook) |
| 5 — Multi-tenant isolation by `principalId` | `tests/e2e/03_agent.test.ts:74` (soft-skip) | ✗ effectively untested (see Top-10 #1) |
| 6 — Denial precedence fixed | `verify.algorithm.spec.ts`, `property/denial_precedence.property.spec.ts` | ✓ best-tested invariant in the repo |
