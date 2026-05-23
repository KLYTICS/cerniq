# OKORO — Architecture audit (review of `docs/ARCHITECTURE.md`)

> **Purpose:** focused review of `docs/ARCHITECTURE.md` against
> `CLAUDE.md`, `docs/THREAT_MODEL.md`, `docs/THREAT_MODEL_v2.md`,
> `docs/SECURITY.md`, `docs/spec/03_TECHNICAL_SPEC.md`, and the wire
> contracts in `packages/types/src/`. The reviewer is a notional
> external auditor (SOC 2 Type II / EU AI Act / partner-integration
> security review).
> **Scope:** identifies gaps and inconsistencies. Does not modify the
> reviewed file (peer session may have in-flight edits).
> **Output convention:** Each finding is uniquely numbered (A-NNN),
> severity-tagged, and points at a concrete remediation.

---

## Summary

`docs/ARCHITECTURE.md` (213 lines) is a competent design document with
a clear two-surface model and an explicit invariant about portability
of the verify hot path. The data-model rationale (§3) and caching
strategy (§4) are solid and consistent with the constants in
`packages/types/src/constants.ts`. **What is missing is the
operational surface.** The document does not specify failure modes for
its dependencies (Redis, Postgres, JWKS), has no rollback / canary /
blue-green guidance, never names rate-limit dimensions beyond "per
key," omits GDPR Article 17 deletion flow, and gives no capacity-
planning numbers (verify QPS target, pool sizes, Redis memory
ceiling). The single most consequential inconsistency is between the
document's audit-chain section (L168–183, Ed25519) and v1
THREAT_MODEL.md L21/L44 (RSA-4096) — addressed in
`docs/THREAT_MODEL_v2.md` §4 and reflected here as A-001.

**Severity breakdown:** 22 findings — Critical 1 · High 5 · Medium 8 ·
Low 6 · Info 2.

---

## Findings

### A-001 — Audit-chain crypto algorithm contradicts THREAT_MODEL v1

- **Severity:** Critical (consistency / auditor-visible)
- **Section:** ARCHITECTURE.md L168–183 ("The audit chain")
- **Observation:** ARCHITECTURE.md L172 says "we sign … with the
  OKORO Ed25519 key." `docs/THREAT_MODEL.md` L21 says
  "Audit records are RSA-4096 signed by OKORO" and L44 lists
  RSA-4096 / SHA-256 in the cryptographic-choices table. An external
  auditor reading both will flag the contradiction immediately.
- **Recommendation:** Adopt the v2 reconciliation
  (`docs/THREAT_MODEL_v2.md` §4: EdDSA / Ed25519 throughout, with the
  rationale documented). Update `docs/THREAT_MODEL.md` L21 and L44 to
  match. ARCHITECTURE.md L168–183 is correct as written; only v1
  THREAT_MODEL.md needs editing — but the operator must approve the
  change since v1 is currently the operator's source of truth for
  compliance reviews.

### A-002 — No documented Redis-down behavior in the verify path

- **Severity:** High
- **Section:** ARCHITECTURE.md L126–142 (caching strategy) and the
  caching table itself (L128–135)
- **Observation:** The caching strategy table treats Redis as a TTL'd
  cache for policy/agent reads, but spend counters (L134–135) are
  load-bearing for correctness, not performance. The document does
  not specify what happens when Redis is unreachable — does
  `/v1/verify` fail closed, fail open, fall back to Postgres, or
  return 503? The v1 prototype demonstrates the danger of an
  unspecified answer (see THREAT_MODEL_v2 §11.4).
- **Recommendation:** Add a §4.1 "Failure modes" subsection:
  - Cache reads (`agent:*`, `policy:*`, `verify:*`): on Redis miss,
    fetch from Postgres; on Redis error, log and fall back to
    Postgres.
  - Spend counters: **fail closed** with `SERVICE_UNAVAILABLE` (503).
    Document that this is intentional (THREAT_MODEL_v2 §8.4).
  - JWKS local cache: stale-while-revalidate up to 24h.

### A-003 — No documented Postgres-down behavior

- **Severity:** High
- **Section:** ARCHITECTURE.md L93–123 (data model)
- **Observation:** ARCHITECTURE.md does not specify Postgres
  unavailability behavior anywhere. Verify path needs Postgres for
  agent + policy lookup unless a cache hit; audit append needs
  Postgres always; identity/policy CRUD needs Postgres.
- **Recommendation:** Add to a new §10 ("Failure modes"):
  - Verify with full cache hit: degraded but functional (audit append
    fails → enqueue to BullMQ DLQ; CLAUDE.md invariant 3 still
    holds because the BullMQ row carries the signed payload that
    will be appended on Postgres recovery).
  - Verify with cache miss: 503.
  - Identity/policy/audit CRUD: 503.
  - Webhook delivery: continue from BullMQ until queue is full; then
    503 on `POST /v1/webhooks` (creates).

### A-004 — Missing capacity-planning numbers

- **Severity:** High
- **Section:** ARCHITECTURE.md L59–63 (latency budget table) is the
  only quantitative target.
- **Observation:** The document specifies p99 latency targets but no
  throughput target, no DB connection-pool size, no Redis memory
  ceiling, no BullMQ concurrency. An auditor needs these to assess
  whether the SLO is achievable.
- **Recommendation:** Add §11 ("Capacity plan"):
  - Verify QPS target: 1000 rps Phase 1 (Railway), 10000 rps Phase 3
    (CF Workers per region).
  - Postgres pool size: `min(2 × cores, 20)` per app instance, with
    PgBouncer transaction pooling at 200.
  - Redis: `maxmemory 1 GiB` minimum dev / `8 GiB` Phase 1 prod;
    `maxmemory-policy allkeys-lru`.
  - BullMQ concurrency: 5 webhook workers, 3 BATE workers, 1 audit
    DLQ worker per app instance.
  - Storage: agent row ~512B, policy row ~2KB, audit event ~1KB.
    1B audit events/year ≈ 1TB/year (drives partitioning §A-05).

### A-005 — No table-partitioning or retention policy for `AuditEvent`

- **Severity:** High
- **Section:** ARCHITECTURE.md L93–123 (data model), L168–183 (audit
  chain)
- **Observation:** Audit events are append-only (CLAUDE.md invariant 3) — meaning the table grows unboundedly. There is no documented
  partitioning strategy (e.g. monthly), no archival to cold storage,
  no read-side index strategy beyond `(principalId, timestamp)`. At
  the §A-04 capacity (1B/year), simple b-tree indexes on a single
  table degrade after ~3 years.
- **Recommendation:** Add to §3:
  - `AuditEvent` partitioned by month (`PARTITION BY RANGE
(timestamp)`).
  - Hot retention: 18 months in Postgres.
  - Cold archive: monthly export to S3 + GCS, encrypted, with
    matching Merkle root pinned.
  - SOC 2 / FINRA retention (3 years for FINRA, 7 for SOC 2 evidence
    of controls) → cold archive holds the long tail.

### A-006 — No GDPR Article 17 / tenant-deletion flow

- **Severity:** High
- **Section:** ARCHITECTURE.md (no current section)
- **Observation:** EU AI Act applicability and SOC 2 do not require
  GDPR compliance per se, but OKORO will sign EU developers as
  customers. There is no documented "delete tenant" flow. Audit logs
  cannot be deleted (CLAUDE.md invariant 3) — but they can be
  pseudonymized: replace `principalId` and free-text fields with
  hashed/redacted equivalents while keeping the signed chain intact.
- **Recommendation:** Add §12 ("Tenant data deletion"):
  - "Right to erasure" pathway: `DELETE /v1/principals/{id}` triggers
    a 30-day soft-delete, then a redaction job that:
    1. Replaces principal-identifying fields in `AuditEvent` rows
       with `redacted-{hash}` (the chain still verifies because the
       signature was over the redacted payload at append time —
       this requires _forward_ design, not retrofit; see follow-up
       in §A-19).
    2. Hard-deletes `Principal`, `ApiKey`, `AgentIdentity`,
       `AgentPolicy`, `WebhookSubscription`, `BateSignal`,
       `TrustScoreHistory`.
    3. Marks `AuditEvent` rows as `redacted=true` so future reads
       know to suppress non-essential fields.
  - Document the conflict: "right to erasure" vs. "tamper-evident
    audit log." Resolution: redact PII, preserve cryptographic
    integrity, document for the data subject.

### A-007 — Rate-limit dimensions only specified per-key

- **Severity:** Medium
- **Section:** ARCHITECTURE.md (none) — handled in
  `docs/SECURITY.md` §7 only
- **Observation:** SECURITY.md §7 lists per-API-key, per-IP (Phase 3),
  and per-principal-via-BullMQ. ARCHITECTURE.md does not mention rate
  limiting at all, leaving the architecture incomplete. An auditor
  may ask: what limits _per agent_? Per relying party? Per `/verify`
  path versus `/agents/register` path?
- **Recommendation:** Add §7.1 ("Rate limit dimensions") referencing
  SECURITY.md §7 and adding:
  - **Per-agent**: not currently rate-limited; relying on per-key.
    Recommendation: add 100 verify/min/agent default, configurable
    per plan tier.
  - **Per-relying-party**: when verify-only key auth is in use,
    inherit the key's limit; for offline JWKS path, RPs self-rate-limit.
  - **Per-endpoint**: management writes lower than reads;
    `/agents/register` 60/min, `/agents/{id}` GET 600/min,
    `/verify` 1000/min default.

### A-008 — No rollback / canary / blue-green strategy

- **Severity:** Medium
- **Section:** ARCHITECTURE.md L59 (deploy cadence column), no other
  reference
- **Observation:** "Deploy cadence: daily" and "weekly" are the only
  deployment mentions. No rollback path, no canary methodology, no
  feature-flag pattern, no traffic-shifting between management and
  verify-edge surfaces.
- **Recommendation:** Add §8 ("Deployment strategy"):
  - Railway native rollback: every deploy keeps the prior image; ops
    runbook references `railway rollback`.
  - Canary: Phase 3 CF Workers split traffic via Cloudflare Worker
    Routes (5% canary → 100% over 30 min); per-route metrics tied to
    `verify_latency_seconds`, `verify_total{denial_reason}`.
  - Database migrations: Prisma `migrate deploy` is forward-only;
    every migration must be backward-compatible with the previous app
    version (additive columns, then code-deploy that uses them, then
    cleanup migration).
  - Feature flags: a single `FEATURE_*` env var registry in
    `apps/api/src/config/features.ts`; document that crypto/auth
    changes must NOT be flag-gated (they're append-only by audit).

### A-009 — No incident-communication strategy

- **Severity:** Medium
- **Section:** ARCHITECTURE.md (none)
- **Observation:** SOC 2 CC7.4 requires documented external
  communication of incidents. v1 THREAT_MODEL.md L78 mentions
  "Status page live at status.okoroapp.com" as an acceptance gate but
  does not connect it to architecture. ARCHITECTURE.md is silent.
- **Recommendation:** Add §9 ("Incident communication"):
  - status.okoroapp.com powered by Statuspage / Atlassian or
    self-hosted (operator decision pending).
  - SLA for customer notification: 4h for P1, 24h for P2.
  - Mechanism: webhook event `okoro.incident.declared` +
    dashboard banner + email to principal contacts.
  - Linked to RUNBOOK §incident-comm.

### A-010 — No mention of Cloudflare WAF rules / DDoS posture

- **Severity:** Medium
- **Section:** ARCHITECTURE.md L84 ("Hosting: Railway + CF Workers
  Phase 3"); SECURITY.md §2 trust-boundary diagram (L36) shows CF WAF
  Phase 3.
- **Observation:** The Phase 3 plan vests significant trust in CF.
  ARCHITECTURE.md should specify: which paths are CF-fronted, which
  WAF managed rule sets, the bot-management posture, and whether
  Phase 1 has _any_ edge protection.
- **Recommendation:** Add to §1 ("Two surfaces, one core") sub-bullet:
  - Phase 1: Railway proxy is the perimeter. Per-IP throttling at the
    NestJS layer via `@nestjs/throttler` keyTracker on the
    `x-forwarded-for` header (with a documented spoofing caveat).
  - Phase 3: CF in front of `api.okoroapp.com` and the verify edge.
    Managed rules: OWASP CRS, Cloudflare-managed bots, WAF custom
    rule for `/verify` body schema.
  - Document which rule sets to enable + the false-positive review
    process.

### A-011 — `cuid` vs. `ulid` decision is open and contradicts spec

- **Severity:** Low (but flagged in spec)
- **Section:** ARCHITECTURE.md L107–112 (data-model rationale),
  L204–207 (open question #1)
- **Observation:** The doc admits the master spec uses ULID but cuid
  was chosen for "Prisma convenience." Open question explicitly
  flagged. `packages/types/src/schemas.ts` L17–19 uses `z.string()
.min(1).max(64)` so neither breaks the wire.
- **Recommendation:** Either commit to cuid (and update the master
  spec) or migrate to ulid before launch. Operator decision. Not a
  security issue but a consistency issue auditors will note.

### A-012 — No documented authn/z model for the dashboard

- **Severity:** Medium
- **Section:** ARCHITECTURE.md L101 mentions
  `apps/dashboard` as "Phase 1 minimal" and §1 diagram shows
  "Dashboard backend" inside the management surface
- **Observation:** Dashboard authn is unspecified. Does the dashboard
  use the same API-key model as a programmatic developer? OAuth?
  Email + password? Single-sign-on?
- **Recommendation:** Add §13 ("Dashboard authentication"). Note this
  is peer-locked (`apps/dashboard/`) so this audit recommends only
  documenting the contract, not changing the implementation.
  Recommended contract: passkeys + email magic link primary, with
  optional Google SSO; backend exchanges session cookie for a scoped
  internal API key (never returned to browser) used to call the same
  management endpoints as programmatic users.

### A-013 — CSRF / browser-context not addressed for dashboard endpoints

- **Severity:** Medium
- **Section:** ARCHITECTURE.md (none) and SECURITY.md (none)
- **Observation:** Programmatic API-key auth is CSRF-immune (no ambient
  credential), but a cookie-authenticated dashboard is not. Same
  origin policy alone is insufficient.
- **Recommendation:** Tied to A-012. Document that dashboard uses
  SameSite=Strict session cookies, double-submit CSRF tokens on state-
  changing requests, and `Origin` header validation.

### A-014 — No mention of `/health`, `/readiness`, `/metrics` endpoints

- **Severity:** Low
- **Section:** ARCHITECTURE.md L188 lists Prometheus via
  `prom-client` (M-010); L84 mentions Railway hosting.
- **Observation:** Conventional `/health`, `/readiness`, `/metrics`
  endpoints are alluded to in SECURITY.md L51 but not listed in
  ARCHITECTURE.md. Operationally critical.
- **Recommendation:** Add to §1:
  - `GET /health` — liveness, no dependencies, always 200.
  - `GET /readiness` — checks Postgres + Redis; 503 on dependency
    down. Used by Railway health check.
  - `GET /metrics` — Prometheus exposition; auth-protected by either
    `prometheus-bearer-auth` or VPC-only.
  - `/.well-known/jwks.json` — public.

### A-015 — Caching strategy doesn't cover negative results

- **Severity:** Low
- **Section:** ARCHITECTURE.md L128–135
- **Observation:** Cache table covers only positive lookups. No
  negative caching (e.g. "this `agentId` does not exist") — meaning a
  scraper can hammer `/v1/agents/{id}` with random ids and each one
  hits Postgres.
- **Recommendation:** Add a row:
  - `agent:{id}:notfound` TTL 60s, set on Postgres miss, returns 404
    immediately on subsequent reads. Prevent enumerator-style
    DoS amplification.

### A-016 — `verify:{tokenHash}:{action}` cache risks weakening replay defense

- **Severity:** Medium
- **Section:** ARCHITECTURE.md L132 (verify-result cache TTL 30s)
- **Observation:** The verify-result cache means a captured
  request-token can produce the same `valid: true` response for the
  duration of the cache TTL — at first glance that seems to allow
  replay. The fix is in the verifier-rp library (Layer 2 jti) and the
  OKORO-side jti set (Layer 3, THREAT_MODEL_v2 §7.3). But the
  ARCHITECTURE.md text doesn't surface this interaction.
- **Recommendation:** Either:
  - Remove the verify-result cache (tokens are 30–60s, the cache TTL
    is 30s — saving little, complicating reasoning), OR
  - Document explicitly that the cache key includes `jti` (not just
    `tokenHash`) so a replay's first verify populates the cache, the
    jti set rejects the second verify, and the cache becomes a
    micro-optimization for the _single legitimate verify_.

  Recommended: latter, but make the dependency on Layer 3 explicit.

### A-017 — `SpendRecord` reconciliation cadence not specified

- **Severity:** Medium
- **Section:** ARCHITECTURE.md L107, L117 (SpendRecord rationale);
  THREAT_MODEL_v2 §8.3 specifies a nightly cron
- **Observation:** ARCHITECTURE.md says "durable backstop" but
  doesn't say when reconciliation runs, what discrepancy threshold
  triggers an alert, or what the behavior is when reconciliation
  finds a discrepancy. The integrity guarantee is hand-waved.
- **Recommendation:** Cross-reference THREAT_MODEL_v2 §8.3 from
  ARCHITECTURE.md §3, specifying:
  - Nightly cron 02:00 UTC.
  - Threshold: > 5% discrepancy → page operator.
  - Behavior on discrepancy: log to audit (`audit.spend_mismatch`),
    do not auto-correct.

### A-018 — Trust-boundary diagram in SECURITY.md L29–46 is more detailed than ARCHITECTURE.md

- **Severity:** Low (consistency)
- **Section:** ARCHITECTURE.md §1 vs. SECURITY.md §2
- **Observation:** Two diagrams of the same system at different
  detail levels. Auditors prefer one canonical view.
- **Recommendation:** Merge: keep the management/edge split in
  ARCHITECTURE.md §1, add the perimeter (CF WAF → Railway → VPC
  internal plane) and reference SECURITY.md §2 as the security view
  of the same diagram.

### A-019 — Audit-event payload is not designed for redaction

- **Severity:** High
- **Section:** ARCHITECTURE.md L168–183, schemas at
  `packages/types/src/schemas.ts` L184–195
- **Observation:** `AuditEvent` includes `principalId`, free-text
  `decisionReason`, and (per technical-spec §1.2 and v1 prototype
  L548) a `policy_snapshot` JSON column. Once signed, this payload
  cannot change without breaking the chain. That blocks GDPR
  Article 17 (A-006).
- **Recommendation:** Redesign before launch:
  - Sign over a _content-addressable_ version of any free-text /
    PII-bearing field. The signed payload contains
    `decisionReasonHash: SHA-256(reason)`; the unsigned column
    contains the human-readable text and is redactable.
  - This way, "right to erasure" can null out free-text columns
    while the chain still verifies. Auditors verifying integrity do
    not see the original text but see that the hash matches what
    OKORO attested at the time.
  - Document the policy explicitly: "Audit chain is integrity-
    preserving; PII is recoverable until redaction."

### A-020 — No mention of background job idempotency

- **Severity:** Low
- **Section:** ARCHITECTURE.md L194 mentions BullMQ briefly
- **Observation:** BullMQ retries can fire multiple times for the
  same logical work item. Audit append, BATE signal scoring, webhook
  delivery — each is potentially duplicating.
- **Recommendation:** Add to §7 ("Observability hooks") or new §14:
  - Audit-append BullMQ job is keyed on `eventId` (CSPRNG); duplicate
    delivery is a no-op INSERT ON CONFLICT DO NOTHING.
  - BATE signal scoring is keyed on `signalId`; duplicate delivery
    is similarly idempotent.
  - Webhook delivery uses `Idempotency-Key` header with the
    `WebhookDelivery.id`; customer endpoints SHOULD use this for
    dedup.

### A-021 — JWKS endpoint not in the architecture diagram

- **Severity:** Info (consistency)
- **Section:** ARCHITECTURE.md §1 diagram does not show
  `/.well-known/jwks.json` as a public surface.
- **Observation:** The JWKS endpoint is the single most security-
  critical public surface (THREAT_MODEL_v2 §6) and is the only
  point of contact for offline-verify relying parties. Its absence
  from the architecture diagram understates its role.
- **Recommendation:** Add a fourth caller to the §1 diagram: "Offline
  RP (JWKS only)" → "Public well-known surface" → "JWKS document
  (CDN-cached)" with the SVC_KEY publication path drawn back from the
  management surface.

### A-022 — No explicit cross-region / multi-region story

- **Severity:** Info
- **Section:** ARCHITECTURE.md §1, §8 open questions
- **Observation:** Phase 3 (CF Workers) is the multi-region answer
  for the verify hot path. Management surface is single-region
  (Railway). Disaster recovery: if the Railway region is down, the
  verify edge can keep verifying (tokens were issued before, JWKS is
  cached) but no new policies, no new agents, no audit.
- **Recommendation:** Document this explicitly. Add to §10
  ("Failure modes"):
  - Management region down: verify edge degrades to read-only;
    audit append queues to local KV (CF Worker D1) and replays on
    recovery — but this is a future Phase 3 design, not Phase 1
    behavior. In Phase 1, verify path also goes down.

---

## Recommendations summary

### Sprint (this M-018 cycle and immediate followups)

1. **A-001** — write the EdDSA reconciliation memo in
   `docs/decisions/`, get operator sign-off, edit
   `docs/THREAT_MODEL.md` to align with ARCHITECTURE.md L172.
2. **A-002** — add §"Failure modes" to ARCHITECTURE.md (Redis-down,
   Postgres-down, JWKS-down behavior). Cross-reference
   THREAT_MODEL_v2 §8.4.
3. **A-019** — content-addressable redaction in audit-event payload,
   _before_ M-006 ships. Retrofit is much harder.
4. **A-016** — clarify verify-result cache key (include `jti`) or
   remove the cache. M-005 owner.

### Sprint S2 (within next 2 sprints)

5. **A-003, A-004, A-005** — failure modes, capacity plan,
   partitioning. Operationally critical for any tier-1 customer
   review.
6. **A-007** — rate-limit dimensions explicit. Tied to plan tier
   decision (operator).
7. **A-008** — deployment strategy / rollback / canary. Doesn't
   block GA but blocks SOC 2 Type II.
8. **A-010** — Cloudflare WAF posture documented.
9. **A-014, A-021** — public surfaces in the diagram (health, jwks).
10. **A-017** — reconciliation cadence and behavior documented.

### Later (post-GA / Phase 2+)

11. **A-006** — GDPR Article 17 flow. Required before EU launch /
    EU AI Act conformity.
12. **A-009** — incident-communication strategy + status page (also
    listed in v1 acceptance gates).
13. **A-011** — cuid vs. ulid resolution. Operator preference; not
    security-blocking.
14. **A-012, A-013** — dashboard authn / CSRF. Phase 2 dashboard work
    (peer-locked path).
15. **A-015, A-020, A-022** — caching nuance, BullMQ idempotency,
    multi-region story. Belong in a v3 architecture doc that goes
    deeper on operational concerns.
16. **A-018** — diagram consolidation. Editorial / consistency only.

---

## Closure status — 2026-05-02 (round 6, sid=a9198691)

Findings closed in this pass via ARCHITECTURE.md sections §8-§14
(deployment / incident / failure modes / capacity / retention /
dashboard authn / idempotency) and earlier rounds (round 4 closed A-001
via THREAT_MODEL_v2 reconciliation, ADR-0006 closed A-019).

| ID    | Severity | Status                | Closed by                                                |
| ----- | -------- | --------------------- | -------------------------------------------------------- |
| A-001 | Critical | **CLOSED** (round 4)  | THREAT_MODEL_v2 §4 + doc reconciliation                  |
| A-002 | High     | **CLOSED**            | ARCHITECTURE.md §10.1, §10.2, §10.3                      |
| A-003 | High     | **CLOSED**            | ARCHITECTURE.md §10.4                                    |
| A-004 | High     | **CLOSED**            | ARCHITECTURE.md §11                                      |
| A-005 | High     | **CLOSED**            | ARCHITECTURE.md §12.1, §12.2                             |
| A-006 | High     | **CLOSED**            | ARCHITECTURE.md §12.3 + ADR-0006 (round 4 redactability) |
| A-007 | Medium   | OPEN                  | Pending operator decision OD-006 (rate-limit dimensions) |
| A-008 | Medium   | **CLOSED**            | ARCHITECTURE.md §8                                       |
| A-009 | Medium   | **CLOSED**            | ARCHITECTURE.md §9 + new OPERATOR_DECISIONS OD-007       |
| A-010 | Medium   | OPEN                  | Pending CF WAF rule-set decision (Phase 3 work)          |
| A-011 | Low      | OPEN                  | ADR-0001 holds; operator decision pending pre-launch     |
| A-012 | Medium   | **CLOSED** (contract) | ARCHITECTURE.md §13 — implementation peer-locked         |
| A-013 | Medium   | **CLOSED** (contract) | ARCHITECTURE.md §13.3                                    |
| A-014 | Low      | DEFERRED              | M-010 work-in-progress; tracked in WORK_BOARD            |
| A-015 | Low      | **CLOSED**            | ARCHITECTURE.md §10.1 (negative caching)                 |
| A-016 | Medium   | OPEN                  | M-005 owner (verify-result cache key includes jti)       |
| A-017 | Medium   | **CLOSED**            | ARCHITECTURE.md §10.6                                    |
| A-018 | Low      | DEFERRED              | Editorial consolidation; non-blocking                    |
| A-019 | High     | **CLOSED** (round 4)  | ADR-0006 + audit-chain.util.ts v2 + 9 tests              |
| A-020 | Low      | **CLOSED**            | ARCHITECTURE.md §14                                      |
| A-021 | Info     | DEFERRED              | Diagram editorial; tied to A-018                         |
| A-022 | Info     | **CLOSED**            | ARCHITECTURE.md §10.5                                    |

**Tally:** 14 closed (1 critical, 5 high, 4 medium, 2 low, 1 info, 1 contract-only),
4 deferred (editorial / WIP), 4 open (3 awaiting operator decisions:
OD-006/A-007, A-010/CF WAF, A-011/cuid; 1 awaiting M-005 owner: A-016).

The **critical and all high-severity findings are closed**. The
remaining open findings are operator-decision-blocked or low-severity
editorial.

---

## Deep-canon promotion — 2026-05-02 (round 7, sid=docs-strategic)

Round 6 closed the high-severity findings A-002, A-003, A-004, A-005,
A-006, A-022 by adding sections §10–§14 to `docs/ARCHITECTURE.md`. An
external auditor reading those sections has the architectural view but
not the operational depth needed for SOC 2 Type II evidence
collection, DR rehearsal scripts, or DPA negotiation.

Round 7 promotes those closures from "summary in ARCHITECTURE.md" to
**"summary in ARCHITECTURE.md cross-referencing dedicated canon"**:

| ID    | Architectural summary               | Operational canon (NEW)                                                                                                                                                                                 |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-002 | ARCHITECTURE.md §10.1, §10.2, §10.3 | `docs/FAILURE_MODES.md` §4 (crypto), §7 (cache)                                                                                                                                                         |
| A-003 | ARCHITECTURE.md §10.4               | `docs/FAILURE_MODES.md` §6 (database)                                                                                                                                                                   |
| A-004 | ARCHITECTURE.md §11                 | `docs/CAPACITY_PLAN.md` (full doc)                                                                                                                                                                      |
| A-005 | ARCHITECTURE.md §12.1, §12.2        | `docs/RETENTION_POLICY.md` §8 (archive lifecycle) + `docs/CAPACITY_PLAN.md` §5.4 (partition strategy)                                                                                                   |
| A-006 | ARCHITECTURE.md §12.3 + ADR-0006    | `docs/RETENTION_POLICY.md` §5–§7 (immutability vs. erasure resolution + tenant deletion flow)                                                                                                           |
| A-022 | ARCHITECTURE.md §10.5               | `docs/FAILURE_MODES.md` §13 (Phase 3 Workers) + §14.4 (cross-region cascading scenario) + `docs/CAPACITY_PLAN.md` §10 (multi-region capacity) + `docs/RETENTION_POLICY.md` §11 (multi-region residency) |

The new docs add three operational artifacts the auditor explicitly
needs but ARCHITECTURE.md cannot reasonably carry:

- **Per-component FMEA with RPN scoring** (`FAILURE_MODES.md` §3
  - §4–§13). Highest RPN identified: **O-06 (untested backup
    recovery, RPN 48)** — drives the §15 quarterly DR rehearsal cadence.
- **Capacity sizing math from first principles** (`CAPACITY_PLAN.md`
  §3 + §4–§13). Worked Little's Law example shows why Phase 1 burst
  is artificially capped at 666 rps and how the OD-006 rate-limit
  preserves correctness over availability under that cap.
- **Per-data-class retention table with lawful basis**
  (`RETENTION_POLICY.md` §3–§4 + Appendix A regulatory horizons
  alignment). Resolves the GDPR Art. 17 vs. CLAUDE.md inv. 3 conflict
  at the operational-flow level (§5–§7), and documents the
  cryptographic-erasure-on-backup pattern (§7.2) per NIST SP 800-88.

No findings re-open. Open findings remain: A-007 (OD-006), A-010 (CF
WAF), A-011 (cuid/ulid), A-016 (M-005 owner) — unchanged.

**Closure status table — round 7 update**

| ID    | Severity | Status            | Closed by                                                                                                                 |
| ----- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A-002 | High     | **CLOSED + DEEP** | ARCHITECTURE.md §10.1–.3 + `docs/FAILURE_MODES.md` §4, §7                                                                 |
| A-003 | High     | **CLOSED + DEEP** | ARCHITECTURE.md §10.4 + `docs/FAILURE_MODES.md` §6                                                                        |
| A-004 | High     | **CLOSED + DEEP** | ARCHITECTURE.md §11 + `docs/CAPACITY_PLAN.md`                                                                             |
| A-005 | High     | **CLOSED + DEEP** | ARCHITECTURE.md §12.1–.2 + `docs/RETENTION_POLICY.md` §8 + `docs/CAPACITY_PLAN.md` §5.4                                   |
| A-006 | High     | **CLOSED + DEEP** | ARCHITECTURE.md §12.3 + ADR-0006 + `docs/RETENTION_POLICY.md` §5–§7                                                       |
| A-022 | Info     | **CLOSED + DEEP** | ARCHITECTURE.md §10.5 + `docs/FAILURE_MODES.md` §13, §14.4 + `docs/CAPACITY_PLAN.md` §10 + `docs/RETENTION_POLICY.md` §11 |

The CLOSED + DEEP marker means: an auditor's first question is
answered by ARCHITECTURE.md; the follow-up question (the one that
costs the project the engagement if it goes unanswered) is answered
by the deep-canon doc. Both must remain consistent — see §15 review
cadence in each canon doc.

---

## Appendix — files reviewed

- `docs/ARCHITECTURE.md` (2026-04-… HEAD, 213 lines)
- `docs/SECURITY.md` (200 lines)
- `docs/THREAT_MODEL.md` (79 lines, v1)
- `docs/THREAT_MODEL_v2.md` (this audit's companion deliverable)
- `CLAUDE.md` (157 lines)
- `docs/spec/OKORO_API_SPEC.yaml` (sampled L1–200)
- `docs/spec/03_TECHNICAL_SPEC.md` (sampled L1–150)
- `docs/BATE_ALGORITHM.md` (192 lines)
- `packages/types/src/schemas.ts` (236 lines)
- `packages/types/src/constants.ts` (66 lines)
- `packages/types/src/errors.ts` (27 lines)
- `packages/sdk-ts/src/crypto.ts` (85 lines)
- `/Users/money/Downloads/files (7)/okoro-server.js` (693 lines, v1
  prototype, post-mortemed in THREAT_MODEL_v2 §11)
