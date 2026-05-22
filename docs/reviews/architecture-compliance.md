# Architecture compliance review
Reviewer: code-reviewer
Date: 2026-05-01
Scope: `apps/api/src/**` + `packages/types/**`

## Per-invariant assessment

### Invariant 1: Private keys never enter OKORO
- Status: PASS
- Evidence:
  - `prisma/schema.prisma` `AgentIdentity` model carries `publicKey` only; no
    private-key column exists anywhere in the schema.
  - `identity.service.ts:16-31` register flow accepts `publicKey` from the DTO
    and persists it; nothing in `identity.dto.ts` exposes a private-key field.
  - All `privateKey` references (`audit.service.ts:36-59`, `policy.module.ts:19-35`,
    `audit-chain.util.ts:86`, `jwt.util.ts:103`, `ed25519.util.ts:16-19,44`) are
    OKORO's own audit/policy signing keys held in env vars or generated locally
    in dev — never agent material.
  - Pino redaction is documented in `SECURITY.md §4.1` (not verified at code
    level here — see Gaps).
- Gaps:
  - `identity.service.ts:17-28` does not validate `dto.publicKey` length/format
    or run a challenge-response handshake (M-003 in `SECURITY.md §4.4` says it
    should). A typo'd or attacker-substituted public key is silently trusted
    today. Not a private-key leak, but it weakens the invariant's intent.
  - Pino redaction list is only referenced in docs; no test asserts it.

### Invariant 2: Portable verify hot path
- Status: PARTIAL
- Evidence:
  - `verify/algorithm/verify.algorithm.ts` is correctly framework-free —
    only imports types from `./verify.ports`. Step ordering matches
    `SECURITY.md §6` denial precedence (see Invariant 6).
  - `verify.service.ts:54-97` is a thin Nest adapter that passes ports into the
    pure algorithm — the architecture you flagged as "in-progress" is in fact
    landed.
- Gaps (other than the verify.service.ts coupling you're already fixing):
  - **`verify.ports.ts:7` imports `TrustBand` from `@prisma/client`.** That
    drags Prisma into the algorithm's type graph and forces any CF Worker
    consumer to also depend on `@prisma/client`. Mirror it as a literal union
    in `packages/types` (it's already a documented enum) and re-export.
  - **`apps/api/src/common/crypto/*` are all `@Injectable()` Nest providers**
    (`audit-chain.util.ts:25,55`, `jwt.util.ts:1,46`, `ed25519.util.ts:1,10`).
    CLAUDE.md §invariant 2 explicitly names `apps/api/src/common/crypto/*` as
    one of the two allowed framework-free locations. Today the algorithm
    receives `verifyJwt` via a port so it works, but the crypto utilities
    themselves cannot be imported by the CF Worker without stripping decorators.
    Recommend: extract the byte-level functions (`verifyAndDecode`, `decodeUnsafe`,
    `canonicalize`, `prevHash`, `sign`/`verify`) into framework-free modules
    and have the Nest classes thin-wrap them.
  - `algorithm/verify.algorithm.ts:148` calls `Date.now()` in the `deny()`
    helper instead of going through `ports.now()`. Minor — breaks the
    test-injectable clock contract.
  - `verify.algorithm.ts:128` mixes `ports.now().getTime()` with the captured
    `startMs`; if a custom clock is supplied the latency math is fine, but the
    `deny()` path bypasses it.

### Invariant 3: Audit log is append-only and signed
- Status: PASS (with one gap)
- Evidence:
  - `prisma/schema.prisma` `AuditEvent` has indexes for read paths but no
    helper service does `update`/`delete` — only `create` (`audit.service.ts:113`).
  - Hash-chain construction in `audit-chain.util.ts:72-92` uses prev-signature
    + canonical-payload Ed25519 signing as documented; `prevHash` enforces
    that both prev-id and prev-sig are set together (line 76).
  - Genesis hash literal `OKORO-AUDIT-GENESIS-v1` (line 74) is stable.
- Gaps:
  - **No DB-level guard against UPDATE/DELETE on `AuditEvent`.** Postgres
    triggers / RLS rules are not in any migration in `apps/api/prisma`. The
    invariant is enforced by code convention only — a future regression or a
    direct admin connection can corrupt the chain silently. Add a
    `BEFORE UPDATE OR DELETE` trigger that raises.
  - `audit.service.ts:78-82` selects "previous event" via `findFirst` ordered
    by `timestamp desc`. Two concurrent appends for the same `agentId` can
    race and chain to the same parent, producing a fork. Needs a serialisable
    transaction or an advisory lock per `agentId`.

### Invariant 4: No silent failures, no fabricated data
- Status: PARTIAL
- Evidence:
  - No `Math.random` anywhere under `apps/api/src` (grep clean).
  - `wellknown.service.ts:59-72` correctly refuses to fabricate `rotatedAt`:
    captures it once at construction and raises `isRotatedAtDegraded()` flag.
  - `verify.service.ts:74-77` `checkSpend` returns `result.allowed` but the
    docblock at lines 49-51 promises "fail-closed on Redis outage." The
    implementation in `spend-guard.service.ts:46-66` actually treats Redis
    nulls (`day ?? 0`, `month ?? 0`) as zero spend → **fail-OPEN** when Redis
    is down or the keys were evicted. This contradicts both the documented
    behaviour and the invariant.
  - `identity.service.ts:25-26` register flow hard-codes `trustScore: 500` and
    `trustBand: 'VERIFIED'` instead of importing `INITIAL_SCORE` /
    `INITIAL_BAND` from `bate.cold-start.ts:21,24`. Constants duplicated; not
    fabricated, but breaks the "constants live in one place" rule and risks
    drift when OD-002 lands.
  - `verify.service.ts:108-114` denial-path audit append uses
    `principalId: result.principalId ?? 'unknown'`, `trustScoreAtEvent: 0`,
    `trustBandAtEvent: 'FLAGGED'`. The string `'unknown'` is a fabricated
    principal id, and the score/band are synthetic placeholders that will be
    indistinguishable from real `FLAGGED` events in audit queries. Either
    make these columns nullable in the schema or carry the real values
    forward from the algorithm output.
- Gaps:
  - Fix spend-guard to fail-closed on Redis miss (or distinguish "no key" from
    "value 0").
  - Replace `'unknown'` principal sentinel with nullable column +
    explicit denial-only event type.
  - `bate.service.ts:38-44` swallows non-uniqueness errors with only a `warn`
    log — acceptable for idempotency, but a true Postgres outage is logged
    and discarded with no surfacing to the verify response. Marginal.

### Invariant 5: Multi-tenant isolation by `principalId`
- Status: PARTIAL
- Evidence:
  - Identity, policy, audit services all take `principalId` first and scope
    every `findFirst`/`findMany` by it (`identity.service.ts:34,42,62`,
    `policy.service.ts:41,107,115,128`, `audit.service.ts:139,211`).
  - `ApiKeyGuard` (`api-key.guard.ts:43-52`) populates `req.auth` and
    controllers consistently use `auth.principalId` rather than path/query.
- Gaps:
  - **`bate.controller.ts:60` accepts a path `:agentId` and calls
    `bate.ingestSignal({ agentId, … })` without verifying that the calling
    principal owns the agent.** Any authenticated API key can submit signals
    against any agent in the system → trust-score manipulation across tenants.
    Critical. Fix: load the agent and assert `agent.principalId === auth.principalId`,
    or rely on a `RelyingParty`-scoped key (the docs imply this endpoint is
    for relying-party keys, but the controller uses the default
    `ApiKeyAuth`/`ApiKeyGuard` and never scopes).
  - **`identity.service.ts:62-66` `publicStatus` is `@Public()`** and queries
    by raw `agentId`. That's intentional per `SECURITY.md §2` (whitelisted
    public endpoint), but it returns `trustScore` + `trustBand`. Confirm
    that's part of the intentional public surface — it is, but worth flagging
    as the sole place principal isolation is lifted.
  - `verify.service.ts:140-143` `loadAgent` and `loadPolicy` (lines 163-167)
    use `findUnique` with no `principalId` scope. Acceptable for the verify
    hot path because verify is a relying-party-scoped operation that
    deliberately spans principals — but worth a comment.

### Invariant 6: Denial precedence is fixed
- Status: PARTIAL
- Documented order (`SECURITY.md §6` and `CLAUDE.md`): `AGENT_NOT_FOUND` →
  `AGENT_REVOKED` → `INVALID_SIGNATURE` → `POLICY_REVOKED` → `POLICY_EXPIRED`
  → `SCOPE_NOT_GRANTED` → `SPEND_LIMIT_EXCEEDED` → `TRUST_SCORE_TOO_LOW` →
  `ANOMALY_FLAGGED`.
- Code order (`verify.algorithm.ts`): step 1 INVALID_SIGNATURE on bad shape
  (line 28) → step 2 AGENT_NOT_FOUND/AGENT_REVOKED (lines 34-35) → step 3
  INVALID_SIGNATURE on real signature check (line 40) → step 4
  POLICY_EXPIRED-if-missing then POLICY_REVOKED then POLICY_EXPIRED
  (lines 44-49) → step 5/6 SCOPE_NOT_GRANTED (57, 66) → step 7
  SPEND_LIMIT_EXCEEDED (74).
- Gaps:
  - **Step 1 returns `INVALID_SIGNATURE` for malformed tokens *before*
    `AGENT_NOT_FOUND` can be evaluated.** A garbage token yields
    `INVALID_SIGNATURE` even though the documented top of the precedence is
    `AGENT_NOT_FOUND`. This is defensible (no agent id is recoverable from a
    malformed token), but the comment on line 25 should be promoted to docs
    so relying parties don't assume `AGENT_NOT_FOUND` always trumps signature
    errors.
  - **`TRUST_SCORE_TOO_LOW` and `ANOMALY_FLAGGED` are not implemented at
    all.** The algorithm reads `trustScore` (line 79) but never compares
    against a relying-party `minTrustScore` from the request, and never reads
    a BATE flag. The DenialReason union in `verify.ports.ts:9-18` lists them
    but they are unreachable. Either implement them or update `SECURITY.md`
    to mark them as Phase 2.
  - Step 4 collapses missing-policy into `POLICY_EXPIRED` (line 45). Defensible
    information-leak choice, but worth an explicit comment in `SECURITY.md §6`.

## Cross-cutting issues

1. **`policy.module.ts:26-28` derives the wrong public key.** When
   `JWT_ED25519_PRIVATE_B64` is set but `JWT_ED25519_PUBLIC_B64` is not, the
   module calls `generateKeypair()` and uses the *new* random keypair's public
   key while keeping the configured private key. The `okoroPublicKeyB64`
   advertised at `/.well-known/...` will not match signatures produced by
   `okoroPrivateKey`. Every signed policy will fail verification. The fix is
   one line: `pubB64 = explicitPubB64 ?? encodeBase64Url(await ed.getPublicKeyAsync(priv))`.
2. **Constants duplicated outside `packages/types`.** `INITIAL_SCORE`,
   `INITIAL_BAND` exist in `bate.cold-start.ts` but are hard-coded in
   `identity.service.ts:25-26`. `SpendLimit` interface declared in three places
   (`spend-guard.service.ts:5`, `verify.ports.ts:109`, and inferred in
   `policy.dto.ts`). Per CLAUDE.md "Constants live in `packages/types`."
3. **No `principalId` on `BateSignal` or `AuditEvent` join enforcement.** The
   schema has the column on `AuditEvent` but no FK to `Principal` (it's a
   denormalised string), and `BateSignal` has no `principalId` at all — only
   via `agentId`. A future cross-tenant query bug here can't be caught by
   simple schema inspection.
4. **No DB triggers enforcing append-only on `AuditEvent`** (see Invariant 3).
5. **`verify.service.ts:108` denial audit fabricates `principalId: 'unknown'`,
   `trustScoreAtEvent: 0`, `trustBandAtEvent: 'FLAGGED'`** — see Invariant 4.
6. **`verify.algorithm.ts:148` `deny()` ignores `ports.now()`** — minor
   determinism hole.

## Top 5 concrete fixes (ranked by leverage)

1. **Fix policy public-key derivation bug** —
   `apps/api/src/modules/policy/policy.module.ts:28`. ~5 LOC, ~30 min, prevents
   every policy verification from failing in any deployment that sets only the
   private-key env var. **Critical correctness.**
2. **Scope `bate.controller.ts` report endpoint by `principalId`** —
   `apps/api/src/modules/bate/bate.controller.ts:60-74`. ~20 LOC (load agent,
   compare principalId, throw 403). Closes a cross-tenant trust-score
   manipulation vector. **Critical security.**
3. **Make `SpendGuardService.check` fail-closed on Redis miss** —
   `apps/api/src/modules/verify/spend-guard.service.ts:46-66`. Distinguish
   `null` (Redis down/key absent) from `0` (genuinely no spend). Backstop to
   `SpendRecord` aggregate before defaulting to zero. ~30 LOC, ~1 h. Aligns
   code with the docblock claim in `verify.service.ts:49-51`. **High.**
4. **Move `TrustBand` (and the rest of the algorithm's types) out of
   `@prisma/client` into `packages/types`** so `verify.ports.ts:7` no longer
   drags Prisma into the portable surface, and refactor
   `apps/api/src/common/crypto/*` to expose framework-free byte-level functions
   that the Nest `@Injectable` wrappers thin-wrap. ~150 LOC, ~3 h. Unblocks
   the CF Worker port (Phase 3) cleanly. **High.**
5. **Add a Postgres `BEFORE UPDATE OR DELETE` trigger on `AuditEvent`** in a
   new Prisma migration + per-`agentId` advisory lock around
   `audit.service.append()` to prevent chain forks under concurrent writes.
   ~40 LOC + migration, ~2 h. Closes Invariant 3 at the storage layer.
   **Medium-high.**
