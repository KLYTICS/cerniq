# OKORO Phase-1 Code Review

Review window: 2026-Q2 (pre-Phase-1 launch).
Scope: `apps/api/src/modules/{auth,identity,policy,verify,audit,bate,webhooks,health,principals,billing}` and supporting `common/{errors,crypto,redis}`.
`wellknown` is intentionally skipped (peer-locked); `verify.algorithm.ts`, `common/observability/`, `docs/decisions/`, `docs/reviews/`, and `apps/api/test/load/` were read-only.

Severity legend: **critical** (will cause data loss / silent failure / invariant breach) / **high** (correctness or security gap that must close before launch) / **medium** (quality/consistency, will accumulate debt) / **low** (nit / docs).

---

## Top 5 must-fix-before-Phase-1-launch

1. **No JWT replay protection on `/v1/verify`.** `jti` is parsed but never inserted into a `SETNX jti:* EX (exp-iat)` cache. A captured token replays freely for the full 60 s lifetime of the JWT, against the explicit T-2 mitigation in `docs/SECURITY.md` § 9. (verify.algorithm.ts § Step 3 / jwt.util.ts:57). High.
2. **Audit on the verify hot path is fire-and-forget with no DLQ** — `void this.audit.append(...).catch(...)` in `verify.service.ts:86,107` and `bate.service.ts:46`. A Postgres outage that lasts 30 s creates a permanent gap in the append-only chain (CLAUDE.md invariant #3, SECURITY § T-5). No BullMQ "audit pending" queue exists despite SECURITY.md promising one. Critical.
3. **Spend-guard race: TOCTOU between `check()` and `recordSpend()`.** `SpendGuardService.check` reads the day/month counters with separate `GET`s, then a later `recordSpend` does an `INCRBYFLOAT`. Two concurrent verifies of $X each on a $Y < 2X day-cap both pass and both record (`spend-guard.service.ts:31-73`). Atomic check-and-increment via a single Lua script is required. The Express prototype has the same flaw, so this is *correctness regression vs. the spec budget*, not parity. Critical.
4. **`recordSpend` durability path is fire-and-forget through a `Promise.all` from a fire-and-forget caller.** `verify.algorithm.ts:86` calls `ports.recordSpend(...)` synchronously (void return), and the Nest adapter immediately wraps it in `void ... .catch(log)` (verify.service.ts:80-84). If the Postgres `SpendRecord.create` inside that Promise.all throws, the Redis counter is already incremented but the durable backstop is missing — quota leaks silently. Critical (couples to #2).
5. **Audit-chain ordering bug under concurrent appends.** `audit.service.ts:78` selects `prev` per agentId by `orderBy: { timestamp: 'desc' }`, then signs and inserts without holding a lock. Two concurrent appends for the same agent will read the same `prev`, both sign over the identical prev_hash, and the chain forks (one event ends up off-chain). Needs an advisory lock keyed on `(principalId, agentId)` or a serial sequence column. Critical for invariant #3.

---

## auth/

### auth/api-key.guard.ts:41,44,49 — uses `UnauthorizedException` with custom envelope
- **Severity:** medium
- **Why:** CLAUDE.md "Errors are typed". `AuthenticationError` exists in `common/errors/okoro-error.ts` but is bypassed in favor of NestJS' `UnauthorizedException({error, message})`. The `HttpExceptionFilter` (referenced in `common/filters/`) presumably maps these, but the audit doc's claim that envelope is uniform requires consistent `code` field — `error` vs `code` drift will surface in the dashboard.
- **Fix:** throw `new AuthenticationError('...')` (or a new `KeyScopeError`) so `code` is `AUTH_REQUIRED`/etc. uniformly.

### auth/api-key.service.ts:64 — bcrypt fan-out is O(N) per request
- **Severity:** medium
- **Why:** `findMany({ where: { keyPrefix } })` returns *every* unrevoked key sharing a 12-char prefix; bcrypt.compare runs sequentially. With cost 12 (~250 ms each) and a 1-in-256³ collision rate, two colliding keys turn one auth call into 500 ms. The "shard at 100k" plan assumes a worst-case prefix collision count of 1, which is not guaranteed.
- **Fix:** add a unique index on `keyPrefix`+a deterministic SHA-256 fingerprint to short-circuit the candidate set.

### auth/api-key.service.ts:69 — fire-and-forget `lastUsedAt` update
- **Severity:** low
- **Why:** acceptable but rate-limit it (e.g. only update if `now - lastUsedAt > 60s`); under verify load this is one extra UPDATE per call.

---

## identity/

### identity.service.ts:25-26 — INITIAL_SCORE/INITIAL_BAND hard-coded, not pulled from `bate.cold-start.ts`
- **Severity:** high
- **Why:** Duplicated source-of-truth. `bate.cold-start.ts` exports `INITIAL_SCORE = 500` / `INITIAL_BAND = 'VERIFIED'`. If OD-002 is ever decided differently, `IdentityService.register` will silently mint agents with stale defaults. CLAUDE.md "Constants live in `packages/types`, not duplicated across services."
- **Fix:** `import { INITIAL_SCORE, INITIAL_BAND } from '../bate/bate.cold-start'` (or move both to `packages/types`).

### identity.service.ts:37,46,66 — `NotFoundException` with `{error, message}` envelope
- **Severity:** medium (×3 sites, replicated across policy/audit)
- **Why:** Same as auth — should throw `NotFoundError('Agent', ...)` from the typed hierarchy. Currently the `code` field returned to clients is `NOT_FOUND` from the envelope only if the global filter picks it up; otherwise the response is `{statusCode, message: {error, message}}`.
- **Fix:** replace with `throw new NotFoundError('Agent')` consistently.

### identity.service.ts:54 — revoke busts only `agent:status:{id}`
- **Severity:** high
- **Why:** ARCHITECTURE.md § 4 lists `agent:public-status:{id}` as a separate cache (used by the public `/agents/:id/status` route, identity.service.ts:75). Revoking an agent leaves the public-status endpoint serving "ACTIVE" for up to 30 s. Identical issue in policy.service.ts (only `policy:{id}` invalidated, no `verify:{tokenHash}:{action}` bust — though that one's TTL-only by design).
- **Fix:** `redis.del('agent:status:{id}', 'agent:public-status:{id}')` and document that token-hash cache is TTL-only.

### identity.service.ts:62 — `publicStatus` does not filter by principalId
- **Severity:** low (intentional — public route per SECURITY.md § 2) — flagging only because the cache key isn't namespaced. Two principals can never share an agent id (cuid), so safe in practice. No fix.

---

## policy/

### policy.service.ts:1,55,46 — uses `ForbiddenException` / `NotFoundException` with custom envelope
- **Severity:** medium
- **Why:** Same untyped-error pattern. Worse: `INVALID_EXPIRY` is thrown as `ForbiddenException` (HTTP 403) when it's a 400 INVALID_REQUEST.
- **Fix:** `throw new ValidationError('expiresAt must be in the future.')` and `throw new AuthorizationError('Cannot create policies for a revoked agent.')` for the revoked branch.

### policy.service.ts:50 — bare `throw new Error(...)` for missing signing material
- **Severity:** high
- **Why:** This will surface to the client as a 500 with a stack-trace-leaking message in dev. Should be `InternalError` (and ideally the module's `OnModuleInit` should fail to boot rather than discover this on first request).
- **Fix:** validate `JWT_ED25519_*` env at boot via the Zod config schema; throw `InternalError` here as a defensive last line.

### policy.service.ts:71-78 — `tokenPayload as any`
- **Severity:** medium
- **Why:** CLAUDE.md "No `any` unless justified with `// type-rationale:`." The cast is unnecessary — define a `PolicyTokenClaims` and have `JwtUtil.sign` accept a generic.
- **Fix:** widen `JwtUtil.sign<T extends BaseClaims>(claims: T, ...)`.

### policy.service.ts (no replay-protection on policy issuance)
- **Severity:** medium
- **Why:** No idempotency; resubmitting `create()` with the same DTO mints a fresh policy + JWT. Should respect `Idempotency-Key` (the `idempotency/` middleware exists at common/idempotency).

---

## verify/

### verify.service.ts:80-89,96 — fire-and-forget side effects with no DLQ
- **Severity:** critical (top-5 #2)
- **Why:** Already covered above. Re-stating because it appears 4 times in this single file (`recordSpend`, `recordAudit`, `ingestSignal`, `touchAgent`) and the algorithm doc-comment on lines 47-53 explicitly says "fail-closed" — but the Nest adapter's spend port returns the Redis-counter result only, with no fallback to Prisma `SpendRecord` if Redis is down. `SpendGuardService.check` returns `allowed: true` when both Redis lookups return `null` (cache miss), which silently fails open.
- **Fix:** (a) wrap each fire-and-forget in a BullMQ enqueue with DLQ; (b) on Redis-miss in spend-guard, query `SUM(amount)` from `SpendRecord` as backstop.

### verify.service.ts:110 — `principalId: result.principalId ?? 'unknown'` on denial-audit path
- **Severity:** high
- **Why:** "Fabricated data" — CLAUDE.md invariant #4. Writing the literal string `'unknown'` into the `principalId` column of an immutable, signed audit row is exactly the silent-failure pattern the invariant forbids. Worse, it breaks multi-tenant queries (an attacker probing for unknown agent ids creates `principalId='unknown'` rows that surface in *every* tenant-scoped audit listing if the query ever drops `principalId` filter).
- **Fix:** if `principalId` is null (AGENT_NOT_FOUND / INVALID_SIGNATURE pre-agent-lookup), do **not** write to the per-agent audit chain — write to a separate `SystemAuditEvent` table (or a dedicated `principalId='__system__'` chain that's documented and queried explicitly).

### verify.service.ts:126 — denial_reason metric label cardinality is bounded but `'none'` is misleading
- **Severity:** low
- **Why:** Approved calls record `denial_reason='none'`; standard practice is to omit the label when not applicable. Minor — Prometheus accepts it.

### verify/algorithm/verify.algorithm.ts:36 — SUSPENDED collapses into `AGENT_NOT_FOUND`
- **Severity:** medium
- **Why:** Comment says "SUSPENDED leaks nothing" but SECURITY.md § 6 lists exactly nine denial reasons, none of which is suspended-as-not-found. Document this aliasing in SECURITY.md or add `AGENT_SUSPENDED` to the public enum (the Express prototype emits `AGENT_SUSPENDED` literally — line 476). Either choice is fine; the gap between docs and code is the bug.

### verify/algorithm/verify.algorithm.ts:44-45 — POLICY_NOT_FOUND collapses into POLICY_EXPIRED
- **Severity:** medium
- **Why:** Same class of issue as above. Express prototype emits `POLICY_NOT_FOUND`. Decide and document.

### verify/algorithm/verify.algorithm.ts (denial precedence vs CLAUDE.md)
- **Severity:** **OK** — order is `INVALID_SIGNATURE (token shape) → AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE (sig) → POLICY_REVOKED → POLICY_EXPIRED → SCOPE → SPEND`. Note that the *first* `INVALID_SIGNATURE` (malformed token) runs before `AGENT_NOT_FOUND`, which is **a precedence violation** of CLAUDE.md's stated order (`AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → ...`). However, a malformed token has no `sub` so AGENT_NOT_FOUND can't be evaluated. Acceptable, but **document the exception** in SECURITY.md § 6 ("INVALID_SIGNATURE may also be returned when the token is structurally undecodable").
- **Severity (after caveat):** low — mostly a doc fix.

### verify/algorithm/verify.algorithm.ts (TRUST_SCORE_TOO_LOW + ANOMALY_FLAGGED missing)
- **Severity:** high
- **Why:** Steps 8-9 assert "trust score is precomputed; emit it" but there's no enforcement. SECURITY.md § 6 #8-9 promise these denial reasons. The DenialReason enum lists them; nothing emits them.
- **Fix:** accept a `minTrustScore` field on `VerifyAlgorithmInput` (relying-party-supplied per SECURITY.md), compare against `agent.trustScore`, emit `TRUST_SCORE_TOO_LOW`. Plumb a flag column on `AgentIdentity` (or check `trustBand === 'FLAGGED'`) for `ANOMALY_FLAGGED`.

### verify/spend-guard.service.ts:31-73,82-101 — TOCTOU race + non-atomic record
- **Severity:** critical (top-5 #3, #4)
- **Why:** Already detailed. Additional: `recordSpend` uses `Promise.all` with the Postgres `SpendRecord.create`. If the Postgres write rejects, the two Redis writes have already landed, leaving counters > durable history.
- **Fix:** single Lua script `EVALSHA` doing `INCRBYFLOAT day; INCRBYFLOAT month; if either > cap then DECRBY back and return 0`. Persist `SpendRecord` *first*, increment Redis on success.

### verify/spend-guard.service.ts:46-52 — Redis-miss returns `0` and allows the spend
- **Severity:** critical
- **Why:** `redis.get` returns `null` on either "key absent" (legitimate first spend of the day) or "Redis down" (failure mode). The two are indistinguishable; both yield `daySpend = 0`. With Redis unreachable, every spend of the day approves. Fail-open.
- **Fix:** `redis.get` should distinguish miss from error (or wrap a circuit-breaker that flips spend-guard to Prisma-direct).

---

## audit/

### audit/audit.service.ts:78-110 — concurrent append race forks the chain
- **Severity:** critical (top-5 #5)
- **Why:** Detailed above.
- **Fix:** `pg_advisory_xact_lock(hashtext('audit:' || agentId))` inside a single transaction that selects prev, computes signature, and inserts.

### audit/audit.service.ts:55-62 — production-only env check happens lazily
- **Severity:** high
- **Why:** `initSigningKey` is called from `AuditModule.onModuleInit`, which is correct, but the module file (`audit.module.ts`) doesn't crash the process on missing prod keys — it surfaces as a thrown Error during a verify call when the appended audit fails. Verify will continue to *approve* requests because the audit append is fire-and-forget (see top-5 #2). In prod, missing audit keys should refuse to boot.
- **Fix:** validate `auditEd25519PrivateB64` in the Zod config schema with a `.refine(...)` keyed on `nodeEnv === 'production'`.

### audit/audit.service.ts:267-272 — `cryptoRandomId` reaches into `node:crypto` via `require()` inside the function
- **Severity:** medium
- **Why:** Breaks tree-shake, prevents CF Worker portability if this util ever moves to the hot path, and the comment "26-char base62-ish" is misleading — base64url already excludes the unsafe chars; the `replace(/[^a-zA-Z0-9]/, '')` strips `-` and `_` and *reduces entropy* below 26·log2(62) ≈ 154 bits down to a variable-length string. Use `randomUUID()` (per SECURITY.md § 3) or a top-level `import { randomBytes } from 'node:crypto'`.
- **Fix:** `import { randomUUID } from 'node:crypto'` at top of file; `evt_${randomUUID().replace(/-/g, '')}`.

### audit/audit.service.ts:138-178 — `list()` does **not** verify chain integrity before returning
- **Severity:** medium
- **Why:** The whole point of the chain is that consumers can detect tampering. The `list` endpoint hands events back without recomputing signatures. Acceptable for the dashboard "show me my events" use case, but a Phase-1 risk: a tampered DB row appears valid in dashboards. Add an opt-in `?verify=true` that runs `AuditChainUtil.verify` row-by-row.

### audit/audit.service.ts:88-100 — `policySnapshot` typed as `unknown` then cast to `Prisma.InputJsonValue`
- **Severity:** low
- **Why:** OK in practice — value is the policy scopes array. Add a runtime Zod check before the cast for defense-in-depth.

### audit chain mismatch (RSA-SHA256 vs Ed25519/chained) — **NOT PRESENT**
- The reviewed `audit.service.ts` uses `AuditChainUtil.sign` which is Ed25519 of `prev_hash || canonical(payload)` — matches `docs/ARCHITECTURE.md` § 6 exactly. The `RSA-SHA256(JSON.stringify())` pattern called out in the review prompt is **not in this codebase**; if it appears in another branch or in the Express prototype, it's been correctly migrated. Confirmed compliant.

---

## bate/

### bate/bate.service.ts:46 — recompute is fire-and-forget with no idempotency
- **Severity:** high
- **Why:** Every signal triggers a recompute. Under load (verify burst → many `CLEAN_TRANSACTION` signals) this thrashes the agent row's lastScoredAt and writes spurious `TrustScoreHistory` rows. The "Phase 2 moves to BullMQ worker" comment is a promise without a ticket.
- **Fix:** debounce by agentId in Redis (`SET bate:recompute:{agentId} 1 EX 5 NX`); skip if held.

### bate/bate.service.ts:74-82 — `$transaction` will retry on conflict, double-writing TrustScoreHistory
- **Severity:** medium
- **Why:** Prisma `$transaction([...])` is one-shot, but if two recomputes race (no lock around the read of `agent.trustScore`), both can compute different scores and both will INSERT a history row. Result: two history rows for the same recompute, last-write-wins on the agent table.
- **Fix:** use `prisma.$transaction(async (tx) => { ... })` with a `SELECT ... FOR UPDATE` on the agent row.

### bate/bate.controller.ts (no auth scope check)
- **Severity:** high
- **Why:** Endpoint is `@ApiSecurity('ApiKeyAuth')` but doesn't take `@Auth()` — it accepts a relying-party report for *any* `agentId` regardless of who's calling. SECURITY.md § T-4 says reports require `RelyingParty.reportWeight` — none of that is enforced here. A free-tier API key holder can drive any agent's score down with `fraud_confirmed: critical` (-500/report).
- **Fix:** require an authenticated `RelyingParty` (separate auth path), validate `reportWeight > 0`, attach the source to the signal, and rate-limit per RP per agent per day.

### bate/bate.controller.ts:60 — no `principalId` filter; cross-tenant signal injection
- **Severity:** critical
- **Why:** Same root cause as above — even if you accept that RPs can report on cross-principal agents (SECURITY.md § 5 paragraph 4), the controller doesn't even attempt to record *who* reported. The signal's `source: 'relying_party'` is a literal string. The CLAUDE.md "every service method takes principalId as the first arg" rule is plainly violated.
- **Fix:** see above; do not ship this controller in its current form.

---

## webhooks/

### webhooks/webhook.delivery.ts:71-73 — `markAbandoned` invoked from `'failed'` event handler is racy
- **Severity:** medium
- **Why:** The `'failed'` listener checks `attemptsMade >= MAX_ATTEMPTS` and marks abandoned, but BullMQ may also requeue depending on attempts setting. There's also no DLQ topic/queue — abandoned deliveries become quietly stuck rows.
- **Fix:** add a `okoro.webhooks.dlq` BullMQ queue; route abandoned jobs there with a 30-day retention so ops can replay.

### webhooks/webhook.delivery.ts:153-157 — sets status to PENDING after each attempt
- **Severity:** low
- **Why:** Loses observability — `WebhookDelivery.status` toggles between PENDING and ABANDONED but never has a "RETRYING" state. Add a status enum value or rely on `attempts > 1` for the dashboard.

### webhooks/webhooks.service.ts:53-75 — `enqueue` swallows errors
- **Severity:** medium
- **Why:** `try/catch` logs and returns. If the `webhookDelivery.create` transaction fails, the caller (typically `verify.service` or `policy.service`) thinks the event was enqueued. Combine with no-DLQ and you have lost events. CLAUDE.md invariant #4: silent failure.
- **Fix:** at minimum bump a `metrics.webhookEnqueueFailed.inc()` counter; ideally surface to the caller.

### webhooks/webhooks.service.ts:53 — `enqueue` does not take principalId as first arg
- **Severity:** low — the parameter exists but is the *second* arg, contra the CLAUDE.md convention. Reorder.

---

## health/

### health/health.controller.ts:17 — `live()` returns `{status: 'ok', ts}` unconditionally
- **Severity:** low — correct (liveness should never depend on deps), but consider returning `200` with a *very* small body (just `'ok'`) for sub-ms response on a route that gets hit every second by k8s.

### health/metrics.controller.ts:18 — `/metrics` is `@Public`
- **Severity:** medium
- **Why:** Comment says "production should put this behind a private network." On Railway (current host), there's no private network by default. Anyone on the internet can scrape verify-rate / denial-rate / per-tenant cardinality. Even when no labels include principal IDs, the *aggregate* rate is competitive intel.
- **Fix:** require a bearer token (`METRICS_SCRAPE_TOKEN` env) — Prometheus supports it natively.

---

## principals/

The directory is **empty**.

- **Severity:** high
- **Why:** `Principal` is a first-class entity in the Prisma schema and ARCHITECTURE.md § 3 ("Principal ─< ApiKey..."). A self-service principal-create / KYC-verify / plan-change surface is required for billing to work end-to-end, and the auth guard already populates `req.auth.principalId` from the API key — meaning that principal exists in the DB *before* the controller is implemented (presumably hand-seeded). Either ship the module or document the seeding path so an SRE can onboard a customer.
- **Fix:** at minimum add a `GET /v1/principals/me` returning `{ id, planTier, monthVerifyCount }` so the dashboard works.

---

## billing/

### billing/plans.ts (clean — pure constants module)
- **Severity:** none — well-structured, version-tagged, no DI, and `isVerifyCallAllowed` correctly distinguishes hard-stop from metered overage.
- **Note:** `monthlyVerifyQuota: Number.POSITIVE_INFINITY` for ENTERPRISE — Prisma/Postgres int columns can't store this, so the meter logic must guard against `Infinity` arithmetic. Confirm `usage.service.ts` (referenced in the file's docstring but not present in this review's scope) handles it.

### billing/ — no `usage.service.ts`, no `stripe.service.ts`
- **Severity:** high
- **Why:** Both are referenced by the `plans.ts` docstring. Without usage metering, plan quotas are unenforceable. Without Stripe, billing is conceptual. This is the single biggest "missing module" gap before Phase 1.

---

## Cross-cutting findings

### CC-1: `OkoroError` hierarchy is underused
- **Severity:** medium (touches every module)
- **Affected:** `auth`, `identity`, `policy`, `audit` controllers/services use NestJS' built-in `UnauthorizedException`/`NotFoundException`/`ForbiddenException` with custom payloads instead of throwing `AuthenticationError`/`NotFoundError`/`AuthorizationError` from `common/errors/okoro-error.ts`. Result: error envelopes are inconsistent (`{error,message}` vs `{message,details,code}`), `instanceof` checks in interceptors don't match, and the typed `code` field promised in ARCHITECTURE.md § 5 is missing on most paths.
- **Fix:** sweep all `throw new XxxException({error, message})` → `throw new OkoroErrorSubclass(...)` and rely on `HttpExceptionFilter` to render. Add an ESLint rule banning the Nest built-ins from `src/modules/`.

### CC-2: Replay protection (jti cache) absent everywhere
- **Severity:** high (top-5 #1)
- **Where:** `verify.algorithm.ts` consumes `claims.jti` only via the unsafe decoder; never persists it. `policy.service.ts:67` mints a `jti` per policy but never tracks issuance.
- **Fix:** in the verify algorithm, after Step 3 (signature pass), `SET replay:{jti} 1 NX EX (claims.exp - now)`; on collision return `INVALID_SIGNATURE` (do not introduce a new public reason — replay is a signature/freshness failure).

### CC-3: Cache invalidation deviations from ARCHITECTURE.md § 4
- **Severity:** medium
- ARCHITECTURE.md lists `agent:{id}` (60 s) — code uses `agent:status:{id}` (60 s). Different key.
- `agent:{id}:trust` is documented but not used; trust is bundled into `agent:status:{id}`.
- `verify:{tokenHash}:{action}` is documented but not implemented anywhere.
- `spend:{policyId}:day:{...}` is documented; code uses `spend:day:{agentId}:{policyId}:{...}` — extra `agentId` segment, different naming.
- **Fix:** either update the doc or rename the keys. Keep the table the source of truth and add a `// CACHE: ...` comment on every set/get.

### CC-4: `npm bcrypt` cost is configurable but unverified at boot
- **Severity:** low — `apiKeyBcryptCost` from config is taken at face value. Add a Zod `.min(10).max(15)` so a misconfigured `cost=4` doesn't slip through.

### CC-5: `Math.random` audit
- Spot-checked: no `Math.random` in production paths in this scope. CLAUDE.md compliant.

### CC-6: TypeScript `any` audit
- One `any` found (`policy.service.ts:77`) flagged above. Otherwise clean.

---

## Summary scoreboard

| Module       | Critical | High | Medium | Low |
|--------------|----------|------|--------|-----|
| auth         | 0        | 0    | 2      | 1   |
| identity     | 0        | 1    | 1      | 1   |
| policy       | 0        | 1    | 2      | 0   |
| verify       | 3        | 2    | 2      | 1   |
| audit        | 1        | 1    | 2      | 1   |
| bate         | 1        | 2    | 1      | 0   |
| webhooks     | 0        | 0    | 3      | 1   |
| health       | 0        | 0    | 1      | 1   |
| principals   | 0        | 1    | 0      | 0   |
| billing      | 0        | 1    | 0      | 1   |
| cross-cutting| 0        | 1    | 2      | 2   |
| **Total**    | **5**    | **10** | **16** | **9** |

The five criticals (3 in verify, 1 in audit, 1 in bate-controller) are the launch blockers. Everything `high` and below is Phase-1.x debt — important but not gating.
