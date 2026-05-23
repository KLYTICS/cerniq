# CERNIQ — Threat Model v2 (auditor-grade)

> **Status:** draft for external review (SOC 2 Type II, EU AI Act
> conformity, partner-integration security review).
> **Supersedes:** `docs/THREAT_MODEL.md` once approved by operator.
> **Companion docs:** `docs/SECURITY.md`, `docs/ARCHITECTURE.md`,
> `docs/spec/03_TECHNICAL_SPEC.md`, `docs/BATE_ALGORITHM.md`.
>
> This document is additive — it does **not** overwrite v1. The v1 file
> is preserved while peer sessions iterate on it. Reconciliation
> guidance for the two docs lives in §4 ("Cryptographic stack —
> reconciled") and at the foot of every section that contradicts v1.

---

## 1. Scope and assumptions

### 1.1 In scope

The threat model covers the full CERNIQ control surface and all data
plane components that participate in a verify decision:

| Surface                       | Component / module                                   |
| ----------------------------- | ---------------------------------------------------- |
| Identity issuance             | `apps/api/src/modules/identity/`                     |
| Policy issuance               | `apps/api/src/modules/policy/`                       |
| Request-token verification    | `apps/api/src/modules/verify/`, `workers/cf-verify/` |
| Audit log (append + read)     | `apps/api/src/modules/audit/`                        |
| BATE trust scoring            | `apps/api/src/modules/bate/`                         |
| Webhooks (delivery + signing) | `apps/api/src/modules/webhooks/`                     |
| API-key authentication        | `apps/api/src/modules/auth/api-key.guard.ts`         |
| JWKS distribution             | `apps/api/src/modules/wellknown/` (peer-locked path) |
| Verifier-RP library           | `packages/verifier-rp/` (in-flight, see WORK_BOARD)  |
| SDK signing flows             | `packages/sdk-ts/src/crypto.ts`, `packages/sdk-py/`  |

### 1.2 Out of scope

We deliberately exclude four classes of risk that CERNIQ does **not**
mitigate by design (see `docs/SECURITY.md` §10 for the existing list):

1. **Agent runtime safety** — prompt injection, jailbreaks, and any
   reasoning-level attack that occurs inside the LLM before the agent
   asks CERNIQ to sign. CERNIQ sees only the resulting signed token and
   rejects on scope/spend regardless of why the agent produced it
   (CLAUDE.md §6 architectural mitigation T6).
2. **Merchant payment processor** — once a relying party's verify call
   returns `valid: true`, the downstream Stripe/Adyen/etc.
   authorization flow is the merchant's problem. CERNIQ does not move
   money.
3. **Developer private-key storage** — agent private keys are
   generated and stored client-side. CERNIQ provides best-practice
   guidance in the SDK and in `docs/SECURITY.md` §10 but cannot enforce
   it. Compromise of the developer's host yields agent signing
   capability; CERNIQ detects the resulting anomaly via BATE but does
   not prevent the underlying key theft.
4. **Customer relying-party infrastructure** — if a relying party's
   verify-key leaks, that leaks read-only verify capability under their
   own rate budget; it does **not** confer write authority on any
   principal's data. Mitigated by per-key rate limits (`docs/SECURITY.md`
   §7) and by the `ApiKeyGuard` enforcing principal scope on every
   query (CLAUDE.md invariant 5).

### 1.3 Trust assumptions

The model assumes the following are true. If any one is invalidated by
a future operational change, this section must be revisited.

| Assumption                                            | Provider                  | Failure mode                          |
| ----------------------------------------------------- | ------------------------- | ------------------------------------- |
| TLS 1.3 termination                                   | Railway + Cloudflare      | MITM → fall back to denial-of-service |
| Managed Postgres encrypted at rest (AES-256)          | Railway Postgres / Neon   | Backup leak → key material exposure   |
| Redis is in-memory and ephemeral (no persistence)     | Railway Redis             | Snapshot leak → live spend totals     |
| Operator does not have direct production DB write     | Railway IAM               | Insider tamper → caught by §9 chain   |
| OS-level CSPRNG (`crypto.randomBytes`, `webcrypto`)   | Node 20 LTS               | Predictable jti / nonce               |
| `@noble/ed25519` and `jose` are not backdoored        | Upstream maintainers      | Forgery; mitigation = pinning + audit |
| KMS is HSM-backed in prod (FIPS 140-2 L3)             | AWS KMS / Railway secrets | Key extraction → forgery              |
| Rekor / sigstore transparency log accepts our entries | Sigstore (Phase 2)        | Loss of public Merkle root pinning    |

---

## 2. The four-party trust model

CERNIQ is a **four-party** protocol — not three. The Principal (the
developer/organization), the Agent (a process holding an Ed25519
keypair), CERNIQ itself, and the Relying Party each hold distinct
secrets and play distinct verification roles. The mistake in the v1
prototype (`/Users/money/Downloads/files (7)/cerniq-server.js`) was
collapsing this into a two-party model where CERNIQ held a single HMAC
secret and re-signed everything for everyone — see §11 for the post-
mortem.

### 2.1 Diagram

```
                    ┌────────────────────────────┐
                    │  PRINCIPAL                  │
                    │  (developer org / merchant) │
                    │                             │
                    │  Holds: API key (plaintext  │
                    │   shown once at issuance)   │
                    │                             │
                    │  CERNIQ stores: argon2id     │
                    │   hash + 16-char prefix     │
                    └──────────────┬──────────────┘
                                   │
                                   │  POST /v1/agents/register
                                   │  X-CERNIQ-API-Key
                                   │  body: { publicKey, runtime, ... }
                                   ▼
   ┌────────────────────────┐                   ┌──────────────────────────┐
   │  AGENT                  │                   │  CERNIQ                    │
   │  (long-running process) │                   │                           │
   │                         │                   │  Holds:                   │
   │  Holds:                 │                   │   • SVC_KEY  (Ed25519)    │
   │   • Ed25519 PRIV (32B)  │                   │     for policy tokens     │
   │   • Ed25519 PUB  (32B)  │                   │   • AUDIT_KEY (Ed25519)   │
   │   • policy JWT          │   POST /policies  │     for audit chain       │
   │     (signed by SVC_KEY) │ ◀───────────────  │   • per-subscription      │
   │                         │                   │     HMAC-SHA256 secrets   │
   │  CERNIQ stores:          │   GET .well-known │     for webhooks          │
   │   • Ed25519 PUB only    │ ───jwks.json───▶  │                           │
   │   • status, principalId │                   │  CERNIQ stores:            │
   │                         │                   │   • agent PUBLIC keys     │
   └────────────┬────────────┘                   │   • policies              │
                │                                │   • audit chain (signed)  │
                │  Per-request                   │   • BATE signals          │
                │  signs: REQ_TOKEN              └──────────┬───────────────┘
                │  with agent PRIV                          │
                ▼                                           │ JWKS public key
   ┌─────────────────────────────────────┐                  │ rotation
   │  RELYING PARTY                       │                 │
   │  (Delta, Chase, Shopify, ...)        │                 │
   │                                      │                 │
   │  Holds (default): NO key with CERNIQ  │  GET /.well-known/jwks.json
   │   • verifies REQ_TOKEN locally using │ ◀───────────────┘
   │     cached JWKS (offline path)       │
   │                                      │
   │  Holds (optional): Verify-only key   │  POST /v1/verify (online)
   │   • argon2id hashed at CERNIQ         │ ────────────────▶
   │   • read-only, rate-limited          │
   └──────────────────────────────────────┘
```

### 2.2 Key inventory (per party)

| Party         | Material                               | Lifetime       | Where stored                        | Rotation                          |
| ------------- | -------------------------------------- | -------------- | ----------------------------------- | --------------------------------- |
| Principal     | API key (`cerniq_sk_…`)                | indefinite     | client-side; argon2id hash @ CERNIQ | on demand or compromise           |
| Agent         | Ed25519 keypair (32B priv / 32B pub)   | indefinite     | client-side (priv); pub @ CERNIQ    | by re-registration (revoke + new) |
| Agent         | Policy JWT (signed by CERNIQ SVC_KEY)  | ≤ 365 days     | held by agent, re-presented         | new policy on expiry/revoke       |
| CERNIQ        | Service signing key (SVC_KEY, Ed25519) | 90 days        | KMS / Railway secrets               | every 90 days, JWKS overlap       |
| CERNIQ        | Audit-chain key (AUDIT_KEY, Ed25519)   | 365 days       | KMS / Railway secrets               | every 365 days, transition event  |
| CERNIQ        | Webhook HMAC secret (per subscription) | per subscriber | Postgres (encrypted at rest)        | on operator demand, 24h grace     |
| Relying party | (optional) verify-only API key         | indefinite     | client-side; argon2id hash @ CERNIQ | on demand                         |

> **v1 reconciliation note.** `docs/THREAT_MODEL.md` §"Cryptographic
> choices" L42 lists `bcrypt cost 12` for API keys. We recommend
> migration to **argon2id** (the operator's standard across FORGE per
> session memory; resistant to GPU/ASIC; OWASP 2023 default). Keep
> bcrypt verify path during migration so existing keys continue to
> work; rehash on next successful verify.

### 2.3 Token taxonomy — three JWTs, three signing keys

| Token         | Issuer | Verifier      | Signed by                | Lifetime   | Carrier                                  |
| ------------- | ------ | ------------- | ------------------------ | ---------- | ---------------------------------------- |
| Policy token  | CERNIQ | Agent (held)  | CERNIQ SVC_KEY (EdDSA)   | ≤ 365 days | `PolicyCreateResponse.signedToken`       |
| Request token | Agent  | Relying party | Agent's Ed25519 private  | 30–60 s    | `VerifyRequest.token` / `X-CERNIQ-Token` |
| Audit record  | CERNIQ | Auditor (any) | CERNIQ AUDIT_KEY (EdDSA) | indefinite | `AuditEventSchema.signature`             |

Why three keys, not one (the v1 mistake):

1. **Blast-radius separation.** Compromise of SVC*KEY lets an attacker
   forge \_future* policy tokens; AUDIT*KEY compromise lets them forge
   \_past* audit records. Splitting forces the attacker to compromise
   both to fabricate a coherent fraudulent history.
2. **Rotation cadence asymmetry.** SVC_KEY rotates every 90 days
   (operational); AUDIT_KEY rotates every 365 days (regulatory — a
   shorter cadence makes long-tail audit verification harder).
3. **Verifier asymmetry.** Policy tokens are verified by agents and
   relying parties on every transaction. Audit signatures are verified
   by auditors (rarely, but in bulk). Different latency/throughput
   shapes.
4. **Algorithm identity, not algorithm dependency.** Both keys use
   EdDSA / Ed25519 (`jose` + `@noble/ed25519`) so we have one library
   to audit, but they live in different KMS slots with different IAM
   policies.

The agent's private key signing the request token is the only signature
that proves _the actual agent process_ approved the action. Without
it, CERNIQ would only attest that _some agent_ with this `agentId`
exists — not that the live process intended this specific request.
The v1 prototype lost this property entirely (see §11.1).

---

## 3. STRIDE table

Format: ID | Category | Threat | Vector | Mitigation | Residual risk | Status.

Mitigations cite the actual code path, config key, or migration that
implements the control. "Status" reflects the M-### module that owns it
in `WORK_BOARD.md`.

### 3.1 Spoofing

| ID   | Threat                                        | Vector example                                                                                            | Mitigation                                                                                                                                                                           | Residual risk                                                  | Status            |
| ---- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------- |
| S-01 | Fake principal sign-up                        | Attacker registers `evil@bigbank.com` to impersonate a real org and run authorized-looking agents.        | Email verification gate before issuance of first API key (`identity.service.ts` flag); KYC required for paid tiers; KYC unlocks BATE bonuses (`bate.scorer.ts` +150 weight).         | Domain squatting, weak email verification (no DKIM/SPF check). | M-002 partial     |
| S-02 | Fake agent registration under valid principal | Attacker steals dev API key, registers a malicious agent under victim's principal, drains policy budgets. | Per-key rate limits (`@nestjs/throttler` 120/min on management); audit emits `cerniq.agent.registered` webhook → operator alert; BATE flags new agent under high-velocity principal. | API-key theft is upstream of CERNIQ.                           | M-002 + M-008     |
| S-03 | Forged request token (no agent priv)          | Attacker without agent's Ed25519 priv tries to construct a JWT and submit to /verify.                     | EdDSA verification against agent's stored public key (`verify.algorithm.ts` step 2); denial = `INVALID_SIGNATURE` (`SECURITY.md` §6 #3).                                             | Quantum forgery (Phase 4 PQ migration in v1 §"PQ posture").    | M-005 ready       |
| S-04 | Forged policy token                           | Attacker fabricates a policy JWT to claim broader scope than CERNIQ issued.                               | EdDSA verify against CERNIQ SVC_KEY published in JWKS (§6); reject `kid` not in current+previous; `jose.jwtVerify` strict alg check (`alg: ['EdDSA']`).                              | SVC_KEY compromise → recovery via §5 rotation + revocation.    | M-004 ready       |
| S-05 | Fake relying-party fraud report               | Competitor RP submits `RELYING_PARTY_FRAUD_REPORT` to crash a target agent's BATE score.                  | `RelyingParty.reportWeight = 0.0` for unverified sources (`bate.scorer.ts`); DNS-TXT challenge to lift to verified; daily delta cap `-500` (`BATE_ALGORITHM.md` §4).                 | Verified RP turning malicious — operator review trigger.       | partial (UX TODO) |
| S-06 | Spoofed webhook callback                      | Attacker posts to merchant's webhook URL pretending to be CERNIQ to plant fake events.                    | Webhook body signed `HMAC-SHA256(secret, body)` (`CERNIQ_HEADER_SIGNATURE`); secret rotated per subscription; sample verifier in SDK and verifier-rp.                                | Customer fails to verify the signature (documentation risk).   | M-008 partial     |
| S-07 | DNS / domain hijack of `api.cerniq.io`        | Attacker takes over apex DNS, routes verify traffic to malicious origin.                                  | DNSSEC on `cerniq.io`; CAA records pinned to Let's Encrypt + DigiCert; HSTS preload; CT-log monitoring (Cert Spotter alert).                                                         | Registrar compromise — covered by registrar 2FA + lock.        | RUNBOOK §infra    |

### 3.2 Tampering

| ID   | Threat                                | Vector example                                                                 | Mitigation                                                                                                                                                                                                             | Residual risk                                                           | Status          |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------- |
| T-01 | Request-token claim tampering         | Attacker flips `amt` in payload while keeping signature.                       | EdDSA covers full payload incl. claims; any byte flip → `INVALID_SIGNATURE` (`crypto/ed25519.util.ts`).                                                                                                                | None (signature is over canonical bytes).                               | M-005 ready     |
| T-02 | Policy server-side mutation           | Insider edits `AgentPolicy.scopes` row in Postgres to widen scope.             | Server-authoritative scope (CLAUDE.md §SECURITY.md L31; client-presented scopes in token are advisory); `policy_snapshot` JSON copied into each `AuditEvent` row → audit chain breaks if policy was tampered post-hoc. | Insider edits both policy AND audit chain — caught by §9 hourly Merkle. | covered + M-006 |
| T-03 | Audit log row update / delete         | Insider runs `UPDATE audit_events SET decision = 'approved' WHERE …`.          | `prev_hash` chain (next event's hash mismatch) + EdDSA per-event signature; CLAUDE.md invariant 3 ("No `UPDATE` or `DELETE` on `AuditEvent` ever"); Postgres role for app has no UPDATE/DELETE on this table.          | Restore-from-backup attack — caught by hourly Merkle root publication.  | M-006 ready     |
| T-04 | Spend counter rollback                | Insider deletes a `SpendRecord` row to free spend budget.                      | Redis `INCRBY` is the source of truth in the hot path (§8); Postgres SpendRecord is reconciliation-only and reconciliation flags discrepancies > 5%.                                                                   | Coordinated Redis + Postgres tamper — operator-tier insider only.       | M-005 + M-013   |
| T-05 | JWKS document tampering               | MITM modifies `/.well-known/jwks.json` in transit to substitute attacker key.  | TLS 1.3 + HSTS preload + cache-warming on a known-good origin; verifier-rp pins `iss` claim and `kid` to JWKS-fetched key set; Sigstore-signed SDK release artifacts.                                                  | TLS root CA compromise — out-of-scope per §1.3.                         | M-004 wellknown |
| T-06 | Agent public-key swap at registration | Attacker pre-registers a public key they control under victim's `principalId`. | API-key auth required for `POST /agents/register` (`identity.controller.ts` `@UseGuards(ApiKeyGuard)`); challenge-response handshake (sign a server-issued nonce) before status flips to `active` (M-003).             | API-key theft → mitigated by S-02 detection.                            | M-003 partial   |

### 3.3 Repudiation

| ID   | Threat                                   | Vector example                                                                                    | Mitigation                                                                                                                                                                                                 | Residual risk                                                  | Status        |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------- |
| R-01 | Agent denies signing a request           | Customer says "we never signed this $10k charge."                                                 | Request token contains agent's EdDSA signature over claims; audit `AuditEvent.signature` includes the original token's `jti` and signature digest; verifier-rp keeps token in dispute log for `ttl + 24h`. | Agent priv key was leaked (out of scope; surfaces in BATE).    | M-005 + M-006 |
| R-02 | CERNIQ denies issuing a policy           | Principal disputes a policy that CERNIQ records as theirs.                                        | Policy token signed by SVC_KEY; SVC_KEY pubs in dated JWKS history (`/.well-known/jwks.json` + `/.well-known/jwks-archive.json` Phase 2); auditor can verify any issued token against the era's pubkey.    | SVC_KEY archive lost — DR plan §5.5.                           | M-004         |
| R-03 | Audit gap (verify succeeds, audit fails) | Verify writes spend, then DB writeback to audit fails; operator denies the request ever happened. | Audit append in same Postgres tx as spend reconcile (when path is online); Redis-only fast path → BullMQ "audit pending" with DLQ; verify response includes `auditEventId` so RP can detect a gap.         | Concurrent Postgres + Redis + BullMQ failure (very rare).      | M-006         |
| R-04 | Webhook delivery missing                 | "We never got the revoke event" — customer claims unawareness of agent revoke.                    | BullMQ retries with exponential backoff (5 attempts over 24h); each delivery in `WebhookDelivery` row; HMAC body signature → customer can replay from dashboard; non-delivery alarm at 5% rate.            | Customer endpoint is permanently down — surfaced in dashboard. | M-008         |

### 3.4 Information disclosure

| ID   | Threat                            | Vector example                                                                     | Mitigation                                                                                                                                                                                              | Residual risk                                                                     | Status                    |
| ---- | --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------- |
| I-01 | Cross-principal data leak in API  | Principal A queries `GET /agents/agt_belongs_to_B` and gets a 200.                 | Every service method takes `principalId` as first arg and includes `where: { principalId }` (CLAUDE.md invariant 5; SECURITY.md §5); end-to-end test in `tests/e2e/isolation.spec.ts`.                  | Future Postgres RLS as defense-in-depth (planned).                                | covered + tests in flight |
| I-02 | JWKS public-key disclosure        | "JWKS is exposed without auth."                                                    | **Intentional**: JWKS is public infrastructure (`docs/SECURITY.md` §4.3 "Key rotation"). Only public Ed25519 keys are returned. Caching via CDN; no rate limit on this path.                            | None (public by design).                                                          | n/a (informational)       |
| I-03 | Redis snooping (snapshot leak)    | Railway support copies a Redis dump; attacker reads spend totals + jti cache.      | Redis is in-memory only (no `appendonly`); IAM separates infra-team and app-team access; spend totals are not PII; `jti:{…}` keys carry no payload, just `"1"`.                                         | Snapshot retains principal/agent IDs (low PII).                                   | covered                   |
| I-04 | Log injection of secrets          | Pino captures `req.headers.authorization` or token body in error log.              | `app.module.ts` Pino redaction for `req.headers["x-cerniq-api-key"]`, `req.headers["x-cerniq-verify-key"]`, `authorization`, `req.body.token`; nightly grep CI step for raw `cerniq_sk_` prefix.        | Custom log line added without redaction — guarded by lint rule (M-018 follow-up). | covered (extend lint)     |
| I-05 | Audit-log read by wrong principal | Principal A reads audit events for principal B's agent.                            | `audit.controller.ts` filters by `req.principal.id`; explicit cross-principal reads (e.g. RP report viewer) are signed and emit `cerniq.audit.cross_principal_read` webhook for the affected principal. | Operator/back-office reads — logged in audit-of-audit (Phase 2).                  | M-006                     |
| I-06 | Trust-score reverse engineering   | Adversary submits crafted signals to learn BATE weights and probe near-band edges. | Score deltas carry small jitter (`BATE_ALGORITHM.md` §9); per-source caps (`-500/day` for fraud reports); reports require verified RP for full weight.                                                  | Sufficiently patient adversary — band-level reproducibility is intentional.       | covered                   |
| I-07 | Stripe webhook secret leak        | Env-var leak via misconfigured CI logs.                                            | Pino redaction list includes `STRIPE_WEBHOOK_SECRET`; gitleaks pre-commit + CI; Railway secret scoped to `apps/api` only.                                                                               | Build cache poisoning — out of CI scope for this audit.                           | covered                   |

### 3.5 Denial of service

| ID   | Threat                                    | Vector example                                                           | Mitigation                                                                                                                                                                                                     | Residual risk                                                                  | Status                   |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| D-01 | `/v1/verify` flood from leaked verify-key | Attacker hammers `/verify` with valid creds.                             | `@nestjs/throttler` per-key 1000 rpm (`docs/SECURITY.md` §7); per-IP CF Phase-3 hard cap 10000 rpm; offline JWKS path means well-behaved customers don't even hit CERNIQ.                                      | Distributed key-stuffing — caught by aggregate `failed_verify_spike` alert.    | M-009                    |
| D-02 | Register-spam under leaked API key        | Attacker creates 1M agents to exhaust principal quota / DB.              | Plan-tier hard cap on `agents per principal`; per-key rate limit on `POST /agents/register` (60 rpm, vs. 120 default for management); Postgres composite index on `(principalId, status)` keeps queries cheap. | Legitimate fanout to many agents — operator can lift cap on request.           | M-002 + M-014 plan tiers |
| D-03 | Redis exhaustion via spend keys           | Attacker creates many policy IDs → many `spend:{policyId}:day:...` keys. | Spend keys are per-policy; policy creation rate-limited (10 rpm per principal); spend keys TTL to midnight UTC, max ~365 keys/policy/year; Redis `maxmemory-policy=allkeys-lru` with `maxmemory` ceiling.      | Operator must size Redis to plan-tier ceilings (capacity §A-04 in arch audit). | RUNBOOK §scaling         |
| D-04 | Slow-loris / TLS-handshake exhaustion     | Attacker opens many half-open TLS connections.                           | Cloudflare front (Phase 3) absorbs; Railway proxy enforces 30s read timeout, 60s total timeout; Fastify-style backpressure on body size 1MB max.                                                               | None of significance once CF in front.                                         | scaffolded               |
| D-05 | BATE worker queue exhaustion              | Adversary submits many fake reports to DOS the BullMQ signal worker.     | BullMQ rate limiter `RelyingParty.reportWeight=0` reports skip the heavy scorer path; DLQ caps; per-RP daily report cap.                                                                                       | Verified-RP attacker (rare; operator-reviewable).                              | M-007 + M-008            |
| D-06 | Webhook redelivery storm                  | Customer endpoint flaps, BullMQ retries pile up.                         | Exponential backoff with cap; per-subscription rate limit on the BullMQ worker (`docs/SECURITY.md` §7); auto-disable subscription after 100 consecutive failures over 24h.                                     | None significant.                                                              | M-008                    |

### 3.6 Elevation of privilege

| ID   | Threat                                      | Vector example                                                                    | Mitigation                                                                                                                                                                                                   | Residual risk                                                                           | Status         |
| ---- | ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------- |
| E-01 | Principal A steals principal B's agent keys | A insider exfils agent priv via shared infra (e.g. Vercel project switch).        | CERNIQ does not hold private keys (CLAUDE.md invariant 1); all isolation upstream is the customer's responsibility; CERNIQ detects misuse via BATE signals (`VELOCITY_ANOMALY`, `GEOGRAPHIC_INCONSISTENCY`). | Customer-side incident — out of scope per §1.2.                                         | n/a (customer) |
| E-02 | Scope expansion via crafted token           | Agent crafts a request token claiming a scope the policy does not grant.          | Server-authoritative scope check: CERNIQ loads the policy from DB by `pid`, compares request `act`/`amt` against `policy.scopes`, ignores any client-provided scope hints (`verify.algorithm.ts` step 5).    | None — client claims are advisory only.                                                 | M-005 ready    |
| E-03 | Replay across relying parties               | RP1 captures a request token with `mid: rpId-1` and replays at RP2.               | Token includes `mid` (merchant id) and `dom` (domain) when relevant; verifier-rp checks `dom` matches its own; CERNIQ-side `jti` cache makes second use return `INVALID_SIGNATURE`.                          | RPs that don't pin `dom` — covered in verifier-rp docs.                                 | M-016          |
| E-04 | Replay within an RP                         | RP captures a token, replays it 30s later (still within `exp`).                   | Per-RP `jti` LRU cache (verifier-rp library); CERNIQ-side Redis `jti` set on online verify path (§7).                                                                                                        | TTL-window replay if RP fails to deploy verifier-rp — caught at CERNIQ for online path. | M-016          |
| E-05 | Verify-only key escalating to write         | Attacker possessing only a verify-only key tries to call `POST /agents/register`. | `ApiKeyGuard` checks `key.type === 'full'` for write paths; verify-only keys are flagged in `ApiKey.role` and only the `verify`/`status` controllers accept them (`api-key.guard.ts`).                       | Misconfigured guard on a future endpoint — guarded by integration test.                 | M-002          |
| E-06 | Webhook secret reuse across subscriptions   | Attacker who reads one webhook secret tries it against all subscriptions.         | One secret per subscription (`WebhookSubscription.signingSecret`); secrets are CSPRNG-generated and never reused.                                                                                            | DB compromise reveals all secrets — same impact as principal isolation breach.          | M-008          |

---

## 4. Cryptographic stack — reconciled

This section reconciles the v1 file's `RSA-4096 / SHA-256` choice for
audit signing against the rest of the CERNIQ stack. **v2 normalizes on
EdDSA / Ed25519 for all asymmetric operations.**

### 4.1 Algorithm by operation

| Operation                | Algorithm             | Library            | Key              | Rotation    | DR / recovery                                                         |
| ------------------------ | --------------------- | ------------------ | ---------------- | ----------- | --------------------------------------------------------------------- |
| Agent identity signature | EdDSA / Ed25519       | `@noble/ed25519`   | per-agent        | re-register | Customer-side; CERNIQ retains pub for verify continuity               |
| Policy token signature   | EdDSA / Ed25519       | `jose`             | SVC_KEY          | 90 days     | KMS-backed; previous key in JWKS for ≥ 90 days post-rotation          |
| Audit chain signature    | EdDSA / Ed25519       | `@noble/ed25519`   | AUDIT_KEY        | 365 days    | KMS-backed; transition event signed by both old + new on rotation     |
| API-key hash             | argon2id (target)     | `argon2`           | n/a              | n/a         | bcrypt verify path during migration; rehash on next successful verify |
| Webhook body MAC         | HMAC-SHA-256          | `node:crypto`      | per-subscription | on demand   | Old secret valid 24h grace; surfaced in dashboard                     |
| TLS                      | TLS 1.3, X25519 ECDHE | Cloudflare/Railway | platform-managed | platform    | Out of scope                                                          |
| Token / event IDs        | `crypto.randomUUID`   | `node:crypto`      | n/a              | n/a         | Native CSPRNG                                                         |
| Public-key fingerprint   | SHA-256 (`kid`)       | `node:crypto`      | derived          | derived     | Recomputable from key                                                 |

### 4.2 Why EdDSA hash chain, not RSA-4096, for audit signing

The existing `docs/THREAT_MODEL.md` L21 and L44 specify RSA-4096 / SHA-256
for audit-record signatures, citing "Industry-standard tamper-evidence;
verifiable in any language." The v2 recommendation is to switch to
**EdDSA over Ed25519** for the audit chain, with three primary reasons
and a fourth that pushes it from "preference" to "design correctness."

1. **Library uniformity.** CERNIQ already has `@noble/ed25519` audited and
   unit-tested in the verify hot path (`apps/api/src/common/crypto/`).
   Adding RSA introduces a second crypto dependency surface (`node:crypto`
   RSA), a second key format, a second JWS algorithm string in `jose`,
   and a second set of failure modes for ops to learn. CLAUDE.md
   stack-reality § "Crypto" says: _"One curve, one library, audited.
   Do not introduce alternatives."_
2. **Verifier throughput.** Auditors don't verify one event — they
   verify thousands or millions in bulk during a SOC 2 or EU AI Act
   review. Ed25519 verify is ~50µs/op; RSA-4096 verify is ~1.5ms/op
   (~30× slower). For a 10M-event chain that is the difference between
   an 8-minute audit and a 4-hour audit.
3. **Signature size.** Ed25519 sigs are 64 bytes vs. 512 bytes for
   RSA-4096. At 1B audit events/year (operator's 5-year capacity plan)
   that is 64GB vs. 512GB just in signatures. We pay this in Postgres
   storage cost and in audit-export bandwidth.
4. **The tamper-detection story does not depend on the signature.**
   The audit chain's tamper-evidence comes from `prev_hash` (the chain
   itself); the signature only proves _CERNIQ at the time produced this
   record_. Industry-standard is the chain construction (RFC 6962-style
   transparency log, Sigstore Rekor), not RSA. We get "verifiable in
   any language" because Ed25519 is a mandatory primitive in JOSE
   (RFC 8037), implemented in `pyca/cryptography`, Go's `crypto/ed25519`,
   Rust's `ed25519-dalek`, etc. — every language an auditor uses.

The v1 statement "verifiable in any language" was aimed at RSA-4096's
ubiquity in OpenSSL CLI tools. Ed25519 is now equally ubiquitous post-
RFC 8032 (2017) and is the JOSE default for new deployments.

> **Decision:** EdDSA / Ed25519 for audit-chain signatures. Document
> referenced in `docs/SECURITY.md` §3 already lists Ed25519 (L60,
> "Audit chain signature"). v1 THREAT_MODEL.md L44 is the outdated row;
> v2 supersedes.

### 4.3 Audit-chain construction (precise)

```
Inputs at append time:
  prev_event   = the previous event's full stored record (or null if first)
  event_body   = { eventId, agentId, principalId, timestamp, action,
                   relyingParty, decision, decisionReason, trustScoreAtEvent,
                   policyId, policySnapshot }   // no signature, no prevHash

Step 1 — prevHash (32 bytes):
  if prev_event is null:
    prevHash = 0x00 * 32        // genesis
  else:
    prevHash = SHA-256( JCS(prev_event) )    // RFC 8785 JSON Canonicalization Scheme,
                                              // applied to prev_event INCLUDING its
                                              // own prevHash and signature

Step 2 — payload to sign:
  payload = JCS({ ...event_body, prevHash: hex(prevHash) })

Step 3 — signature:
  sig = Ed25519Sign(AUDIT_KEY.private, payload)

Step 4 — persisted row:
  AuditEvent {
    ...event_body,
    prevHash:  hex(prevHash),     // 64 hex chars
    signature: base64url(sig),    // 86 chars  (64 raw bytes)
    kid:       AUDIT_KEY.kid       // for rotation lookup
  }

Verification:
  for each event in chronological order:
    if event.kid != current AUDIT_KEY:
      key = lookup historical AUDIT_KEY by kid in /.well-known/jwks-archive.json
    payload = JCS({ ...event_body_view(event), prevHash: event.prevHash })
    assert Ed25519Verify(key.public, payload, base64url_decode(event.signature))
    assert event.prevHash == hex(SHA-256(JCS(prior_event_full_record)))   // chain link
```

`JCS` here is **RFC 8785 JSON Canonicalization Scheme**: lexicographic
key sort, no whitespace, fixed numeric form, UTF-8 NFC. Implemented in
`apps/api/src/common/crypto/jcs.util.ts` (M-006).

A reference implementation in three languages:

- TypeScript: `audit-chain.util.ts`
- Python: `packages/sdk-py/cerniq/audit.py` (read-only verifier)
- Go: published as a gist alongside the public key for partner integrations

### 4.4 Algorithms we deliberately do not use

In addition to the list in `docs/SECURITY.md` §3 (RSA, secp256k1,
HS256, hand-rolled), this v2 also rejects:

- **Ed448** — slower, larger, no security benefit at our threat model.
- **JWE-encrypted audit records** — would prevent third-party verification
  without sharing keys; the threat model treats audit content as
  _confidential but not secret_ (the principal already has it).
- **Schnorr / BIP-340** — same security as Ed25519, narrower ecosystem.

---

## 5. Key rotation lifecycle

### 5.1 Service signing key (SVC_KEY) — 90 days

- Generated by ops runbook (`docs/RUNBOOK.md` §key-rotation), Ed25519
  keypair, private stored in KMS, public published.
- New key gets a fresh `kid` (timestamp + random suffix:
  `svc-2026-Q3-7af3`).
- **Overlap window 90 days.** Both old and new keys appear in
  `/.well-known/jwks.json` for the entire 90-day period after rotation,
  giving any in-flight policy token time to either expire or be
  re-issued.
- **Hard rule:** A new policy token cannot have `exp >
current_key.expires_at`. Implemented as a check in `policy.service.ts`
  before signing.
- **Emergency rotation** (suspected compromise): bring old `kid` into a
  revocation list at `/.well-known/jwks-revoked.json`; verifier-rp
  treats any revoked `kid` as `INVALID_SIGNATURE` regardless of
  expiry.

### 5.2 Audit-chain key (AUDIT_KEY) — 365 days

- Rotation generates a fresh keypair; old key is **archived in JWKS
  history**, never deleted.
- On rotation, CERNIQ appends a special audit event:
  ```json
  {
    "eventId": "evt_keyrot_2026-Q4",
    "action": "audit.key_transition",
    "decision": "approved",
    "decisionReason": "Routine 365-day rotation per docs/THREAT_MODEL_v2.md §5.2",
    "transitionFromKid": "audit-2025-Q4-c19f",
    "transitionToKid":   "audit-2026-Q4-9ab2",
    "transitionToPubB64u": "<new pub key>",
    ...
  }
  ```
- This event is itself signed by the **outgoing** key. The next
  ordinary event is signed by the new key. The `kid` field on every
  row tells verifiers which key applied at the time of signing.
- Auditors receive a JWKS-archive bundle along with any audit export
  so they can verify all historical records back to genesis.

### 5.3 Webhook HMAC secrets — per subscription, on demand

- Default lifetime: indefinite (most production webhook integrations
  don't rotate).
- Operator-triggered rotation: `POST /v1/webhooks/{id}/rotate-secret`
  generates a new secret, returns it once, marks the old secret valid
  for **24 hours** in the verifier path (so customers can deploy the
  new secret without downtime).
- Both old and new are tried by `webhook-verifier` SDK helper — first
  match wins.

### 5.4 Agent keys — operationally, by re-registration

- CERNIQ does not rotate agent keys (it doesn't hold them). The
  documented operational flow:
  1. Customer generates a new keypair locally (SDK
     `generateKeypair()`).
  2. `POST /v1/agents/register` with the new public key — returns a
     new `agentId`.
  3. Issue policies on the new agent, migrate traffic.
  4. `DELETE /v1/agents/{old_agentId}` once traffic is drained.
- BATE history transfer: `PATCH /v1/agents/{new_agentId}/inherit-trust
{ from: old_agentId }` (Phase 2; requires API-key auth and emits an
  audit event). This avoids forcing every healthy agent back to score
  500 on rotation.
- **Compromise path:** `DELETE /v1/agents/{agentId}` busts the agent
  cache synchronously; revocation propagates to the verify path within
  60s worst-case (and within ~2s typical via the synchronous Redis SET
  in revoke). This is the same path documented in `docs/SECURITY.md`
  §9 T-3.

### 5.5 Disaster recovery

- **All CERNIQ-held private keys are KMS-resident in production.** AWS
  KMS (HSM-backed, FIPS 140-2 L3) or Railway Vault — operator decision
  per `OPERATOR_DECISIONS.md` (peer-locked path, do not edit here).
- **Backup**: KMS exports an encrypted bundle weekly to S3 + GCS in a
  separate region; bundle decryptable only by KMS using the operator's
  break-glass key.
- **Recovery runbook**: `docs/RUNBOOK.md` § "Cryptographic key
  recovery". Steps include:
  1. Provision new KMS slot.
  2. Restore from the most recent encrypted bundle.
  3. Compare restored fingerprint against the value pinned in
     `docs/decisions/key-fingerprints.md`.
  4. If fingerprints match → service resumes; if not → emergency
     rotation per §5.1.
- **No private key ever appears outside KMS in plaintext** — including
  in `.env`, in Railway secret panel UI, or in local dev. Local dev
  uses ephemeral keys generated at server start
  (`config/dev-bootstrap.ts`).

---

## 6. JWKS distribution

### 6.1 Endpoint contract

`GET /.well-known/jwks.json` (the path is owned by
`apps/api/src/modules/wellknown/`; this section documents the shape,
the module owner is responsible for the implementation):

- **Public**, no `X-CERNIQ-API-Key` required.
- **No CORS restriction** (browsers verifying client-side need it).
- **Cache headers**: `Cache-Control: public, max-age=300,
stale-while-revalidate=86400`.
- **CDN**: Cloudflare front (Phase 3) caches at edge.

Each JWK entry:

```json
{
  "kid": "svc-2026-Q3-7af3",
  "kty": "OKP",
  "crv": "Ed25519",
  "x": "<32-byte pubkey, base64url, 43 chars no padding>",
  "use": "sig",
  "alg": "EdDSA"
}
```

The document includes:

- The current SVC_KEY.
- The most-recently-retired SVC_KEY (during the 90-day overlap).
- The current AUDIT_KEY.

It does **not** include retired AUDIT_KEYs — those live at
`/.well-known/jwks-archive.json` (full historical bundle, larger,
cached longer: `max-age=86400`).

### 6.2 Verifier-rp behavior

- On startup: fetch JWKS, cache by `kid`, refresh on expiry.
- On verify: read `kid` from JWT header, look up in cache. Cache miss
  → refetch JWKS (rate-limited internally to once per 30s); still
  miss → reject as `INVALID_SIGNATURE`.
- **Never trust a JWT that doesn't carry a `kid` header** (algorithm
  confusion attack defense — `none` alg, `HS256` alg-substitution).
- `alg` header **must** be `EdDSA`; verifier-rp rejects any other.

### 6.3 Failure modes

| Failure                         | Detection                                   | Response                                                                                |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| JWKS endpoint 5xx               | verifier-rp circuit breaker (3 consecutive) | Use cached JWKS up to `stale-while-revalidate` (24h); after that, fail closed           |
| JWKS document tampered          | `kid` not found / sig fails                 | Verify denial = `INVALID_SIGNATURE`; emit `JWKS_VERIFY_FAIL` metric                     |
| JWKS clock skew vs. token `exp` | `nbf`/`exp` reject                          | Standard JOSE; documented 30s clock-skew tolerance in verifier-rp config                |
| JWKS rotation mid-flight        | New `kid` not yet in cache                  | Refetch on demand; if new key was published >5min ago and we still don't see it → alert |

---

## 7. Replay defence — three layers

A request token's threat model assumes capture is possible (TLS
termination logs, RP-side persistence, a malicious RP). Replay is
mitigated in **three independent layers** so any single one's failure
does not leak through:

### 7.1 Layer 1 — Token TTL (always on)

- Enforced server-side at policy creation:
  `TOKEN_TTL_MIN_SECONDS = 30`, `TOKEN_TTL_MAX_SECONDS = 60`
  (`packages/types/src/constants.ts` L22–23).
- The agent SDK refuses to set `ttlSeconds` outside this range
  (`packages/sdk-ts/src/crypto.ts` L51 — currently defaults to 60s,
  add upper-bound clamp in M-018-followup).
- CERNIQ verify path rejects any token where `exp - iat > 60` → maps to
  `INVALID_SIGNATURE` (we don't leak that the token was in-window
  but too long-lived; that's policy info).

### 7.2 Layer 2 — Per-RP `jti` cache (verifier-rp library)

- In-memory LRU keyed on `jti`, value = `{ usedAt, rpId }`.
- TTL = remaining token lifetime + 10 s skew tolerance.
- Cache size: 100k entries default; LRU eviction.
- Persistence: none — process restart resets the cache, but token TTL
  ≤ 60s so the worst case is 60s of replay tolerance after restart.
- This is the primary defense for **offline verifiers** (RPs that
  don't call `/v1/verify`).

### 7.3 Layer 3 — CERNIQ-side `jti` set (online verify path)

- Implemented in `verify.algorithm.ts` step 3:
  ```
  ok = await redis.set(`jti:${jti}`, "1", "EX", ttl, "NX")
  if !ok: return { valid: false, denialReason: 'INVALID_SIGNATURE', ... }
  ```
  `SETEX` with `NX` is atomic — first writer wins, every subsequent
  writer sees `ok = false`.
- TTL = token's remaining lifetime + 10s skew.
- Note: we deliberately return `INVALID_SIGNATURE` (not a more specific
  `TOKEN_REPLAYED`) to avoid leaking replay-detection state to an
  attacker probing for cache hits. This is a privacy-of-detection
  decision, not a precedence violation — it's still a signature-class
  rejection from the RP's perspective.

### 7.4 Trade-offs

| Mode                           | Layers active | Coverage                                                                          |
| ------------------------------ | ------------- | --------------------------------------------------------------------------------- |
| Offline RP (JWKS-only)         | 1 + 2         | Replay protected within the RP; cross-RP replay needs token's `dom` claim         |
| Online RP (calls `/v1/verify`) | 1 + 2 + 3     | Globally protected; CERNIQ sees replays across RPs                                |
| Online RP, CERNIQ Redis down   | 1 + 2         | Layer 3 fails closed (`SERVICE_UNAVAILABLE`); RP retries or falls back to offline |

The three-layer design means an CERNIQ-Redis outage does **not**
silently disable replay protection — it returns 503 instead of a false
"valid" (cf. v1 prototype's silent failure mode, §11.3).

---

## 8. TOCTOU spend mitigation

### 8.1 The v1 bug

`/Users/money/Downloads/files (7)/cerniq-server.js` lines 505–527 read
the day/month spend totals via `SELECT SUM`, compared them to the
limit, then `INSERT`ed the new spend record. Two concurrent verifies
for the same agent could both pass the check (each seeing the pre-
insert sum) and both insert, exceeding the cap. This is a classic
time-of-check / time-of-use race.

### 8.2 v2 mitigation

Redis `INCRBY` is atomic and is the source of truth in the hot path.

```ts
// Pseudocode for spend-guard.service.ts (M-005)
async function chargeSpend(policyId: string, amount: number, limit: SpendLimit) {
  const dayKey = redisKey.spendDay(policyId, today());
  const monthKey = redisKey.spendMonth(policyId, thisMonth());

  // Day check
  const newDay = await redis.incrby(dayKey, amount);
  await redis.expireat(dayKey, midnightUtc()); // idempotent
  if (limit.maxPerDay !== undefined && newDay > limit.maxPerDay) {
    await redis.decrby(dayKey, amount); // compensate
    return { ok: false, reason: 'SPEND_LIMIT_EXCEEDED' as const };
  }

  // Month check (only if day passed)
  const newMonth = await redis.incrby(monthKey, amount);
  await redis.expireat(monthKey, endOfMonthUtc());
  if (limit.maxPerMonth !== undefined && newMonth > limit.maxPerMonth) {
    await redis.decrby(dayKey, amount); // compensate both
    await redis.decrby(monthKey, amount);
    return { ok: false, reason: 'SPEND_LIMIT_EXCEEDED' as const };
  }

  // Per-transaction is a stateless check, doesn't need Redis
  // (handled before this function — see verify.algorithm.ts step 6).

  return { ok: true, dayTotal: newDay, monthTotal: newMonth };
}
```

The compensating `DECRBY` is racy _with reads_ (a concurrent verify
during the few microseconds between `INCRBY` overshoot and `DECRBY`
might see a too-high value), but **never gives away spend** — at
worst it rejects a legal request with `SPEND_LIMIT_EXCEEDED`. That's
a fail-safe direction.

### 8.3 Postgres backstop (durability + audit)

- `SpendRecord` row written from the BullMQ "spend-record" worker on
  each successful verify (`bate.worker.ts` and `audit.service.ts`
  share this path).
- A nightly cron at 02:00 UTC compares `SUM(SpendRecord)` per policy
  against the day/month Redis counters. Discrepancy > 5% emits
  `bate.signal.audit_mismatch` to the `#cerniq-ops` channel and
  flags the agent's BATE for human review.
- Postgres is the source of truth across reboots — Redis spend
  counters are recomputed from `SpendRecord` aggregates on Redis
  cold start (`apps/api/src/common/redis/bootstrap.ts`).

### 8.4 Redis-down failure mode

If Redis is unreachable, the spend guard **fails closed**:

```ts
catch (e: unknown) {
  if (isRedisError(e)) {
    throw new ServiceUnavailableError('SPEND_GUARD_DEPENDENCY_DOWN', ...)
  }
  throw e
}
```

The verify response is HTTP 503 with `error: SERVICE_UNAVAILABLE`. We
do **not** silently fall back to a Postgres-only check (which would
re-introduce the v1 TOCTOU). The fallback decision is operator-paged,
not automatic. CLAUDE.md invariant 4 ("No silent failures") is the
reason this isn't even a config option.

---

## 9. Audit chain — tamper detection

### 9.1 Per-event signature + prev-hash

Every `AuditEvent` row carries:

- `prevHash` (32 bytes hex) — SHA-256 over the JCS-canonical bytes of
  the previous event's full stored record.
- `signature` (Ed25519 over `JCS({ ...event, prevHash })`).
- `kid` — which AUDIT_KEY signed it.

Any single-row tamper breaks two checks: the signature itself, and the
`prevHash` link pointed at by the next row. An attacker would have to
re-sign every subsequent row, which requires the AUDIT_KEY they don't
have.

### 9.2 Hourly Merkle root publication (Phase 2)

- Every hour at `:00`, CERNIQ computes a Merkle root over all events
  written in that hour (`apps/api/src/modules/audit/merkle.worker.ts`,
  M-006-followup).
- The hour's root is published to a transparency log (Sigstore Rekor
  via the in-toto attestation predicate), pinning the existence and
  ordering of every event CERNIQ claims to have logged.
- Auditors can request a Merkle proof for any event → independently
  verify against the published root.
- This pins us against a "restore from old backup" attack: an
  attacker who replaces the entire chain still has to either match
  every hourly Merkle root (impossible without forging Rekor entries)
  or be detected at the next audit.

### 9.3 Tamper test (CI)

`tests/security/audit-tamper.spec.ts`:

1. Append 100 events.
2. Mutate event #50's `decision` field.
3. Run chain verifier.
4. Assert it reports `chain break at event 50`, `chain break at event 51`
   (signature fails on #50; prevHash mismatch on #51).

The test gates merge to main. CLAUDE.md crypto-rule
("Crypto code requires a paired `.spec.ts`") applies.

### 9.4 Detection signals (operator alerts)

| Signal                                     | Source                       | Threshold                   | Page level   |
| ------------------------------------------ | ---------------------------- | --------------------------- | ------------ |
| `audit_chain_signature_failures_total`     | Prometheus on `audit.verify` | any in 5 min                | PagerDuty P1 |
| `audit_chain_prevhash_mismatches_total`    | same                         | any in 5 min                | PagerDuty P1 |
| `audit_merkle_root_publish_failures_total` | Rekor publisher              | 3 consecutive hours         | PagerDuty P2 |
| `audit_event_write_failures_total`         | service                      | > 0.1% in 5 min             | PagerDuty P2 |
| `audit_export_request_total`               | controller                   | informational, daily review | Slack only   |

---

## 10. Detect & respond

### 10.1 Detection signals

| Signal                                                            | Where                                      | Notes                                                 |
| ----------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `verify_total{denial_reason="INVALID_SIGNATURE"}` spike per agent | Prometheus / `verify.algorithm.ts`         | Probable agent priv compromise or mass replay attempt |
| `bate_score_delta` crash (≥ 200 in 1 hour)                        | BATE worker                                | Targeted fraud-report attack — escalate to operator   |
| Audit chain break (any)                                           | nightly job + on-read                      | P1                                                    |
| JWKS fetch error rate from RPs                                    | external, via verifier-rp opt-in telemetry | Indicates upstream outage or RP-side misconfig        |
| Webhook delivery failure rate per subscription                    | BullMQ                                     | > 50% in 5 min → auto-disable subscription            |
| Per-key auth failures (`AUTH_REQUIRED` rate)                      | nginx/CF logs + Pino                       | Possible credential-stuffing                          |
| Per-IP `/verify` rate                                             | CF Phase 3                                 | Per-IP cap 10000 rpm; soft alert at 80%               |

### 10.2 Page targets

- **Primary**: PagerDuty service `cerniq-prod-onsite`.
- **Mirror**: Slack `#cerniq-ops` (webhook from PagerDuty).
- **Customer-facing**: `status.cerniq.io` updated by ops runbook
  on incidents that affect customer SLOs.
- **Email**: `security@cerniq.io` for vulnerability reports
  (`SECURITY.md` L7).

### 10.3 Runbooks

Detection signals point at runbook sections in `docs/RUNBOOK.md`. We
do not duplicate runbook content here. The cross-reference table:

| Detection                    | Runbook section                             |
| ---------------------------- | ------------------------------------------- |
| Audit chain break            | RUNBOOK § "Audit chain break"               |
| Verify-key abuse             | RUNBOOK § "Suspected verify-key compromise" |
| Spend-guard Redis outage     | RUNBOOK § "Redis hot-path failure"          |
| BATE score collapse on agent | RUNBOOK § "Agent under attack"              |
| Mass JWKS verify failures    | RUNBOOK § "JWKS rotation incident"          |
| Webhook subscriber outage    | RUNBOOK § "Webhook delivery escalation"     |

---

## 11. Postmortem of the v1 prototype

`/Users/money/Downloads/files (7)/cerniq-server.js` is the original
prototype that this entire codebase replaces. v2 inherits its API
shape but re-architects every security-critical control. Documenting
the original sins ensures we don't regress.

### 11.1 HMAC for everything

L120: `const CERNIQ_SIGNING_SECRET = new TextEncoder().encode('cerniq-audit-secret-replace-in-prod')`.

A single hardcoded HMAC secret was used for **policy tokens**
(L153, `alg: 'HS256'`), **request tokens** (L173, also `'HS256'`), and
**audit records** (L183, also `'HS256'`). The agent's Ed25519 keypair
was never used to sign anything; CERNIQ re-signed the token with its
own secret. That collapses the four-party trust model into a one-party
"CERNIQ knows everything" model — and means that anyone with the secret
(every developer in the project, the Git history, the bundled binary)
could forge any token of any kind.

**v2 fix:** §2.3 (three distinct asymmetric keys), §4.1 (algorithm
table), CLAUDE.md crypto rule (audited library only).

### 11.2 No `jti` cache → free replay

The v1 verify path checked `exp` and called it done. Any captured token
could be replayed for up to 60s. Layered defense (§7) is the v2
response.

### 11.3 TOCTOU on spend (the textbook case)

L505–527 read SUM, compared to limit, INSERTed. Two concurrent verifies
both passed and both inserted. §8.1–8.2 describe the fix.

### 11.4 Silent fallback on dependency failure

The v1 had no explicit failure mode. If `db.prepare` threw, Express
returned a 500 — but a partial verify (signature ok, spend write
failed) could leave the DB in an inconsistent state. CLAUDE.md
invariant 4 ("No silent failures") and §8.4 (fail-closed Redis) are
the v2 response.

### 11.5 No agent challenge-response at registration

L248–273 accepted any base64 string as `publicKey`. No proof that the
registering party held the corresponding private key. An attacker with
a stolen API key could pre-register _their_ keys under the victim
principal. v2 fix: M-003 challenge-response handshake before status
flips to `active`, threat T-06 in §3.2.

### 11.6 Plaintext-secret-equivalent dev key in source

L120 itself: a "secret" string committed to the repo. Even with the
"replace in prod" comment, it would have been the production secret on
the first deploy that forgot to set the env var. v2 fix:
`config/dev-bootstrap.ts` generates ephemeral keys at server start in
non-prod environments and refuses to start if `NODE_ENV === 'production'`
without all key material set.

---

## 12. Acceptance gates (extends existing)

The list in `docs/THREAT_MODEL.md` L67–78 stays. v2 adds:

- [ ] **argon2id migration** for API keys complete; bcrypt verify path
      still in place for existing keys; rehash-on-verify migration
      worker has run for ≥ 90 days.
- [ ] **JWKS endpoint live** at `/.well-known/jwks.json` with current + previous SVC_KEY and current AUDIT_KEY.
- [ ] **JWKS archive endpoint live** at `/.well-known/jwks-archive.json`
      with all historical AUDIT_KEYs back to genesis.
- [ ] **verifier-rp package on npm** (`@cerniq/verifier-rp`), Sigstore-
      signed release artifacts, fast-check property tests in CI.
- [ ] **fast-check property tests** for: token canonicalization,
      audit-chain prev-hash linkage under random shuffle, EdDSA verify
      against random tampered bytes returns false (not throws).
- [ ] **k6 load test in CI** for verify hot path: 1000 rps for 5
      minutes, p99 < 200 ms (Phase 1) / < 80 ms (Phase 3).
- [ ] **AUDIT_KEY rotation rehearsal** completed in staging, including
      the key-transition audit event and a third-party verifier
      reading both pre- and post-transition events.
- [ ] **Spend-guard chaos test**: kill Redis mid-verify, assert 503
      and zero `SpendRecord` rows from that window.
- [ ] **Tamper-detection test** (§9.3) in CI on every PR.
- [ ] **Replay test in CI**: same `jti` twice → second returns
      `INVALID_SIGNATURE` (Layer 3 verified) and verifier-rp also
      rejects (Layer 2 verified).
- [ ] **JWKS rotation rehearsal** completed in staging: rotate
      SVC_KEY, observe in-flight tokens still verify against previous
      key, new tokens verify against new key.
- [ ] **Sigstore Rekor pinning** for hourly Merkle roots (Phase 2 gate
      — not blocking GA but blocking SOC 2 Type II).
- [ ] **DR drill**: simulate KMS unavailability; verify all
      operations that depend on it (policy issuance, audit append)
      return 503 immediately rather than time out.
- [ ] **Cross-language audit verifier** demo (Python + Go) shipped
      alongside the TypeScript implementation; auditor can pick.

---

## 13. Open questions for the operator

These are decisions v2 deliberately does **not** make. Each blocks a
specific gate in §12.

1. **argon2id parameter set.** Recommended starting point per OWASP
   2023: `m = 19456 KiB, t = 2, p = 1`. Verify on production-tier
   hardware that login throughput meets SLO. Decision lives in
   `docs/decisions/argon2-params.md` (operator to write) and
   `apps/api/src/modules/auth/api-key.service.ts` (constants block).

2. **JWKS cache TTL exact value.** Recommended `max-age=300,
stale-while-revalidate=86400`. Trade-off: lower max-age means
   faster propagation of emergency rotation; higher swr means better
   resilience to CERNIQ being down. The 5-minute figure is the longest
   we'd accept a compromised key remaining trusted.

3. **AUDIT_KEY rotation cadence.** Recommended 365 days. SOC 2 commonly
   accepts annual; some EU AI Act conformity bodies prefer 6-month.
   Decide before SOC 2 Type II window.

4. **Post-quantum cutover trigger.** v1 §"PQ posture" describes the
   migration mechanics (dual-sign, 18-month window). The trigger
   criteria are not specified. Candidates: NIST PQ migration mandate
   for federal use, FIPS PQ profile finalized, observed cryptanalytic
   advance against Ed25519. Operator decision.

5. **Sigstore Rekor vs. self-hosted transparency log.** Rekor is the
   cheap path; a self-hosted CT-style log gives more control. SOC 2
   Type II will accept either with documented procedures.

6. **Tier-based hard caps** — agents per principal, policies per
   agent, webhooks per principal. Already flagged in CLAUDE.md
   "BLOCKED ON OPERATOR" #3. Affects D-02 and D-03 mitigations.

7. **Cold-start trust accelerator policy** — flagged in
   `docs/BATE_ALGORITHM.md` §5; affects S-01 and S-05.

8. **BATE signal weight final values** — flagged in
   `docs/BATE_ALGORITHM.md` §4; affects S-05.

9. **Cyber-insurance binder** — Embroker / Coalition (mentioned in
   v1 acceptance gates L77). Operator must confirm before launch.

---

## Appendix A — Cross-references

- CLAUDE.md (architecture invariants) — `/Users/money/Desktop/CERNIQ/CLAUDE.md` L19–52.
- `docs/SECURITY.md` (denial precedence, key handling) — L26–104, L108–129.
- `docs/THREAT_MODEL.md` (v1, this doc supersedes) — L1–79.
- `docs/ARCHITECTURE.md` (system architecture) — L67–84 (verify portability), L168–183 (audit chain).
- `docs/spec/CERNIQ_API_SPEC.yaml` (contract) — `/v1/verify`, `/v1/agents/register`.
- `docs/spec/03_TECHNICAL_SPEC.md` (master tech spec).
- `docs/BATE_ALGORITHM.md` (trust scoring) — L59–91 (signal weights), L95–115 (cold start).
- `packages/types/src/constants.ts` — `DENIAL_REASON_PRECEDENCE` L53–63, `REDIS_KEY` L30–39, TTL bounds L22–23.
- `packages/types/src/schemas.ts` — wire shapes.
- `packages/types/src/errors.ts` — error envelope, `ERROR_CODE` L14–24.
- `packages/sdk-ts/src/crypto.ts` — JWT signing ground truth, L26 (header), L44–70 (sign).
- v1 prototype (post-mortemed) — `/Users/money/Downloads/files (7)/cerniq-server.js`.

## Appendix B — Module-to-mitigation index

For peer Claude sessions claiming work in `WORK_BOARD.md`:

| Module                        | Threats addressed                                     |
| ----------------------------- | ----------------------------------------------------- |
| M-002 (auth, api-key)         | S-02, E-05                                            |
| M-003 (identity / handshake)  | T-06                                                  |
| M-004 (policy, JWKS)          | S-04, T-05, R-02                                      |
| M-005 (verify hot path)       | S-03, T-01, T-04, E-02, E-04                          |
| M-006 (audit chain)           | T-02, T-03, R-01, R-03, I-05 (tampering, repudiation) |
| M-007 (BATE)                  | S-05, I-06                                            |
| M-008 (webhooks)              | S-06, R-04, D-06, E-06                                |
| M-009 (rate limit)            | D-01                                                  |
| M-013 (reconciliation cron)   | T-04                                                  |
| M-016 (verifier-rp library)   | E-03, E-04, replay layer 2                            |
| M-018 (this doc + arch audit) | meta                                                  |
