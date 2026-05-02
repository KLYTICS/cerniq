# Silent failure review — apps/api hot path
Reviewer: silent-failure-hunter
Date: 2026-05-01

Scope: 10 files in the verify hot path + crypto + audit chain. Weighed against
CLAUDE.md invariant #4 (no silent failures, no fabricated data) and
SECURITY.md § Denial Precedence + § Audit chain integrity.

---

## Critical (block ship)

### F-001 — `redis.incrBy` returns `0` on Redis failure, silently breaking spend counters
- File: `apps/api/src/common/redis/redis.service.ts:80-93`
- What: When the Lua `INCRBYFLOAT` script throws, the catch logs a warn and
  returns `0`. `SpendGuardService.recordSpend` calls this in a `Promise.all`
  alongside the Postgres write — so the in-memory spend counter falls back
  to zero on Redis failure while persistence may still succeed.
- Why bad: The very next `check()` call reads `spend:day:*` keys with
  `redis.get` (which also returns `null` on failure → treated as 0). An
  attacker who can briefly degrade Redis (or an outage during the
  increment) gets a clean window where day/month spend caps appear empty
  even though Postgres has the records. This silently approves
  over-limit charges, violating denial precedence rule #7
  (`SPEND_LIMIT_EXCEEDED`).
- Hidden errors: Lua syntax error after refactor, NOSCRIPT after Redis
  restart, OOM, connection drop mid-EVAL, MOVED in cluster mode, type
  mismatch if a key was set as JSON elsewhere.
- Fix: `incrBy` failure must propagate. Spend write is an enforcement
  primitive, not a cache hint. Either throw and let `recordSpend` fail
  the verify call, OR write to Postgres first and reconstruct Redis from
  Postgres on next `check()` cold path.
- Example:
  ```ts
  } catch (err) {
    this.logger.error(`redis.incrBy(${key}) failed: ${(err as Error).message}`);
    throw new SpendCounterUnavailableError(key, err);
  }
  ```

### F-002 — Spend `check()` fails open when Redis returns `null`
- File: `apps/api/src/modules/verify/spend-guard.service.ts:46-52`
- What: `redis.get<number>` returns `null` on cache miss AND on every
  Redis failure (see `redis.service.ts:43-52`). `check()` coerces both
  to `0` (`day ?? 0`). The doc-string promises a "Prisma backstop on
  Redis miss" — there is no such backstop in code.
- Why bad: This is the exact failure mode `verify.service.ts:50-52`
  documents as "fail-closed". It actually fails OPEN: Redis down →
  daySpend treated as 0 → all spend checks pass until the cap. Direct
  contradiction of the comment claiming `checkSpend` returns `false`
  when unavailable.
- Hidden errors: Redis network partition, key eviction under maxmemory,
  JSON parse error from a corrupted value (returns `null` after
  `redis.service.ts:49` warn).
- Fix: Distinguish "key absent" (legitimately 0) from "Redis
  unavailable" (must fail-closed). Either return a tri-state from
  `redis.get` (`{ ok: true, value } | { ok: false }`) or wire the
  promised Postgres aggregate fallback.

### F-003 — Verify hot path fire-and-forgets the DENIED audit append with `.catch(() => undefined)`
- File: `apps/api/src/modules/verify/verify.service.ts:105-115`
- What: When verify denies, the Nest adapter writes the denial audit
  with a bare `.catch(() => undefined)`. Every other forwarder at least
  logs (`recordSpend`, `audit.append`, `bate.ingestSignal` lines 81/86/91).
- Why bad: This is the literal "T-5 audit log gap" scenario in
  SECURITY.md §9 — a denial that never made it into the chain. The
  user-facing response will still report `valid: false` with a denial
  reason, but compliance evidence is missing and there is zero log
  signal that the gap occurred. SECURITY.md §8 requires a DLQ here.
- Hidden errors: Postgres connection refused, FK violation on
  `agentId` (e.g. agent deleted between the verify decode and audit
  write), unique constraint, signing-key not initialised
  (`audit.service.ts:65` would throw before returning).
- Fix: Mirror the pattern on lines 83-87: log via `this.logger.error`
  with eventId context AND emit a metric / push to a `audit:dlq` queue.
  Never use empty-arrow catches in this file.

---

## High

### F-004 — `JwtUtil.verifyAndDecode` collapses every failure into `null`
- File: `apps/api/src/common/crypto/jwt.util.ts:57-83`
- What: Returns `null` for: malformed token, bad base64, signature
  mismatch, expired claim, missing `sub`/`pid`, AND any thrown error.
  The verify algorithm (`verify.algorithm.ts:40`) maps `null` to
  `INVALID_SIGNATURE` regardless.
- Why bad: A noble-ed25519 internal exception (e.g. version drift, key
  length) becomes indistinguishable from an attacker submitting a forged
  token. Operators cannot tell "we are under attack" from "our crypto
  lib broke after upgrade". Also misclassifies expired tokens as
  invalid signature, breaking client retry logic and the documented
  denial precedence (SECURITY.md §6 lists `INVALID_SIGNATURE` and
  `POLICY_EXPIRED` as distinct codes).
- Hidden errors: `@noble/ed25519` API breakage, `JSON.parse` of a
  malicious oversized payload (DoS via `JSON.parse` cost), TextDecoder
  throwing on invalid UTF-8.
- Fix: Return a discriminated union — `{ kind: 'ok', claims } | { kind:
  'malformed' } | { kind: 'bad_sig' } | { kind: 'expired' } | { kind:
  'crypto_error', err }`. Log `crypto_error` at error-level with the
  underlying message; never let an internal crypto fault masquerade as
  client-side bad input.

### F-005 — `Ed25519Util.verify` swallows all exceptions
- File: `apps/api/src/common/crypto/ed25519.util.ts:29-38`
- What: `try { ... } catch { return false; }` — same problem as F-004
  scoped to the lower-level primitive. Audit-chain verification
  (`audit-chain.util.ts:98-113`) inherits this pattern.
- Why bad: A library-internal exception during chain verification
  (`audit-chain.util.ts:103-112`) becomes "tampering detected" with no
  log. Compliance auditors investigating a chain break can't tell a
  real tamper from a base64 decode bug.
- Hidden errors: `decodeBase64Url` throwing on non-base64 input,
  noble curve point-decoding errors, signature length mismatches.
- Fix: Add `this.logger.error` (inject a Logger or take a
  callback). Distinguish "input was malformed" (return false) from
  "verification ran and rejected" (return false) from "internal error"
  (re-throw or return a tagged error).

### F-006 — `BateService.ingestSignal` swallows non-uniqueness errors with substring matching
- File: `apps/api/src/modules/bate/bate.service.ts:38-44`
- What: Catches every Prisma error, then uses `msg.includes('Unique
  constraint')` to decide whether to log. Any other class of error
  (FK, connection, validation, transaction abort) is logged at `warn`
  but never re-thrown, never DLQ'd, never metric'd.
- Why bad: BATE is the source of truth for the trust-score signal
  history that drives `TRUST_SCORE_TOO_LOW` and `ANOMALY_FLAGGED`
  denials (SECURITY.md §6 #8/#9). Silent ingest loss => stale trust
  scores => missed denials. Substring matching on i18n'd error text is
  fragile — Prisma error wording changes between versions.
- Hidden errors: Postgres connection drop, FK violation when agent was
  deleted, JSON column too-large payload, schema drift after migration.
- Fix: Match on `Prisma.PrismaClientKnownRequestError` with `code ===
  'P2002'`. Push other failures to a `bate:dlq` BullMQ queue so the
  Phase 2 worker can retry. Log at `error`, not `warn`.

### F-007 — `loadAgent` / `loadPolicy` cache writes can silently fail with no visibility
- File: `apps/api/src/modules/verify/verify.service.ts:154, 176`
- What: `redis.set(...)` returns `Promise<void>` and swallows internal
  errors (`redis.service.ts:62-64`). The verify path never observes
  the failure. Combined with the lack of metrics, a Redis outage will
  manifest as a sudden 100x DB load with no alarm signal.
- Why bad: Capacity invariant — the design assumes 60s agent cache and
  30s policy cache. Silent set-failures break that assumption without
  warning until Postgres falls over.
- Fix: Increment a `cache_set_failed_total{key_prefix}` counter even
  if the path itself stays best-effort. At minimum elevate from `warn`
  to `error` for sustained failures (rate-limited) — `warn` rolls off
  most Pino dashboards.

### F-008 — `touchAgent` swallows error with `.catch(() => undefined)`
- File: `apps/api/src/modules/verify/verify.service.ts:94`
- What: Unlike the other ports on lines 81/86/91 (which log), `touchAgent`
  has a bare empty catch.
- Why bad: `touchAgent` writes `lastSeenAt` and `verifyCount` —
  customer-visible telemetry. If it persistently fails, the dashboard
  shows agents as "never seen" while they're actively verifying. No
  log = no alert.
- Fix: Same pattern as the sibling lines: `.catch((err) =>
  this.logger.warn(\`touchAgent failed: ${...}\`))`.

---

## Medium

### F-009 — `JwtUtil.decodeUnsafe` empty catch
- File: `apps/api/src/common/crypto/jwt.util.ts:89-98`
- What: `catch { return null }`.
- Why bad: This is the FIRST step of the verify algorithm
  (`verify.algorithm.ts:26-29`); a `null` here is mapped to
  `INVALID_SIGNATURE`. A JSON parse exception (oversized payload, prototype
  pollution attempt) leaves no log trail of attack-shaped traffic.
- Fix: Log at debug with truncated input prefix; emit a counter for
  `jwt_decode_failed_total` so traffic anomalies surface in metrics.

### F-010 — `recordSpend` Postgres write wrapped in `Promise.all` with cache writes
- File: `apps/api/src/modules/verify/spend-guard.service.ts:94-100`
- What: All three writes share one `await Promise.all`. If the Postgres
  insert throws, the call rejects — but by that time the Redis
  counters have already incremented. Conversely, if Redis throws after
  Postgres succeeded, `recordSpend` rejects and the verify adapter
  (`verify.service.ts:81`) only logs, not retries. Net result: cache
  and DB drift silently and there is no reconciliation job.
- Fix: Sequence as Postgres-first (durable record) → Redis-second
  (cache hint). On Redis failure, log at error and emit `spend_drift_total`.
  Add a periodic reconciliation job.

### F-011 — Spend guard fire-and-forget without DLQ
- File: `apps/api/src/modules/verify/verify.service.ts:78-82`
- What: `recordSpend` is fire-and-forget with a log on failure. There
  is no DLQ, no retry, no metric.
- Why bad: Spend over-counting/under-counting is a money issue for
  customers. A burst of Postgres errors during a busy window leaves no
  recoverable trail. SECURITY.md §8 specifies DLQ for the analogous
  audit path; spend deserves the same.
- Fix: Wrap the call in a BullMQ job with retries + DLQ. Log alone is
  insufficient for a financial counter.

### F-012 — `audit.service.append` reads `prev` outside any transaction
- File: `apps/api/src/modules/audit/audit.service.ts:78-131`
- What: `findFirst` for the previous event and the subsequent
  `auditEvent.create` are not in a `$transaction`. Two concurrent
  appends for the same agent can read the same `prev` and produce a
  forked chain. The error in `try { create }` is logged and re-thrown,
  but a successful-but-forked write is silent — the chain integrity
  invariant breaks with no signal until export-time verification.
- Fix: Wrap in `$transaction` with `Serializable` isolation, OR add a
  unique index on `(agentId, prevEventId)` so the second insert fails
  with P2002 and the caller can retry. Log chain-fork detection as
  CRITICAL.

### F-013 — `policy.service.create` fabricates `as any` cast on token payload
- File: `apps/api/src/modules/policy/policy.service.ts:73-79`
- What: Not a silent failure per se, but the `as any` payload bypass
  silences TypeScript from catching shape drift between policy tokens
  and `AgentTokenClaims`. CLAUDE.md "no `any` without a `// type-rationale:`"
  is violated (`eslint-disable` instead).
- Why bad: A future change to `AgentTokenClaims` won't trip a compile
  error here; downstream JWT verifiers may silently start failing on
  schema mismatch.
- Fix: Define a `PolicyTokenClaims` interface and a `signPolicyToken`
  method on `JwtUtil`.

---

## Notes (intentional patterns observed)

- `audit.service.ts:46-62` — Ephemeral key generation in non-production
  is gated by an explicit `nodeEnv === 'production'` throw and a `WARN`
  log. This is correct: dev convenience, prod safety, loud signal.
- `audit.service.ts:75, 132-135` — `append()` re-throws on persistence
  failure. The hot-path `.catch(...)` decisions belong to the *callers*
  (verify.service.ts), not this method. The service itself is
  well-behaved; the issues are at the call sites (F-003).
- `verify.algorithm.ts:36` — Treating `SUSPENDED` agents as
  `AGENT_NOT_FOUND` is intentional info-leak prevention per SECURITY.md
  §6 ("identity issues before policy issues"). Not a silent failure.
- `verify.algorithm.ts:43-45` — Collapsing missing-policy into
  `POLICY_EXPIRED` is intentional ID-existence non-disclosure. Not a
  silent failure.
- `bate.service.ts:46-48` — `recompute` is intentionally fire-and-forget
  with a logged `warn`. Acceptable for Phase 1 since BATE is documented
  as eventually-consistent; flagged separately as F-006 for the
  sibling ingest call which has weaker observability.
- `redis.service.ts:30-37` — `ping()` swallowing on error is correct
  for a healthcheck primitive (caller wants a boolean).
- `identity.service.ts` and `policy.service.ts` — no swallowed
  exceptions in the controller-callable paths; errors propagate as
  Nest exceptions correctly.

---

## Summary

13 findings: 3 Critical, 5 High, 5 Medium. The most concerning theme is
that the spend-enforcement chain (F-001, F-002, F-010, F-011) is
documented as fail-closed but actually fails open on Redis trouble — a
direct violation of denial precedence rule #7. Second concerning theme
is empty `.catch(() => undefined)` blocks in the verify hot path
(F-003, F-008) creating exactly the audit-gap scenario SECURITY.md §9
T-5 says we mitigate. Crypto-layer error opacity (F-004, F-005) makes
production incidents hard to triage — a noble lib bug looks identical
to an attack.
