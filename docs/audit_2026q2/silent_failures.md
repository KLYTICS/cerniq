# OKORO Silent-Failure Audit — 2026Q2

Auditor: error-handling review pass.
Scope: verify hot path, spend guard, audit log, BATE, webhooks, auth, Redis, policy.
Reference invariant: `CLAUDE.md` invariant #4 — no silent failures, no fabricated data; invariant #3 — every audit write goes through `append()` and forms a hash chain.

Severity legend:
- **CRITICAL** — security or audit-invariant violation (SOC2 / fail-closed bypass / fabricated data).
- **HIGH** — correctness defect (revenue, denial precedence, money flow).
- **MEDIUM** — observability gap (failure is logged but not surfaced or routed correctly).
- **LOW** — ergonomics / future-proofing.

---

## Verify-path silent-failure ledger

Every error path on `POST /v1/verify`, in flow order. Each row names the call site, what currently happens on failure, and whether it complies with invariant #4.

| # | Step | Call site (file:line) | Failure behavior today | Verdict |
|---|------|-----------------------|------------------------|---------|
| 1 | Auth: API-key resolve | `auth/api-key.guard.ts:43` → `auth/api-key.service.ts:54-76` | Throws `UnauthorizedException` on missing/unknown. DB outage (`findMany` throws) propagates → 500. Compliant. `lastUsedAt` update is fire-and-forget with `.catch(warn)` (best-effort, OK). | OK |
| 2 | JWT decode (unsafe) | `verify.algorithm.ts:26` | Returns `null` → `INVALID_SIGNATURE` deny. Throw would only occur for non-JWT input handled inside `JwtUtil`. | OK |
| 3 | Agent lookup (cache) | `verify.service.ts:143` → `redis.get` | On Redis outage `redis.get` swallows and returns `null` (`redis.service.ts:48-51`). Falls through to Postgres. | OK (cache best-effort) |
| 4 | Agent lookup (Postgres) | `verify.service.ts:146-149` | `findUnique` throws on Postgres outage → 500 to caller. Compliant — fail-loud. | OK |
| 5 | Agent cache write | `verify.service.ts:160` | `redis.set` swallows; warn-logs and returns. Acceptable for cache. | OK |
| 6 | JWT signature verify | `verify.algorithm.ts:39` (`ports.verifyJwt`) | A `null` return drives `INVALID_SIGNATURE`. If `verifyAndDecode` *throws*, propagates out of the algorithm — uncaught in `verify()` → 500. Acceptable, but inconsistent: callers can't tell if the signature was bad vs the verifier crashed. | LOW (see F-12) |
| 7 | Policy lookup (cache) | `verify.service.ts:166` | Same as #3. | OK |
| 8 | Policy lookup (Postgres) | `verify.service.ts:169-172` | Throws on outage → 500. Compliant. | OK |
| 9 | Policy cache write | `verify.service.ts:182` | Best-effort, OK. | OK |
| 10 | Spend check (read) | `spend-guard.service.ts:46-49` → `redis.get` ×2 | **`redis.get` returns `null` on Redis outage. `null ?? 0` collapses to a "no spend yet" reading. The verify call is then APPROVED past spend caps that the operator believes are enforced.** | **CRITICAL — see F-1** |
| 11 | Spend check (per-tx) | `spend-guard.service.ts:38-40` | Pure compare, fails closed. | OK |
| 12 | Spend record (Redis incr) | `spend-guard.service.ts:95-96` → `redis.incrBy` | **On Redis outage, `incrBy` swallows and returns `0` (`redis.service.ts:89-92`). Counter never increments. Postgres write may still succeed, but the hot-path read in F-1 reads from Redis only. Combined with #10, an outage permanently silences spend enforcement until counters reseed.** | **CRITICAL — see F-2** |
| 13 | Spend record (Postgres) | `spend-guard.service.ts:97-99` (inside `Promise.all`) | If Prisma rejects, `Promise.all` rejects, propagates to `recordSpend`. The verify adapter wraps the whole call in `.catch((err) => logger.error(…))` (`verify.service.ts:81-84`). **The verify response was already returned APPROVED before the durable counter row landed. A failed durable write is logged-and-forgotten — no DLQ, no retry, no audit annotation.** Day/month aggregates drift. | **CRITICAL — see F-3** |
| 14 | Audit append (denied) | `verify.service.ts:107-117` | `.catch(() => undefined)` — empty arrow swallows the error entirely. The denial response goes back to the caller, but the audit chain has a *missing event*. SOC2 invariant #3 violation: denial is unobservable, hash chain has gaps relative to the response stream. | **CRITICAL — see F-4** |
| 15 | Audit append (approved) | `verify.service.ts:85-89` | `.catch((err) => logger.error(…))` — at least logged, but still fire-and-forget. Same SOC2 problem: the response said APPROVED, the chain may not contain the event. Logger-only is not durable. | **CRITICAL — see F-5** |
| 16 | BATE ingest signal | `verify.service.ts:90-94` (algorithm step 9) → `bate.service.ts:26-49` | Outer `.catch(logger.error)` plus inner `try/catch` that warn-logs all but unique-constraint errors. Recompute is also fire-and-forget. Acceptable for behavioral telemetry — but no DLQ means BATE blind spots during Postgres flaps. | MEDIUM — F-6 |
| 17 | touchAgent | `verify.service.ts:95-97` | `.catch(() => undefined)` — empty swallow. Updates `lastSeenAt` and `verifyCount`. Drops on the floor during Postgres flaps. Visible to operator only as missing dashboard data, not an alert. | MEDIUM — F-7 |
| 18 | Metrics emit | `verify.service.ts:125-126` | `Histogram.observe`/`Counter.inc` are non-throwing. OK. | OK |
| 19 | Final response | `verify.service.ts:128-138` | Pure return. OK. | OK |

Hot summary: **5 CRITICAL silent-failure paths on the happy path of `/v1/verify`** (#10, #12, #13, #14, #15).

---

## Findings

### F-1 (CRITICAL) — Spend guard reads Redis-only and fails OPEN on Redis outage

- File: `apps/api/src/modules/verify/spend-guard.service.ts:46-52`
- Swallowing line:
  ```ts
  const [day, month] = await Promise.all([
    this.redis.get<number>(dayCacheKey),
    this.redis.get<number>(monthCacheKey),
  ]);
  const daySpend = day ?? 0;
  const monthSpend = month ?? 0;
  ```
- Why this violates the invariant: `RedisService.get` (`apps/api/src/common/redis/redis.service.ts:48-51`) maps both *miss* and *outage* to `null`. The spend guard then treats `null` as "zero spent so far". Combined with the algorithm's `if (!allowed) DENY` shape (`verify.algorithm.ts:73-75`), a Redis outage means **spend caps disappear** — every approved-otherwise call slips past the cap with `remainingDay = dayCap - 0 - amount`. The header comment on `verify.service.ts:50-53` explicitly promises "Redis outage → spend port returns `false` to fail-closed". The implementation does the opposite.
- Hidden errors caught: connection refused, RESP parse error, Lua-eval timeout, JSON.parse on a stale tampered value — all are indistinguishable from "no spend yet".
- User impact: customer-funded purchases blow through configured `maxPerDay` / `maxPerMonth` ceilings; revenue-policy violation invisible to the relying party; auditor cannot reconstruct why caps were not enforced.
- Recommended fix:
  1. Add `redis.getStrict<T>()` that **throws** on driver/parse error (or expose a `tryGet` that returns a discriminated `{ ok: true, value } | { ok: false, reason }`).
  2. In `SpendGuardService.check`, on outage: either fail-closed by returning `{ allowed: false, remainingDay: 0, remainingMonth: 0, reason: 'SPEND_BACKEND_DEGRADED' }`, or fall back to a Postgres `SUM(amount)` query against `SpendRecord` for the day/month buckets. The fallback path **must** be observable (metric `okoro_spend_fallback_total`).
  3. Document fail-closed behavior in `docs/SECURITY.md` § Spend Enforcement so operators stop seeing it as an outage to suppress.

### F-2 (CRITICAL) — `incrBy` returns `0` on outage; counters can desync silently

- File: `apps/api/src/common/redis/redis.service.ts:89-92`
- Swallowing line:
  ```ts
  } catch (err) {
    this.logger.warn(`redis.incrBy(${key}) failed: ${(err as Error).message}`);
    return 0;
  }
  ```
- Why this violates the invariant: `incrBy` is the *write* counterpart to F-1. Returning `0` means the caller cannot distinguish "counter is now 0 (impossible — we just added a positive `amount`)" from "we failed to record that you spent $X". Today no caller inspects the return value, so the failure is unobservable. After the next process restart / counter rotation, day/month totals will be missing this transaction — caps appear higher than they are.
- Hidden errors caught: `EVAL` script errors, `OOM`, Redis primary failover mid-script, RESP timeout.
- Recommended fix: throw on outage (or return a `Result`). The `recordSpend` Promise.all should fail loud and let the caller decide — caller-side this should mark the verify decision pending in audit metadata, not silently confirm.

### F-3 (CRITICAL) — `recordSpend` is fire-and-forget after the response is sent; no DLQ

- File: `apps/api/src/modules/verify/verify.service.ts:80-84`
- Swallowing lines:
  ```ts
  recordSpend: (agentId, policyId, amount, currency, ctx) => {
    void this.spendGuard
      .recordSpend(agentId, policyId, amount, currency, ctx.merchantId, ctx.merchantDomain)
      .catch((err) => this.logger.error(`recordSpend failed: ${(err as Error).message}`));
  },
  ```
- Why this violates the invariant: by the time `recordSpend` runs, `verifyAlgorithm` already returned `valid: true` to the caller. The relying party charges the customer. If the durable Postgres write inside `recordSpend` (`spend-guard.service.ts:97-99`) fails, the only artifact is a warn line — no retry, no DLQ, no compensating audit entry. Every Postgres flap during peak hours produces missing `SpendRecord` rows that drift indefinitely.
- Hidden errors caught: Prisma serialization error, FK violation (e.g. policy concurrently revoked), unique constraint, transaction deadlock, connection-pool exhaustion.
- Recommended fix:
  1. Move durable counter persistence in front of the response (synchronous), accepting a small latency cost. The Redis counter is the hot read; Postgres is the audit/accounting source.
  2. If keeping fire-and-forget: persist a `SpendRecordPending` row inside the verify transaction; have a BullMQ worker reconcile to `SpendRecord`. DLQ on exhaust.
  3. Surface failure in the audit event payload (`spendRecorded: false`, `pendingId: …`).

### F-4 (CRITICAL) — Denial audit append uses an empty `.catch(() => undefined)`

- File: `apps/api/src/modules/verify/verify.service.ts:107-117`
- Swallowing line: `.catch(() => undefined);`
- Why this violates the invariant: this is the literal pattern called out in the brief. The denial path returns `valid: false` to the caller, but the audit chain may not contain the event. Worse, there is no `logger.error` here — operations get nothing. SOC2 invariant #3 ("every write goes through `append()`") is broken in the most security-relevant case (denials).
- Hidden errors caught: signing-key uninitialised (would throw `Audit signing key not initialised`), Postgres write failure, hash-chain prev-event lookup error.
- Recommended fix:
  1. At minimum log the error (`logger.error('denial audit failed: …')`) — never an empty arrow.
  2. Better: make audit-append synchronous in the denial path. The denial reasons are ones we *want* the auditor to see. Latency is non-critical because the request is already failing.
  3. Best: introduce an `AuditOutbox` table written in the same transaction as the verify decision; a worker drains the outbox to `AuditEvent` so the chain is never out-of-band relative to the decision.

### F-5 (CRITICAL) — Approved-path audit append is also fire-and-forget without durable retry

- File: `apps/api/src/modules/verify/verify.service.ts:85-89`
- Swallowing line: `.catch((err) => this.logger.error(`audit.append failed: ${(err as Error).message}`));`
- Why this violates the invariant: marginal improvement over F-4 (at least logged), but the same architectural defect. Approved verify call returns `valid: true`; downstream relying party transacts; audit chain is missing the event. Auditors performing chain-walk later cannot reconcile relying-party logs against the OKORO chain. Audit-or-bust is a SOC2 invariant.
- Recommended fix: same as F-4 — outbox pattern. As an interim, instrument `okoro_audit_append_failed_total{decision}` and page on it.

### F-6 (MEDIUM) — BATE ingest swallows non-uniqueness errors with `warn`

- File: `apps/api/src/modules/bate/bate.service.ts:38-44`
- Swallowing lines:
  ```ts
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes('Unique constraint')) {
      this.logger.warn(`BATE signal ingest failed: ${msg}`);
    }
  }
  ```
- Why this is a problem:
  - String-match on error messages is fragile (Prisma changes the wording across versions; locale changes break it).
  - All non-unique errors collapse to a `warn` — FK violations, Postgres outages, payload-too-large all look the same. Trust score becomes blind to whatever class of signals consistently fails.
  - The outer caller (`verify.service.ts:90-94`) already wraps this in `.catch(logger.error)`, so the inner swallow is redundant *and* less informative.
- Hidden errors caught: connection pool exhaustion, JSON column oversize, schema drift, `agentId` FK missing (a real bug).
- Recommended fix:
  1. Detect uniqueness via `Prisma.PrismaClientKnownRequestError` with `err.code === 'P2002'`, not by string-matching.
  2. Re-throw everything else; let the outer fire-and-forget `.catch` log it. One owner per error.

### F-7 (MEDIUM) — `touchAgent` fire-and-forget with empty `.catch`

- File: `apps/api/src/modules/verify/verify.service.ts:95-97`
- Swallowing line: `void this.touchAgent(agentId).catch(() => undefined);`
- Why: empty catch hides Postgres outages, advisory-lock failures on `verifyCount` increment, unique-key violations, etc. Dashboards lose `lastSeenAt` and `verifyCount` data with no signal to operators.
- Recommended fix: at minimum `.catch((err) => this.logger.warn(…))`. Better: emit a counter `okoro_touch_agent_failed_total`.

### F-8 (HIGH) — `WebhooksService.enqueue` swallows persistence failures

- File: `apps/api/src/modules/webhooks/webhooks.service.ts:53-75`
- Swallowing line: `} catch (err) { this.logger.error(…); }`
- Why this is a problem: the catch wraps both (a) the lookup of subscriptions and (b) the `$transaction` that creates `WebhookDelivery` rows and (c) the BullMQ enqueue. If Postgres rejects the transaction, the caller (verify, BATE recompute, identity revoke, etc.) sees success. The webhook event vanishes — no DLQ, no replay queue, no follow-up. Subscribers never learn an event happened.
- Hidden errors caught: Postgres outage, BullMQ Redis outage (Redis disconnect raises), JSON serialization (non-cloneable payload), foreign-key issue (subscription deleted concurrently).
- Recommended fix:
  1. Persist a `WebhookOutbox` row in the same transaction that creates the originating event (the verify/bate write). Have an async drainer move outbox rows into `WebhookDelivery` and BullMQ. That way a failed enqueue cannot disappear an event.
  2. If keeping the current shape: at least classify the error and re-throw on persistence failure. Logger-only deletes the event.
  3. Add metric `okoro_webhook_enqueue_failed_total{event}` and an alert.

### F-9 (MEDIUM) — Webhook `markAbandoned` from `'failed'` listener silently ignores its own failure

- File: `apps/api/src/modules/webhooks/webhook.delivery.ts:71-73`
- Swallowing line: `void this.markAbandoned(job.data.deliveryId, err?.message ?? 'max attempts').catch(() => undefined);`
- Why this is a problem: this is the only place where a delivery is *finalized* into the ABANDONED terminal state and a true DLQ notification could fire. If the Postgres update fails, the row is stuck in PENDING with `attemptsMade >= MAX_ATTEMPTS` forever. No alert, no operator visibility. Ironic given this is the "DLQ horizon" code path.
- Recommended fix:
  1. Replace empty catch with structured log + `okoro_webhook_abandon_failed_total` counter.
  2. Add a periodic reconcile worker that scans `WebhookDelivery WHERE attempts >= MAX_ATTEMPTS AND status = 'PENDING'` and re-issues `markAbandoned`.
  3. Optional: emit a `webhook.abandoned` internal event so operators can subscribe to their own DLQ.

### F-10 (MEDIUM) — `redis.del` swallows in cache-invalidation paths that have correctness implications

- Call sites:
  - `apps/api/src/modules/policy/policy.service.ts:123` — after `policy revoke`.
  - `apps/api/src/modules/bate/bate.service.ts:84` — after a trust-score recompute.
  - `apps/api/src/modules/identity/identity.service.ts:54` — after agent state change.
- Swallowing line: `apps/api/src/common/redis/redis.service.ts:71-73`
  ```ts
  } catch (err) {
    this.logger.warn(`redis.del failed: ${(err as Error).message}`);
  }
  ```
- Why this is more than "best-effort": the caches `policy:<id>`, `agent:status:<id>`, `agent:public-status:<id>` are read on the verify hot path with up to 60s TTL (`verify.service.ts:160`, `:182`). If invalidation silently fails after `policy.revoke`, the verify path will continue approving against the cached `status: 'ACTIVE'` policy for up to 60 seconds. That violates the denial-precedence guarantee that `POLICY_REVOKED` wins immediately after revocation.
- Recommended fix:
  1. The `del` after a state-change must be best-effort + retry: enqueue an "invalidate" job to BullMQ on first failure; do not return success to the API caller until at least one of (a) Redis confirmed deletion or (b) the queue accepted the retry.
  2. Or, push down to a per-key versioning approach: each cached entry carries an `invalidatedAtBefore` timestamp; cache reads compare against a small Redis tombstone. This way a missed `del` is auto-corrected on the next read.

### F-11 (HIGH) — Cache reads on the verify path have no explicit "stale" detection

- File: `apps/api/src/modules/verify/verify.service.ts:141-184`
- Why: when `redis.get` returns the cached agent/policy snapshot, there is no check that the snapshot was written before the most recent invalidation. Combined with F-10, a stale `status: 'ACTIVE'` agent or policy can serve verifies for the full TTL window. Not strictly a "silent failure" of an error path, but it converts a Redis outage during invalidation into an unbounded data-staleness window the caller cannot detect.
- Recommended fix: as in F-10 — version cache entries against a tombstone, or carry a monotonic `revision` from the Postgres source row and compare on read.

### F-12 (LOW) — Inconsistent throw-vs-null contract between `verifyJwt` and `decodeJwtUnsafe`

- File: `apps/api/src/modules/verify/algorithm/verify.algorithm.ts:26,39`
- Why: `decodeJwtUnsafe` is documented to return `null` on malformed input; `verifyJwt` is documented to return `null` on a bad signature. If the underlying `JwtUtil` throws (key parsing exception, jose internal error), the algorithm bubbles → uncaught in the Nest adapter → 500. This means a malformed-but-signed token vs a runtime JWT-library bug are distinguishable to the operator only via 4xx vs 5xx — but to the caller they look identical.
- Recommended fix: in the Nest adapter `verify()`, wrap `verifyAlgorithm` in `try/catch`. On a *runtime* exception, return a 503 with `okoro_verify_runtime_errors_total` incremented and an audit row written with `decision='ERROR'`. Today the algorithm has no `ERROR` decision — that is a gap.

### F-13 (LOW) — Audit `signature` and `prevEventId` chain construction is *not* in a Postgres transaction

- File: `apps/api/src/modules/audit/audit.service.ts:75-136`
- Why this is worth flagging: the `findFirst` for the previous event (`:78-82`) and the `create` (`:113-131`) are two separate round-trips. Under concurrent appends for the same `agentId`, two callers can see the same `prev`, sign over the same prev_sig, and create two siblings claiming to follow the same parent. The chain becomes a tree, not a chain — verifiers will reject one branch as invalid. There is no error here yet, but when concurrency rises it presents as silent chain divergence.
- Recommended fix: either a Postgres advisory lock keyed on `agentId`, or a unique constraint on `(agentId, prevEventId)` so the second writer fails loud, or move chain-tip tracking into a per-agent counter row updated with `SELECT … FOR UPDATE`.

### F-14 (MEDIUM) — `bate.recompute` no-op return on `agent === null` is silent

- File: `apps/api/src/modules/bate/bate.service.ts:52-56`
- Swallowing line: `if (!agent) return;`
- Why: if a signal references an agent that no longer exists, the function silently exits. That is sometimes correct (concurrent deletion) but also masks the case where the signal payload had a typo or stale id. No counter, no log.
- Recommended fix: `logger.warn` with `agentId`, increment `okoro_bate_recompute_orphan_signal_total`. Lets the operator see drift.

### F-15 (LOW) — `recompute` early-exit when `score === currentScore` swallows a recompute failure window

- File: `apps/api/src/modules/bate/bate.service.ts:72`
- Swallowing line: `if (score === agent.trustScore) return; // no-op`
- Why this is sometimes wrong: skipping the transaction means `lastScoredAt` does not advance. After a degraded period (signals lost, restored, recomputed with same score), the operator cannot distinguish "we recomputed and confirmed no change" from "we never ran". Today this is purely an observability gap.
- Recommended fix: still bump `lastScoredAt` even when `score` is unchanged, or write a `TrustScoreHistory(reason='recompute_noop')` row.

### F-16 (LOW) — `apiKey.lastUsedAt` update fire-and-forget

- File: `apps/api/src/modules/auth/api-key.service.ts:69-71`
- Swallowing line: `.catch((err) => this.logger.warn(`apiKey lastUsedAt update failed: ${err.message}`));`
- Why: legitimate fire-and-forget. Worth noting that *security* teams sometimes rely on `lastUsedAt` to detect stolen credentials. If Postgres flaps, `lastUsedAt` stays frozen and a credential-leak detection rule based on staleness gets confused. Not a defect today; flagging for the rotation/leak-detection feature later.
- Recommended fix: emit `okoro_apikey_lastused_failed_total` counter so this is visible to security monitoring.

### F-17 (MEDIUM) — `AuditService.initSigningKey` ephemeral fallback in non-production

- File: `apps/api/src/modules/audit/audit.service.ts:55-62`
- Why: production correctly throws on missing keys. **Non-production** generates an ephemeral key with a `warn` line. Acceptable for dev — but staging environments often run `nodeEnv !== 'production'` and end up with chains signed by a key nobody else can verify. When QA replays prod audit-export tooling against staging, the chain fails verification with no clear pointer to the ephemeral-key path.
- Recommended fix: require explicit opt-in via `ALLOW_EPHEMERAL_AUDIT_KEY=1`. Default to fail-loud everywhere except local dev.

### F-18 (LOW) — `WebhookDeliveryWorker.enqueue` returns `undefined` when webhooks disabled

- File: `apps/api/src/modules/webhooks/webhook.delivery.ts:86-87`
- Swallowing line: `if (!this.queue) return undefined;`
- Why: `WebhooksService.enqueue` (`webhooks.service.ts:71`) will then `Promise.all` over `undefined` job ids without complaint. The caller cannot distinguish "webhooks intentionally disabled" from "queue failed to init". The originating verify call will return APPROVED while the operator believes webhooks are off but they are actually crashed.
- Recommended fix: throw a typed `WebhooksDisabledError` (caller catches + treats as "not enabled, not an error"); a separate `WebhooksUnavailableError` if `connection`/`queue` is in a bad state. Two states, two outcomes.

---

## Summary table (machine-readable)

| Finding | Severity | File | Line | Pattern |
|---------|----------|------|------|---------|
| F-1 | CRITICAL | `apps/api/src/modules/verify/spend-guard.service.ts` | 51-52 | `null ?? 0` collapses outage to "no spend" |
| F-2 | CRITICAL | `apps/api/src/common/redis/redis.service.ts` | 89-92 | `incrBy` returns `0` on failure |
| F-3 | CRITICAL | `apps/api/src/modules/verify/verify.service.ts` | 81-84 | `recordSpend` fire-and-forget, no DLQ |
| F-4 | CRITICAL | `apps/api/src/modules/verify/verify.service.ts` | 117 | `.catch(() => undefined)` on denial audit |
| F-5 | CRITICAL | `apps/api/src/modules/verify/verify.service.ts` | 85-89 | approved-audit fire-and-forget, no outbox |
| F-6 | MEDIUM | `apps/api/src/modules/bate/bate.service.ts` | 38-44 | string-match swallow on bate ingest |
| F-7 | MEDIUM | `apps/api/src/modules/verify/verify.service.ts` | 96 | `touchAgent.catch(() => undefined)` |
| F-8 | HIGH | `apps/api/src/modules/webhooks/webhooks.service.ts` | 72-74 | enqueue catch swallows persistence failure |
| F-9 | MEDIUM | `apps/api/src/modules/webhooks/webhook.delivery.ts` | 72 | `markAbandoned.catch(() => undefined)` |
| F-10 | MEDIUM | `apps/api/src/common/redis/redis.service.ts` | 71-73 | `del` swallow undermines invalidation |
| F-11 | HIGH | `apps/api/src/modules/verify/verify.service.ts` | 141-184 | no stale-cache detection |
| F-12 | LOW | `apps/api/src/modules/verify/algorithm/verify.algorithm.ts` | 26,39 | inconsistent throw-vs-null |
| F-13 | LOW | `apps/api/src/modules/audit/audit.service.ts` | 78-131 | append not transactional → chain branching |
| F-14 | MEDIUM | `apps/api/src/modules/bate/bate.service.ts` | 56 | silent no-op on missing agent |
| F-15 | LOW | `apps/api/src/modules/bate/bate.service.ts` | 72 | skipped recompute swallows observability |
| F-16 | LOW | `apps/api/src/modules/auth/api-key.service.ts` | 69-71 | `lastUsedAt` warn-and-forget |
| F-17 | MEDIUM | `apps/api/src/modules/audit/audit.service.ts` | 55-62 | ephemeral key fallback in non-prod |
| F-18 | LOW | `apps/api/src/modules/webhooks/webhook.delivery.ts` | 87 | `enqueue` returns `undefined` on init failure |

---

## Per-call-site evaluation of `redis.*` "best-effort" contract

The brief asks whether each call site of `redis.get/set/del/incrBy` is OK with the swallowing contract.

| Call site | Method | OK with swallow? | Reasoning |
|-----------|--------|------------------|-----------|
| `verify.service.ts:143` (agent cache read) | `get` | YES | Postgres fallback follows. |
| `verify.service.ts:160` (agent cache write) | `set` | YES | Pure cache-population; next call refills. |
| `verify.service.ts:166` (policy cache read) | `get` | YES | Postgres fallback follows. |
| `verify.service.ts:182` (policy cache write) | `set` | YES | Pure cache-population. |
| `verify.service.ts:188` (lastseen read) | `get` | YES | Tolerates double-write to Postgres. |
| `verify.service.ts:190` (lastseen write) | `set` | YES | Best-effort dedupe. |
| `spend-guard.service.ts:47-48` (spend read) | `get` | **NO** (F-1) | Outage masquerades as zero spend → fail-open. |
| `spend-guard.service.ts:95-96` (spend incr) | `incrBy` | **NO** (F-2) | Return-`0` is fabricated data; counter desyncs. |
| `identity.service.ts:54` (status invalidate) | `del` | **NO** (F-10) | Stale cache continues serving revoked agents. |
| `identity.service.ts:59` (public status read) | `get` | YES | Postgres fallback follows. |
| `identity.service.ts:75` (public status write) | `set` | YES | Pure cache-population. |
| `bate.service.ts:84` (post-recompute invalidate) | `del` | **NO** (F-10) | Stale trust score served until TTL. |
| `policy.service.ts:123` (post-revoke invalidate) | `del` | **NO** (F-10) | Revoked policy continues approving. |

Two of three `del` call sites and both `spend-guard` call sites are not OK with the current contract. They need either strict variants (`getStrict`, `delStrict`, `incrByStrict` that throw) or compensating retry mechanisms (BullMQ invalidation queue, durable spend outbox).

---

## Top-3 recommended fixes (operator priority)

1. **Spend fail-closed** (F-1, F-2, F-3). Add `redis.getStrict` / `redis.incrByStrict` and rewire `SpendGuardService` to fail closed on backend errors. Move `recordSpend` durable write into an outbox so a Postgres flap during a high-traffic verify cannot vanish a spent transaction.
2. **Audit outbox** (F-4, F-5). Replace the two `.catch(() => undefined)` / `.catch(logger.error)` audit appends with a transactional outbox row written alongside the verify decision; a worker drains outbox → `AuditEvent`. Audit-or-bust becomes structurally true.
3. **Webhook outbox + DLQ visibility** (F-8, F-9). Persist outbox row inside the originating transaction; surface `markAbandoned` failures via metric + reconcile worker so DLQ events cannot vanish.

---

*End of audit. No source files were modified.*
