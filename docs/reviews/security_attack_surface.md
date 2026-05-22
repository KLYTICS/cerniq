# Security attack surface — round 3 review
Reviewer: red-team lead (FAANG sec org, external)
Date: 2026-05-02

> Audit basis: full diff vs. `docs/reviews/SYNTHESIS.md` (sid=a9198691) and
> `docs/audit_2026q2/FINDINGS_SUMMARY.md`. Only NEW issues — items already
> tracked there are NOT re-listed unless I found a deeper concrete attack.
>
> Coverage: OWASP API Top 10 (2023), supply chain (pnpm-lock + dep tree),
> secret lifecycle, side channels, multi-tenant isolation, audit-chain
> corner cases, webhook receiver attacks, rate-limiting, DoS, Helmet/CSP.

---

## CRITICAL (immediate fix required)

### S-1 — JWT accepts tokens with no `exp` claim → infinite-lifetime token forgery once any signature is captured
- File: `apps/api/src/common/crypto/jwt.util.ts:75`
- Code: `if (claims.exp && claims.exp < now) return null;`
- Attack:
  1. SDK or any signer emits a JWT *without* an `exp` claim (e.g. a buggy
     custom client, or an attacker who controls the signer because they
     hold the agent private key transiently — a fired contractor scenario).
     Because the check is gated on `claims.exp` truthiness, a missing /
     `0` / `null` `exp` short-circuits past the expiry test entirely.
  2. The token then proceeds to step 3.5 in `verify.algorithm.ts:70`:
     `Math.max(1, claims.exp - Math.floor(startMs / 1000))`. With
     `claims.exp === undefined` this is `Math.max(1, NaN) === NaN`, then
     `Math.min(90, NaN) === NaN`, then `consumeJti(jti, NaN)`. ioredis
     throws `ERR value is not an integer` on `SET … EX NaN`, the algorithm
     catches that as `ANOMALY_FLAGGED`, and the token is *denied for the
     wrong reason* — but worse, future requests with the same token also
     deny as ANOMALY_FLAGGED, masking the underlying replay window.
  3. Variant: `exp = 0` passes (`0 && …` short-circuits). Then
     `claims.exp - now` is large-negative; `Math.max(1, negative) === 1`;
     replay cache holds for 1 sec; token is approvable in a tight loop
     for the lifetime of the captured Ed25519 signature (effectively
     forever — there is no other expiry check).
- Impact: Any captured/stolen agent JWT is replayable indefinitely as
  long as the agent identity remains ACTIVE. Defeats the entire purpose
  of `replay-cache.service.ts`. SOC2 audit chain still records the
  approvals so you'd see them eventually, but per-decision liability is
  attached to the agent, not the attacker.
- Fix:
  ```ts
  if (typeof claims.exp !== 'number' || claims.exp < now) return null;
  if (typeof claims.iat !== 'number' || claims.iat > now + 60) return null; // anti-clock-skew
  if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) return null;     // belt-and-braces
  ```
  Also add a NaN guard at `verify.algorithm.ts:70`:
  `if (!Number.isFinite(remainingTtl) || remainingTtl <= 0) return await deny(... 'INVALID_SIGNATURE' ...);`

### S-2 — `IdentityService.register` accepts any public key with no proof-of-possession → identity hijack
- File: `apps/api/src/modules/identity/identity.service.ts:16-31` + `apps/api/src/modules/identity/identity.dto.ts:14-17`
- Attack:
  1. Attacker holding any FREE-tier API key calls
     `POST /v1/agents/register` with `publicKey = <victim_agent_public_key_bytes>`.
     The system happily creates a *second* AgentIdentity row owned by the
     attacker's principal, with the victim's public key.
  2. The attacker now has an agent ID under their control whose verify
     responses include `principalId: <attacker_principal>`. They issue
     a policy under their principal (`policy.controller.create`), receive
     an OKORO-signed policy token, and now any signature the victim
     emits — *captured from any public log, audit export, or
     observation* — will verify under attacker's agentId/principalId
     because the JWT `sub` field controls agent lookup but the only
     cryptographic gate is "does this signature verify against the
     stored public key", and now both rows have the same key.
  3. Variant — victim is also affected by *spend-limit pollution*: the
     attacker's agent shares no spend record, but trust-score
     manipulation is now a vector. Filing
     `RELYING_PARTY_FRAUD_REPORT` against the attacker's clone agent
     burns trust-score on the clone, but the dashboard shows two
     "agents" with the same public key — no UI affordance flags this.
  4. Worse: Postgres has NO uniqueness constraint on `AgentIdentity.publicKey`
     (verified: `prisma/schema.prisma:69-104` — index on `principalId`,
     `status`, `trustScore`, but `publicKey` is a free-form String).
- Impact: Identity-confusion attack. Breaks CLAUDE.md invariant #1 in
  spirit — we hold "only public keys" but we hold *unverified* public
  keys, which is operationally indistinguishable from holding a victim's
  identity for relying-party-confusion purposes.
- Fix: Two-step registration.
  1. `POST /v1/agents/register` → server returns `{ challenge: <random nonce>, registrationId }`,
     row is `PENDING_VERIFICATION` with no usable agentId.
  2. `POST /v1/agents/register/:registrationId/verify` with
     `signature = ed25519.sign(privKey, challenge)`. Server verifies
     with the supplied public key, marks row ACTIVE.
  Plus: `@@unique([publicKey])` on `AgentIdentity` (or composite
  `[publicKey, principalId]` if multi-row is intentional, with explicit
  cross-tenant rejection).

### S-3 — GDPR Art. 17 redaction is structurally broken — every redact attempt will throw P0001
- File: `apps/api/src/modules/audit/audit.service.ts:400` (`prisma.auditEvent.update`) + `apps/api/prisma/migrations/20260502000100_audit_append_only/migration.sql`
- Attack: Not directly an attacker exploit, but an integrity / regulatory
  catastrophe. The append-only trigger added 2026-05-02 fires
  `BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW`. The
  application connects under a normal DB role with no special bypass.
  Any GDPR Article 17 erasure request lands at `audit.service.redact()`,
  which calls `prisma.auditEvent.update(...)` to null out raw fields →
  trigger raises `'AuditEvent is append-only — UPDATE/DELETE is forbidden'`
  → user sees a 500. OKORO is now **incapable of complying with EU
  Article 17** while the trigger is in place. The "bypass procedure"
  documented in the migration comment requires a human to
  `DISABLE TRIGGER` from a privileged role and re-enable — not
  programmatic.
- Impact: First erasure request from an EU principal = open ticket with
  the supervisory authority. Doc/EU_RESIDENCY.md promises redactability;
  this contradicts it.
- Fix options:
  1. Drop the trigger and rely on application-layer guard (worse —
     loses the defense the trigger was added for).
  2. Use a stored-procedure-based redaction path. `redact()` calls
     `SELECT redact_audit_event($1, $2, …)` which executes
     `ALTER TABLE … DISABLE TRIGGER` → `UPDATE` → `ENABLE TRIGGER` in
     a single security-definer function owned by the schema owner.
     Application role gets EXECUTE on the function, no direct UPDATE
     grant.
  3. Schema change: add a partial trigger
     `WHEN (OLD.redactedAt IS NOT NULL OR NEW.redactedAt IS DISTINCT FROM OLD.redactedAt = false)`
     so updates that *only* set `redactedAt`/`action`/`relyingParty`/
     `requestedAmount`/`policySnapshot` to null are allowed. Verify
     hash columns + `okoroSignature` are unchanged in the trigger.
  Option 3 is the smallest blast radius — recommended.

### S-4 — Audit-chain key rotation has no cross-key verifiability path → silent re-key breaks all historical audit verification
- File: `apps/api/src/modules/wellknown/wellknown.service.ts:34-74` + `apps/api/src/modules/audit/audit.service.ts:53-69`
- Attack: An attacker with control of the deploy pipeline (compromised
  Railway service token, malicious insider, supply-chain hit on the
  CI image) rotates `OKORO_SIGNING_PRIVATE_KEY` and
  `OKORO_SIGNING_PUBLIC_KEY`. The well-known JWKS endpoint serves the
  *new* key under the same `kid` namespace (kid = sha256(key)[:16] is
  bound to the key, but only the current kid is published — no
  historical kid set). Auditors fetching `/.well-known/jwks.json`
  *today* receive only the current key; audit events signed by the
  *previous* key fail signature verification. The attacker can:
  1. Burn the entire historical audit chain (turning audits into
     "unverifiable, please trust us") because there is no signed
     attestation linking old kid → new kid.
  2. Forge new "historical" events under the new key, since the chain
     verifier has no anchor to the *previous* genesis-kid.
- Impact: Loses the SOC2 / FINRA evidentiary value of the chain at the
  moment of rotation. CLAUDE.md invariant #3 is "append-only and signed";
  silently dropping old signatures is functionally equivalent to a
  rewrite from the auditor's perspective.
- Fix:
  1. JWKS must publish *all* historical kids the system has ever signed
     under, with `rotatedAt` per kid. Schema: a small
     `AuditSigningKey { kid PK, publicKeyB64 unique, activeFrom, retiredAt }`
     table; `wellknown.service.ts` reads all rows where
     `retiredAt IS NULL OR retiredAt > NOW() - 7y` (audit-retention
     horizon).
  2. Each rotation appends an `audit.signing-key.rotate` event signed
     by *both* the outgoing and incoming key, anchoring the kid
     transition into the chain itself.
  3. `audit-chain.util.verify()` should be parameterized by the kid
     selected from `payload` (currently the chain payload v2 has no
     `kid` field — *add one* in v3, default v2 verifies against
     historical keys via signature trial).

---

## HIGH

### S-5 — Rate-limiting is per-edge-IP because Express `trust proxy` is not set behind Railway/Cloudflare
- File: `apps/api/src/main.ts:11-23` (no `app.set('trust proxy', …)`) + `apps/api/src/app.module.ts:55-62` (default ThrottlerGuard tracker is `req.ip`)
- Attack:
  1. OKORO deploys behind Railway → Cloudflare. `req.ip` is the *edge
     IP*, not the originating client. The `default` throttler (limit
     120/min) applies a *single* counter for **all traffic from a given
     edge node**.
  2. Two distinct attacks:
     a. *Single-attacker DoS via shared throttle bucket*: one attacker
        bursts 120 req/min from an EC2 IP behind same Cloudflare
        region; legitimate customers in the same region are now
        throttled because their IP hashes to the same Cloudflare edge.
     b. *Per-IP enumeration is impossible*: there is no way to flag a
        single attacker because the throttler can't distinguish them.
  3. The `verify` throttler at 1000/min has the same problem and is
     even more exposed because verify is the highest-volume endpoint.
- Impact: Both DoS amplifier and absent attacker-fingerprinting. With a
  small key population (early launch), one bad actor can block all
  verification traffic from their region.
- Fix:
  ```ts
  // main.ts
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', /* Cloudflare hop count */ 2);
  ```
  Plus: customize throttler tracker to `req.headers['x-okoro-api-key'] ?? req.ip`
  so authenticated traffic gets per-key buckets, anonymous traffic
  gets per-real-IP buckets. Currently per-key throttling is implicit
  (one bucket per IP that happens to hold a key) → not what was
  intended.

### S-6 — `JwtUtil.decodeUnsafe` is called twice on the deny path → double-parse oracle + missing depth limit
- File: `apps/api/src/common/crypto/jwt.util.ts:89-98` + `apps/api/src/modules/verify/algorithm/verify.algorithm.ts:33,217`
- Attack:
  1. The verify algorithm calls `decodeJwtUnsafe(input.token)` at
     entry (line 33) AND again inside `deny()` at line 217 to extract
     `claimedAgentId`. Each call does a base64url decode + JSON.parse.
     A malicious token `{"sub":"a","jti":"b","exp":99999999999,"x":<deeply nested>}`
     up to 2048 chars (the DTO MaxLength) can carry a JSON payload of
     ~1.5 KB after base64url. JSON.parse has no depth limit. Two parses
     per request = 2× CPU per malicious verify.
  2. With 1000/min throttle and per-edge bucket (S-5), an attacker can
     sustain ~17 malicious-deny req/sec and still appear "legitimate"
     to throttler, doubling the per-request CPU cost.
  3. Independent issue: `JwtUtil.decodeUnsafe` is logged in `verify.service.ts:128`
     as `denialReason`. A token whose `sub` is `<script>alert(1)</script>`
     could be reflected into log dashboards (Pino → ELK / Grafana
     panels) as XSS if any panel renders log values without escaping
     — verify-step log contains `agentId=${result.agentId ?? 'n/a'}`
     where `result.agentId` is the attacker-controlled `claims.sub`.
- Impact: 2× CPU cost on DoS + log-injection vector for downstream log
  viewers.
- Fix:
  - Pass the already-decoded provisional claims into `deny()` instead
    of re-decoding (one-line refactor).
  - Validate `claims.sub` and `claims.jti` shapes (regex: ULID-like or
    `agt_…`) before logging or persisting them.
  - Add a small JSON depth-limit decoder for the unsafe-decode path
    (or just `JSON.parse` with a max-string length precheck).

### S-7 — `JSON.stringify` of webhook payload reveals secrets via response-body echo on misbehaving receiver
- File: `apps/api/src/modules/webhooks/webhook.delivery.ts:128,151`
- Attack:
  1. The body sent to a webhook is `JSON.stringify({ id, event, data: delivery.payload, ts })`.
     `delivery.payload` is whatever the producing module passed in
     (currently includes BATE signal payloads, audit events, possibly
     `evidence` from `BateController.report()` which has no field-level
     redaction).
  2. The receiver's response body (up to 2048 chars of it) is persisted
     in `WebhookDelivery.responseBody` (`webhook.delivery.ts:151,193`).
     A hostile receiver can echo back the request body in their
     response — now OKORO persists the customer's raw evidence payload
     in the database under the receiver's audit row, which the
     receiver-owner can later read via the dashboard's
     `webhooks/:id/deliveries` endpoint (if/when it ships).
  3. More subtle: `responseBody` is a `String @db.Text` column with no
     PII redaction policy. GDPR Art. 17 erasure on the customer-side
     `BateSignal.payload` won't propagate to delivery records.
- Impact: Indirect data egress + GDPR-redaction gap on webhook delivery
  records.
- Fix:
  - Strip / hash any `evidence` / `payload` fields before they enter
    the webhook envelope. Webhook receivers should get *event
    metadata* (id, type, agentId, timestamp) and a back-link, not raw
    customer payload.
  - Or: enforce that `responseBody` never echoes request body — easy
    server-side check (`if (responseBody.includes(body.slice(0,80))) responseBody = '<truncated: echo detected>'`).
  - Schedule periodic GDPR-erasure cascade from `BateSignal` /
    `AuditEvent` to `WebhookDelivery.responseBody`.

### S-8 — `WebhookDeliveryWorker.process` does not re-run SSRF guard on HTTP redirects → DNS-rebinding still possible
- File: `apps/api/src/modules/webhooks/webhook.delivery.ts:138-149`
- Attack:
  1. Customer registers webhook URL `https://attacker.example.com/redirect`.
     SSRF guard runs on registration target → resolves to public IP
     1.2.3.4 → approved.
  2. OKORO POSTs the body with HMAC signature in the headers. The
     receiver responds `302 Location: http://169.254.169.254/latest/meta-data/`.
  3. Node's `fetch()` defaults to `redirect: 'follow'`. The SSRF guard
     comment (`ssrf-guard.ts:14-21`) explicitly says *"caller follows
     redirects manually, re-running this guard on each hop"* — but
     the implementation in `webhook.delivery.ts:138-149` does NOT pass
     `redirect: 'manual'`. So Node follows the 302 → fetches AWS IMDS
     (or GCP / Azure metadata) → **OKORO now sends the HMAC-signed
     payload to internal metadata endpoints**, and the response
     (which contains IAM credentials on AWS) is persisted in
     `responseBody` (truncated to 2048 chars — but IMDS role
     credentials fit easily).
- Impact: SSRF re-emerges via redirect, AND the HMAC-signed body could
  be replayed against an internal endpoint that trusts the OKORO
  signing key (unlikely but possible in a customer environment that
  shares the secret with internal services).
- Fix:
  ```ts
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',  // ← critical
    signal: ctrl.signal,
    headers: …,
    body,
  });
  if (res.status >= 300 && res.status < 400) {
    // Manually follow up to N hops, re-running checkSsrf() on each.
    // Or just refuse — webhook receivers should not redirect.
  }
  ```

### S-9 — `redis.incrBy` Lua script uses INCRBYFLOAT which silently loses precision → spend cap evasion
- File: `apps/api/src/common/redis/redis.service.ts:80-92`
- Attack:
  1. `INCRBYFLOAT` in Redis stores values as text and is subject to
     binary-float rounding. `recordSpend(amount=999_999_999.99)` then
     subsequent `recordSpend(0.01)` may yield `999999999.99` (rounded)
     instead of `1_000_000_000.00`. Over thousands of small
     transactions the drift can be *negative*, allowing a clever
     attacker to fit slightly more spend than the policy allows under
     a given cap.
  2. More concretely: `Number.parseFloat(reply)` in `redis.service.ts:88`
     re-introduces JS-float quantisation. Two-cent transactions can
     drift over time.
  3. Even more concretely: if Redis returns `nil` (key didn't exist
     and EVAL didn't create it for some reason — e.g. cluster slot
     migration in progress), `parseFloat(undefined)` = NaN. The
     fallback in the catch returns 0 silently — *but* a successful
     EVAL that returns `nil` does NOT throw, so we silently treat
     "couldn't increment" as "incremented to 0". Attacker spend isn't
     persisted; spend cap effectively disabled for that window.
- Impact: Spend cap evasion (high $-value attacks).
- Fix:
  - Persist amounts in *minor units* (cents/satoshi) as integers and
    use `INCRBY` (integer) instead of `INCRBYFLOAT`.
  - Verify the `EVAL` reply is a non-empty string before
    `parseFloat`; on `null/undefined` throw rather than return 0.
  - Spend cap math in `spend-guard.service.ts` should use a Decimal
    library or BigInt — `Number(dayAgg._sum.amount ?? 0)` (line 101)
    converts a Prisma `Decimal` to JS `number`, losing precision past
    2^53.

### S-10 — Audit redact lets a principal redact rows whose `principalId` was set to the *relying party* on AGENT_NOT_FOUND denials → cross-tenant data deletion
- File: `apps/api/src/modules/audit/audit.service.ts:367-417` + `apps/api/src/modules/verify/algorithm/verify.algorithm.ts:46,225`
- Attack:
  1. New verify algorithm correctly attributes AGENT_NOT_FOUND
     denials to the *relying party's principal* (per CRIT-5 fix).
     But this means the relying party can call
     `POST /v1/agents/:agentId/audit/.../redact` (or whichever the
     redact route is) targeting an event whose `agentId` is the
     attacker-controlled `claimedAgentId`. The ownership check in
     `redact()` is `where: { id: eventId, principalId }` — the
     relying party's principalId matches the audit row, so they pass.
  2. The relying party can now redact `relyingParty`, `requestedAmount`,
     `policySnapshot` from those rows — destroying forensic evidence
     about which agent IDs they probed and which amounts they
     attempted. Self-cleansing forensic trail for credential-stuffing.
- Impact: An RP can erase their own probing history, defeating SOC2
  evidence collection.
- Fix:
  - Add a `recordType` column (`AGENT_VERIFY` | `RP_PROBE` | …) and
    forbid redaction of `RP_PROBE` rows by the principal that *filed*
    them (only allow redaction by the *agent's* principal, which
    requires the agent to actually exist — circular by design).
  - Or: for AGENT_NOT_FOUND rows specifically, set `redactable: false`
    in the schema and short-circuit `redact()` to throw 403.

---

## MEDIUM

### S-11 — `Auth0Service.exchangeToken` returns a fabricated `apiKeyId` and never creates an actual API key
- File: `apps/api/src/modules/auth0/auth0.service.ts:62-95`
- Attack: Not an exploit, but a *security-bypass via dead code*. The
  Auth0Module isn't wired into `app.module.ts` (verified — not in
  imports[]), so this code path never runs. **However**, if a future
  session wires it up, the dashboard receives `api_key_id: okoro_live_<ulid>`
  that is *not in the ApiKey table*, then attempts to use it as an
  authenticator → 401 → user perceives the SSO flow as broken AND the
  dashboard must implement a fallback. Worse: the audit log shows
  `auth0.exchange` decision=APPROVED for a flow that didn't actually
  create a credential → audit chain claims something happened that
  didn't.
- Impact: When module is enabled, fabricated audit records (CLAUDE.md
  invariant #4 violation: "no fabricated data") + broken UX.
- Fix: Either delete `Auth0Service.exchangeToken` until M-026 lands, or
  call into `ApiKeyService.issue(principalId, …)` and return the *real*
  apiKeyId. Same applies to `actionLogin` which appends an audit row
  using `auditEventId = audit_${ulid()}` constructed locally and
  returned to the caller — but `audit.append()` ignores that and
  generates its own `evt_…` id, so the value returned to the caller is
  a *fabricated id that doesn't reference any real audit row*.

### S-12 — `WebhooksService.subscribe` does not validate URL through SSRF guard at registration time → enumeration before delivery
- File: `apps/api/src/modules/webhooks/webhooks.service.ts:28-33`
- Attack:
  1. Attacker subscribes to a webhook with URL
     `http://169.254.169.254/internal/`. Registration succeeds. SSRF
     guard runs *only at delivery time*. Until an event matches, no
     guard fires.
  2. Two consequences:
     a. Storage of malicious URLs as legitimate-looking subscriptions
        — gives an attacker a foothold to wait for an event that
        carries sensitive metadata.
     b. The first delivery attempt does run the guard, but each
        attempt costs CPU + DNS resolution. An attacker registering
        thousands of internal-IP URLs can amplify load on the
        delivery worker.
- Impact: Storage pollution + delivery-time amplification.
- Fix: Run `checkSsrf(url)` synchronously in `subscribe()`. Reject
  with 422 at registration time. Also enforce per-principal subscription
  count cap (e.g., 25) to prevent enumeration storage.

### S-13 — `ApiKeyService.resolve` timing oracle on key prefix population
- File: `apps/api/src/modules/auth/api-key.service.ts:54-76`
- Attack:
  1. Lookup is `findMany({ where: { keyPrefix } })` then bcrypt.compare
     loop. If the attacker can submit `okoro_sk_AAA…` and observe
     timing of 401 response, the response time is roughly proportional
     to the number of candidates with that prefix (each bcrypt.compare
     is ~100ms at cost=12).
  2. With `keyPrefix = okoro_sk_<3 random chars>`, the prefix has only
     ~62^3 = ~238k buckets across the entire customer base; some
     buckets will hold many keys at scale. An attacker measuring
     timing can identify "high-density" prefixes — useful for
     prioritising brute-force, and also leaking *aggregate customer
     count growth* over time (an attacker probing weekly sees mean
     bucket density grow → infers user-count signal).
- Impact: Side-channel leak of customer-count + brute-force prioritisation.
- Fix:
  - Bucket by `keyPrefix` AND a deterministic hash of the *full*
    plaintext (e.g. blake2b first 4 bytes) so each lookup hits ~1
    candidate regardless of prefix density.
  - Or: do a constant-N bcrypt.compare loop (always perform N
    comparisons, even if the first matches), so timing is constant
    in N regardless of how many candidates exist.

### S-14 — `JSON.parse` of cached values has no depth/size limit → cache-poisoning DoS
- File: `apps/api/src/common/redis/redis.service.ts:43-52`, also `idempotency.service.ts`
- Attack:
  1. Redis is a shared service. If an attacker can write to Redis
     (compromised Redis ACL, Redis exposed without auth in dev/staging
     — `REDIS_URL` config schema doesn't enforce password presence
     — config.schema.ts:16: `REDIS_URL: z.string().url()` — `redis://localhost`
     is valid), they can write `agent:status:<id>` = `<deeply nested
     JSON>`. On the next verify call, OKORO reads + `JSON.parse` →
     CPU spike + GC pressure.
  2. Worse: Redis cache injection of `agent:status:<victim>` =
     `{"id":"victim","publicKey":"<attacker_key>","status":"ACTIVE","trustScore":1000,"trustBand":"PLATINUM","principalId":"<victim>"}`
     overrides the per-agent verify result entirely. The DB read is
     skipped, so the attacker now has a 60-second window where
     verification of the victim's agentId uses the *attacker's*
     public key.
- Impact: Cache injection → identity hijack (overlaps S-2 but via
  different vector). Plus DoS.
- Fix:
  - Sign cached values: `set(key, hmac(value) + value)`,
    `get` verifies HMAC with a per-process secret derived from the
    audit signing key. Tampered cache entries = cache miss + alarm.
  - Or: defense-in-depth, refuse to cache `publicKey` at all — re-read
    from Postgres every time (acceptable cost given verify is ~10ms
    DB-round-trip).
  - Tighten REDIS_URL schema to require auth: `z.string().url().refine(u => new URL(u).password.length > 0, 'auth required')`.

### S-15 — Helmet defaults are *not* sufficient for an API origin that ships Swagger + audit-export NDJSON
- File: `apps/api/src/main.ts:21` (`app.use(helmet())`)
- Attack:
  1. `helmet()` with no options applies a CSP that breaks Swagger UI
     (inline scripts blocked). At Phase 1 the team likely disabled
     Swagger in prod (`ENABLE_SWAGGER` flag), but in dev/staging
     Swagger is on and CSP is *also* on, meaning either CSP is
     defaulted-permissive or Swagger is broken. Verified: helmet 8
     defaults include CSP that DOES block inline — Swagger UI will
     break in any environment where it's enabled.
  2. `audit/.../export.ndjson` sets `Content-Type: application/x-ndjson`
     and `Cache-Control: no-store` BUT does NOT set
     `X-Content-Type-Options: nosniff` explicitly (helmet sets it
     globally, but if helmet is reconfigured, easy to drop).
     Critical because if a browser is tricked into navigating to the
     export URL, MIME sniffing on a malicious payload could render
     it as HTML.
  3. No HSTS preload directive — helmet 8 sets HSTS but with default
     max-age of 1 year, no `includeSubDomains`, no `preload`. An
     attacker on first connect (TOFU) can still MITM.
  4. CORS: `corsOrigins: '*'` is the default in `config.schema.ts:59`.
     Combined with `credentials: true` in main.ts:24, this is
     **invalid CORS** (browsers reject `Access-Control-Allow-Origin: *`
     with credentials) but still serves to expose the API to all
     origins for non-credentialed requests. Worse: if `CORS_ORIGINS`
     is set to `*` in production by an operator (the schema permits
     it!), credentialed cross-origin requests will fail in browsers
     but the API still serves the response — effectively a
     wildcard-readable API.
- Impact: Swagger broken in prod, MIME-sniff XSS on audit-export
  endpoint, weak HSTS, dangerous CORS default.
- Fix:
  ```ts
  app.use(helmet({
    contentSecurityPolicy: config.enableSwagger
      ? false  // Swagger needs inline; only enabled in dev/staging
      : { directives: { /* strict prod CSP */ } },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  // Force explicit CORS list in prod
  if (config.nodeEnv === 'production' && config.corsOrigins === '*') {
    throw new Error('CORS_ORIGINS=* refused in production');
  }
  ```

### S-16 — No global request body size limit; default Express limit is `100kb` but OKORO uses `rawBody: true`
- File: `apps/api/src/main.ts:11-15` (`NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })`)
- Attack:
  1. With `rawBody: true`, Nest stores the raw body buffer for use by
     downstream middleware (the Stripe webhook handler — once it
     ships). The default Express `body-parser.json()` limit is
     `100kb`, but `rawBody: true` *also* buffers the body separately.
     A 1000/min `verify` throttle + 100KB body = ~1.6 MB/sec of
     bufferable garbage per attacker connection.
  2. `audit-chain.util.canonicalize` recursively `sortKeys` then
     `JSON.stringify`. A 100KB payload with deeply nested objects
     can blow the call stack (default Node stack ~12 KB) — verified
     with `JSON.stringify({a: {a: {a: {…}}}})` 1000 deep → RangeError.
  3. Verify endpoint has `MaxLength(2048)` on token + small bounds
     on the rest, but `context: Record<string, unknown>` is
     `@IsObject()` only — no size limit. Class-validator runs AFTER
     body-parser, so the 100KB body has already been read into
     memory.
- Impact: Memory pressure DoS, possible call-stack overflow on
  `canonicalize` if a malicious body bypasses validation (e.g. via
  the bate `evidence` field which has no nesting limit).
- Fix:
  ```ts
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  ```
  And add `maxDepth` to `canonicalize` (throw if depth > 32).

---

## NOT-A-VULN (intentional patterns; record so future reviewers don't re-flag)

- **`bcryptjs@2.4.3` instead of native bcrypt** — pure-JS, slower than
  native, but avoids native build dependency (Railway). Cost factor
  12 keeps brute-force infeasible. Acceptable.
- **`replay-cache.service.ts` rejects jti < 8 chars by returning false
  rather than throwing** — intentional fail-closed; treats short jti
  as a replay so the algorithm denies. Documented in line 45-47.
- **`redis.get` swallows errors and returns null** — intentional;
  callers in the spend-guard path now correctly handle null as "rehydrate
  from Postgres" (S-1 of round-2 audit). Verified spend-guard.service.ts
  is fail-closed if both Redis + Postgres are down.
- **`api-key.service.resolve` lastUsedAt update is fire-and-forget** —
  acceptable; missing updates only delay rotation reminders.
- **Audit chain uses non-RFC-8785 canonicalisation** — documented
  trade-off in `audit-chain.util.ts:18-21`. Verifier and signer share
  the same util. If verification library is ever published externally,
  port to RFC 8785 lib.
- **`AgentDelegation` model has no foreign-key constraints across
  tenants** — this is Phase 3, not yet exposed in any controller.
  Re-flag when M-040+ surfaces it.
- **Throttler `default` and `verify` configs are global, not
  per-principal** — already flagged as part of S-5; the rate-limit
  semantics are intentional but the per-IP tracker default is wrong.
- **`prisma.auditEvent.findFirst({ where: { agentId } })` in
  `append()`** — looks like a missing tenant scope, but the agentId
  itself is tenant-scoped via the agent FK; safe.
- **`CACHE_CONTROL = 'public, max-age=86400'` on `/.well-known/audit-signing-key`**
  — intentional; relying parties cache for 1 day. S-4 (key rotation)
  is the deeper concern, not the cache header.

---

## Summary for the operator

- **S-1 (no-exp JWT replay)** and **S-2 (identity hijack via
  unverified pubkey registration)** are the two findings that should
  block the next deploy. Both are sub-1-hour fixes. S-1 is a one-line
  change plus a NaN guard; S-2 is a two-step registration flow.
- **S-3 (Art. 17 redaction broken by trigger)** is regulatory-grade —
  fix before EU customer onboarding. The "stored procedure with
  security definer" approach is the cleanest path.
- **S-4 (audit key rotation)** doesn't bite until first rotation, but
  rotation is supposed to happen routinely. Get the historical-kid
  JWKS in place before the first rotation event.
- **S-5–S-10** are defense-in-depth: each reduces a specific attacker
  capability. Prioritise S-5 (rate limiter is currently per-edge) and
  S-8 (SSRF redirect bypass) since both have public-facing exploit
  paths.
- **S-11–S-16** are quality / hygiene; close them as part of normal
  sprint work.
