# ADR-0021 — Cloudflare edge surface in the AEGIS → Okoro rename

**Status**: proposed
**Date**: 2026-05-21
**Deciders**: operator (Erwin Kiess-Alfonso) — operator already confirmed two
framing decisions on 2026-05-21:
(a) the rename is a **hard cutover** driven by a separate agent, not a
dual-issuer dance, and
(b) the Cloudflare edge surface is **deferred** until the API + SDK rename
is stable.
**Builds on**: ADR-0004 (denial precedence), ADR-0007 (transactional outbox),
ADR-0017 (intent runtime issuance), ADR-0020 (cross-project agent orchestrator)
**Related**: `workers/cf-verify/**`, `WORK_BOARD.md` (M-CFV-rename to be filed
when the edge phase opens), `OPERATOR_DECISIONS.md` (production
`AEGIS_API_BASE_URL` and Cloudflare zone ownership are still operator-owned)

> **Reader note**: this ADR was seeded from an operator question — _"how can
> we make Okoro be incorporated for instance Cloudflare?"_ — during the
> AEGIS → Okoro brand cutover. A read-only Phase A audit of
> `workers/cf-verify/` produced an inventory of every brand-coupled identifier
> in the worker and the precise risk windows during which a repo-wide
> rename can break edge verification. The decisions below sequence the edge
> rename so it lands _after_ the API/SDK cutover is provably stable and never
> in the same release window. No code in `workers/` is edited by this ADR.

## Context

The operator is renaming AEGIS to **Okoro**. A separate Claude session is
executing a hard cutover across the repository. The Cloudflare worker at
`workers/cf-verify/` is the one piece of infrastructure that customers don't
redeploy themselves — it lives at the edge under operator-owned DNS — and
therefore has a different reversibility profile from the rest of the rename.

### Audit findings (Phase A, read-only)

`workers/cf-verify/` is in **scaffold state**. The deploy script is guarded:

```jsonc
// workers/cf-verify/package.json
"deploy": "echo 'Phase 3 only — gated behind $5K AEGIS MRR. Edit me when ready.' && exit 1",
```

`wrangler.toml` has **no `[[routes]]` block**, so the worker is not bound to
any DNS zone yet. That removes the heaviest deferred-rename risk (a DNS flip
in lockstep with the API cutover). The remaining surface decomposes into
four bands:

1. **Brand-coupled identifiers — safe to rename with the cutover.**
   - Worker name: `aegis-cf-verify` in `wrangler.toml` → `okoro-cf-verify`
   - Workspace package: `@aegis/cf-verify` → `@okoro/cf-verify`
   - Workspace deps: `@aegis/types`, `@aegis/tsconfig` → `@okoro/*`
   - Commented-out D1 binding: `AEGIS_DB` / `aegis-edge` → `OKORO_DB` /
     `okoro-edge`

2. **Env vars and secrets — rename source, do not redeploy.**
   - Vars: `AEGIS_ORIGIN_URL`, `AEGIS_VERIFY_TIMEOUT_MS`
   - Secrets: `AEGIS_FALLBACK_API_KEY`, `AEGIS_AUDIT_PUBLIC_KEY_B64`
   - Mode flags: `AEGIS_EDGE_VERIFY_ENABLED`, `AEGIS_EDGE_VERIFY_SHADOW_MODE`
   - Documented but not yet wired: `AEGIS_DPOP_REQUIRED`,
     `AEGIS_MAX_TOKEN_AGE_SECONDS`, `AEGIS_DIVERGENCE_DATASET_BINDING`
   - Origin URL value: `https://api.aegislabs.io` — operator-owned, depends
     on the DNS decision (see D8 in OPERATOR_DECISIONS).

3. **Customer-visible response headers — wire-format, needs major bump.**
   - `X-AEGIS-Edge` (values: `edge-allow`, `edge-deny`, `forward`, `shadow`)
   - `X-AEGIS-Edge-Divergence` (values: `agree`, `diverge:<fields>`,
     `edge-forward:no-edge-decision`)
   - Request headers sent to origin: `X-AEGIS-Verify-Key`,
     `X-AEGIS-Edge-Forward`
   - These are the ONLY edge surfaces that a relying party may observe and
     log. Renaming them is wire-format and demands a coordinated SDK major
     bump, not a silent grep.

4. **Brand-neutral surfaces — DO NOT rename.**
   - KV key prefixes: `trust:`, `policy:`, `spend:` — opaque, no brand
   - KV binding name: `TRUST_KV` — local binding, no brand
   - Durable Object binding `RATE_LIMITER` / class `EdgeRateLimiter`
   - JWT `iss` claim handling — worker decodes `iss?` for forwarding hints
     but does **not** enforce the issuer string. Verification uses the
     cached agent's Ed25519 public key, not a brand-coupled trust anchor.
     This is structurally agnostic to the rename. Origin owns `aud`/`iss`
     enforcement (per `src/token.ts` lines 22-30).

### Risk windows the cutover agent must avoid

| Window                                   | What's true                                               | What breaks if we ignore it                                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API cutover lands, worker not redeployed | Source says `okoro`, deployed binary says `aegis`         | If operator manually redeploys before edge phase, `AEGIS_*` secrets in CF environment won't be read by renamed `OKORO_*` env-var reads. Worker fails closed at origin fallback. |
| Shadow-mode comparison during edge phase | Edge runs renamed code, origin runs renamed API           | Comparison is byte-clean because both sides agree on field names. Safe.                                                                                                         |
| Customer logging on `X-AEGIS-Edge`       | Renamed worker emits `X-OKORO-Edge`                       | Any customer parsing the old header for routing/alerts silently breaks. Wire-format change — must ride a SDK major bump.                                                        |
| Audit-chain pubkey rotation              | API may rotate the audit-chain signing key during cutover | Worker reads `AEGIS_AUDIT_PUBLIC_KEY_B64` (declared but not yet consumed in `src/`). When wired, transition needs both old and new anchors.                                     |

## Decision

### D1 — Edge rename is a separate PR, after API/SDK cutover lands

The Cloudflare worker rename ships as its own PR, after:

1. The API hard cutover lands on `main`.
2. The new `@okoro/*` SDK packages are published and a green parity suite
   exists against `@aegis/*` (or the old ones are deprecated).
3. At least 7 days of shadow-mode parity at production traffic (this is
   independent of the rename — it's existing Phase 3 m2 acceptance).

**Rejected alternative:** _rename worker source inside the API cutover PR._
The blast radius of the cutover PR is already very large. Bundling worker
source rename adds wire-format risk (headers) without buying any sequencing
benefit, because the deployed worker doesn't move regardless.

**Rejected alternative:** _rename and redeploy worker in the API cutover._
The deployed worker is the only piece customers don't redeploy. Coupling
two redeploys (origin API + edge worker) into one release window
synchronously is the kind of move that turns a 5-minute incident into a
40-minute one. Shadow-mode comparison needs the origin to be stable first.

### D2 — Repo-wide grep-rename of `workers/cf-verify/**` is GATED, not banned

The cutover agent **may** rename source in `workers/cf-verify/` provided:

- The `package.json` deploy script guard stays intact (do not change the
  guard text or exit code — that is the safety belt).
- Env-var reads are renamed in lockstep with `wrangler.toml` `[vars]`,
  `[[kv_namespaces]]`, and any `wrangler secret put` documentation in
  `README.md`. Half-rename (source says `OKORO_*`, wrangler still
  declares `AEGIS_*`) is a typecheck-pass / runtime-fail trap.
- Customer-visible header constants (`X-AEGIS-Edge`,
  `X-AEGIS-Edge-Divergence`) are **NOT** renamed in the cutover PR. They
  belong to D3.

**Rejected alternative:** _hold all of `workers/cf-verify/` for the edge
phase._ Leaves the repo in a half-renamed state for weeks, breaks the
"hard cutover" operator decision, and gives reviewers a confusing diff.

### D3 — `X-AEGIS-*` response headers ride the SDK major bump

The four customer-observable header names (`X-AEGIS-Edge`,
`X-AEGIS-Edge-Divergence`, `X-AEGIS-Verify-Key`, `X-AEGIS-Edge-Forward`)
become `X-OKORO-*` only when the SDK is published as a major version and
the API is on the new path. The worker may dual-emit during the SDK
deprecation window if shadow data shows relying parties depending on
old headers; default is hard rename.

**Rejected alternative:** _dual-emit forever._ Wire-format technical
debt; encourages relying parties to depend on both indefinitely.

**Rejected alternative:** _rename now in the cutover PR._ Silent
wire-format change. Violates the "no silent failures and no fabricated
data" invariant (root CLAUDE.md, item 4) at a customer surface.

### D4 — KV namespace ID + key prefixes are unchanged

Cloudflare KV namespace IDs are opaque. The Worker rename does **not**
re-create the namespace; it re-binds it under the renamed worker. Key
prefixes (`trust:`, `policy:`, `spend:`) are brand-neutral and stay. The
KV-binding name `TRUST_KV` is internal to the worker and unchanged.

This avoids a destructive operation (KV namespace recreation) that would
have required a population pass from the BATE worker before the edge
phase could land.

### D5 — Trust anchor secret rename is a follow-up, not a blocker

`AEGIS_AUDIT_PUBLIC_KEY_B64` is declared in `wrangler.toml` comments as a
deploy-time secret but is **not yet consumed in `src/`**. The rename to
`OKORO_AUDIT_PUBLIC_KEY_B64` is mechanical when the wire-up lands. If the
API cutover rotates the audit-chain signing key entirely, the worker code
will accept both anchors during the SDK deprecation window — same shape
as D3.

### D6 — Coordination protocol for the cutover agent

Until the edge phase opens, any session touching `workers/cf-verify/**`
must:

1. Read this ADR.
2. Honor D2's gating list.
3. Cross-check the broadcast in `claude-peers digest` — a durable
   decision `a7a5c9d6` was recorded on 2026-05-21 with scope
   `workers/cf-verify/**`.
4. Ping `claude-peers msg` before merging changes that touch this path.

## Inventory appendix — concrete rename map

For mechanical execution when the edge phase opens. **Read D2 first** —
the items marked `[GATED]` are excluded from the cutover PR.

### Files and identifiers

| File                              | Identifier                              | Today                                                  | After rename                                           | Gate       |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ---------- |
| `workers/cf-verify/wrangler.toml` | `name`                                  | `aegis-cf-verify`                                      | `okoro-cf-verify`                                      | edge phase |
| `workers/cf-verify/wrangler.toml` | comment                                 | `Cloudflare Worker for the AEGIS verify hot path`      | `Cloudflare Worker for the Okoro verify hot path`      | cutover OK |
| `workers/cf-verify/wrangler.toml` | comment (D1, commented out)             | `binding = "AEGIS_DB"`, `database_name = "aegis-edge"` | `binding = "OKORO_DB"`, `database_name = "okoro-edge"` | cutover OK |
| `workers/cf-verify/package.json`  | `name`                                  | `@aegis/cf-verify`                                     | `@okoro/cf-verify`                                     | cutover OK |
| `workers/cf-verify/package.json`  | `dependencies`                          | `@aegis/types`, `@aegis/tsconfig`                      | `@okoro/types`, `@okoro/tsconfig`                      | cutover OK |
| `workers/cf-verify/package.json`  | `description` and `scripts.deploy` text | `AEGIS`                                                | `Okoro` (but keep the exit-code and guard logic)       | cutover OK |
| `workers/cf-verify/README.md`     | all `AEGIS` mentions                    | `AEGIS` / `aegislabs`                                  | `Okoro` / `okoro`                                      | cutover OK |
| `workers/cf-verify/tsconfig.json` | `extends`                               | `@aegis/tsconfig/library.json`                         | `@okoro/tsconfig/library.json`                         | cutover OK |

### Env vars and secrets

| Today                              | After rename                       | Site                                           | Gate                      |
| ---------------------------------- | ---------------------------------- | ---------------------------------------------- | ------------------------- |
| `AEGIS_ORIGIN_URL`                 | `OKORO_ORIGIN_URL`                 | `wrangler.toml` `[vars]`, `src/index.ts` `Env` | cutover OK                |
| `AEGIS_VERIFY_TIMEOUT_MS`          | `OKORO_VERIFY_TIMEOUT_MS`          | same                                           | cutover OK                |
| `AEGIS_FALLBACK_API_KEY`           | `OKORO_FALLBACK_API_KEY`           | secret, `src/index.ts` `Env`                   | cutover OK                |
| `AEGIS_EDGE_VERIFY_ENABLED`        | `OKORO_EDGE_VERIFY_ENABLED`        | `src/index.ts`, `src/shadow.ts`                | cutover OK                |
| `AEGIS_EDGE_VERIFY_SHADOW_MODE`    | `OKORO_EDGE_VERIFY_SHADOW_MODE`    | same                                           | cutover OK                |
| `AEGIS_AUDIT_PUBLIC_KEY_B64`       | `OKORO_AUDIT_PUBLIC_KEY_B64`       | `wrangler.toml` comment                        | follow-up                 |
| `AEGIS_DPOP_REQUIRED`              | `OKORO_DPOP_REQUIRED`              | comment in `src/edge-verify.ts`                | cutover OK (comment-only) |
| `AEGIS_MAX_TOKEN_AGE_SECONDS`      | `OKORO_MAX_TOKEN_AGE_SECONDS`      | comment in `src/edge-verify.ts`                | cutover OK (comment-only) |
| `AEGIS_DIVERGENCE_DATASET_BINDING` | `OKORO_DIVERGENCE_DATASET_BINDING` | comment in `src/shadow.ts`                     | cutover OK (comment-only) |

### Customer-visible headers — `[GATED]`

| Today                     | After rename              | Site                                |
| ------------------------- | ------------------------- | ----------------------------------- |
| `X-AEGIS-Edge`            | `X-OKORO-Edge`            | `src/index.ts` response headers     |
| `X-AEGIS-Edge-Divergence` | `X-OKORO-Edge-Divergence` | `src/index.ts` response headers     |
| `X-AEGIS-Verify-Key`      | `X-OKORO-Verify-Key`      | `src/index.ts` origin-fetch headers |
| `X-AEGIS-Edge-Forward`    | `X-OKORO-Edge-Forward`    | `src/index.ts` origin-fetch headers |

All four are **excluded from the cutover PR per D3.** They land in the SDK
major-version bump or a coordinated edge-phase PR.

## Operator-input items

| ID      | Question                                                                                                                             | Default if no answer                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| OD-021a | Does `aegislabs.io` stay or move to `okoro.io`?                                                                                      | Worker stays unbound (no `[[routes]]`); resolve in the edge-phase PR. |
| OD-021b | Should the worker dual-emit `X-AEGIS-*` and `X-OKORO-*` headers during the SDK deprecation window, or hard-rename at SDK major bump? | Hard rename at SDK major bump (matches hard-cutover doctrine).        |
| OD-021c | When the audit-chain pubkey is rotated for Okoro, does the deployed worker need to verify historical Aegis-anchored entries?         | Yes — keep both anchors during a documented transition window.        |

## Verification before merge

When the edge phase opens and the rename lands:

- `pnpm --filter @okoro/cf-verify typecheck`
- `pnpm --filter @okoro/cf-verify lint`
- `pnpm test:parity` (cross-package — must agree byte-for-byte on the
  decision tuple)
- `pnpm format:check` on every Markdown file changed
- Manual: `wrangler deploy --dry-run --env staging` against a renamed
  worker, then shadow-mode comparison for ≥7 days before flipping
  `OKORO_EDGE_VERIFY_ENABLED=true`.

## Addendum — 2026-05-21 deeper diagnostic

A second pass after the initial ADR landed surfaced findings the Phase A
audit missed because it scoped to `workers/cf-verify/` only. None of these
are blocking the rename. All of them block the actual Phase 3 edge
incorporation, independent of the brand change.

### Finding 1 — there are TWO wrangler configs and they do not agree

| Field                       | `workers/cf-verify/wrangler.toml` (scaffold) | `infra/cloudflare/wrangler.template.toml` (canonical template)             |
| --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| Worker name                 | `okoro-cf-verify`                            | `okoro-verify-edge`                                                        |
| KV bindings                 | `TRUST_KV` (single)                          | `TRUST_SCORE_CACHE` + `POLICY_CACHE` (two)                                 |
| Origin URL env              | `OKORO_ORIGIN_URL`                           | `ORIGIN_API_BASE`                                                          |
| Fallback secret             | `OKORO_FALLBACK_API_KEY`                     | `ORIGIN_FALLBACK_TOKEN`                                                    |
| Audit pubkey secret         | `OKORO_AUDIT_PUBLIC_KEY_B64`                 | `JWT_ED25519_PUBLIC_KEY_B64`                                               |
| Routes                      | none (unbound)                               | `okoro.<your-domain>/v1/verify` + `okoro.<your-domain>/v1/agents/*/status` |
| Analytics dataset           | not declared                                 | `okoro_verify_events` (Workers Analytics Engine)                           |
| CPU limit                   | not declared                                 | `cpu_ms = 50`                                                              |
| Telemetry                   | none                                         | `OTEL_EXPORTER_OTLP_ENDPOINT` secret                                       |
| Denial-precedence assertion | none                                         | `DENIAL_PRECEDENCE` var (worker asserts at boot)                           |

This is a **pre-existing inconsistency**, not a rename bug. The template
at `infra/cloudflare/` is the Phase 3 deployment plan; the file at
`workers/cf-verify/` is the framework-stub for typecheck and tests. They
diverged before the rename and the case-preserving substitution preserved
the divergence faithfully. The worker source reads
`env.OKORO_ORIGIN_URL` — which means **deploying the template as-is
against the current source would fail at first verify**, because the env
var name does not match.

**Reconciliation work** (separate ADR, not done here):

- Pick one canonical config. The template is richer (routes, analytics,
  CPU limit, denial-precedence assertion) and reflects the actual Phase 3
  plan. The scaffold should converge to it.
- Either rename env-var reads in `src/index.ts` to match the template
  (`ORIGIN_API_BASE`, `ORIGIN_FALLBACK_TOKEN`, `JWT_ED25519_PUBLIC_KEY_B64`)
  or rename template fields to match the scaffold. The former is the
  shorter diff and aligns with the Phase 3 plan documented in
  `infra/cloudflare/README.md`.
- KV binding shape is the most consequential mismatch: the source uses
  a single `TRUST_KV` namespace, the template provisions two
  (`TRUST_SCORE_CACHE`, `POLICY_CACHE`). The two-namespace shape lets
  the BATE worker (trust-score writes) and policy issuance (policy
  writes) push to different namespaces with different TTLs. Source must
  be reshaped to read from two before the template can deploy.

### Finding 2 — Phase 3 infrastructure dependencies are NOT yet built

The `infra/cloudflare/README.md` Phase 3 entry checklist references:

- `apps/api/src/modules/edge-sync/` — origin→edge cache push module.
  **Does not exist.** Without this, the worker's KV cache will never
  populate (the worker NEVER writes KV — only reads), so every request
  would forward to origin. Edge verify never reaches "live" mode.
- `infra/observability/grafana-dashboards/okoro-verify-latency.json` —
  the latency baseline. **Does not exist.** Without 7 days of measured
  origin p99, there is no signal that proves the edge cutover helped.

These are real Phase 3 work items, not rename consequences. They were
implicit in the original architecture but never tracked as work modules.
They block the edge cutover regardless of brand.

### Finding 3 — operator rollback backup is MISSING

`scripts/rename-aegis-to-okoro/OPERATOR_FINISH.md` line 184 documents the
rollback as:

```bash
rm -rf /Users/money/Desktop/AEGIS
mv /Users/money/Desktop/AEGIS.backup-2026-05-21 /Users/money/Desktop/AEGIS
```

The backup directory `/Users/money/Desktop/AEGIS.backup-2026-05-21`
**does not exist on disk**. The operator's rollback story has a gap. The
recommended action before running `scripts/rename-aegis-to-okoro/run.sh`:

```bash
cp -R /Users/money/Desktop/AEGIS /Users/money/Desktop/AEGIS.backup-2026-05-21
```

or rely on the git-level rollback (`git restore .; git clean -fd`) plus
the per-branch sweep logs in `.rename-log/`. Git rollback is sufficient
for an unstaged tree, but the snapshot is the only protection against an
operator running `bash run.sh` with `.git/index.lock` already removed and
the perl-substitution succeeding on files they didn't want to rename.

### Implication for the Cloudflare incorporation

The "real" Cloudflare incorporation surface — beyond the worker rename — has
five operator-owned items, ordered by sequencing dependency:

1. **Operator approves Workers Paid plan** ($5/mo). Required for KV beyond
   free tier and any Durable Objects.
2. **Operator chooses DNS shape** — does verification traffic live at
   `verify.okorolabs.io`, `okoro.<your-domain>/v1/verify`, or
   `api.okorolabs.io/v1/verify` (latter blends edge and origin under one
   hostname). Template assumes the second; depends on whether the apex
   domain is also Okoro-branded.
3. **Build `edge-sync` BullMQ worker** in `apps/api/src/modules/edge-sync/`.
   Writes `TRUST_SCORE_CACHE` and `POLICY_CACHE` from the API into
   Cloudflare KV via the Cloudflare API. Acceptance: KV records appear
   within 60s of an origin DB write.
4. **Ship the latency dashboard** at the documented Grafana path and
   collect a 7-day origin baseline. This baseline is the comparison
   target for the edge cutover decision.
5. **Reconcile the two wrangler files** (Finding 1). Without this, the
   `wrangler deploy` command in the README runbook will produce a worker
   that 5xx's on every request.

Items 1–4 are independent of the brand rename; the rename did not create
or block any of them. Item 5 is a pre-existing inconsistency the rename
exposed but did not introduce.

## Operator decisions captured 2026-05-21

The operator responded to two of the three operator-input items live:

- **OD-021a (DNS apex): `okoroapp.com`.** Cowork-claude's substitution
  used `okorolabs.io` as the new apex (mechanical default from
  `aegislabs.io`). The operator's chosen apex is `okoroapp.com`. This
  requires a **second substitution pass** across every place
  cowork-claude wrote `okorolabs.io` (Cloudflare configs, infra docs,
  API base URLs, email examples, runbooks). The recommended subdomain
  for verification traffic is `verify.okoroapp.com` for clean DNS-level
  separation from the origin API at `api.okoroapp.com`.

- **D7 reconciliation direction (Finding 1): align source to template.**
  The Phase 3 work module for the wrangler reconciliation will rename
  env-var reads in `workers/cf-verify/src/index.ts`
  (`OKORO_ORIGIN_URL` → `ORIGIN_API_BASE`,
  `OKORO_FALLBACK_API_KEY` → `ORIGIN_FALLBACK_TOKEN`,
  `OKORO_AUDIT_PUBLIC_KEY_B64` → `JWT_ED25519_PUBLIC_KEY_B64`) and
  reshape the KV cache for two namespaces
  (`TRUST_SCORE_CACHE` for trust-score reads + `POLICY_CACHE` for
  policy reads, each with their own TTL). The single-namespace
  `TRUST_KV` is dropped. The boot-time `DENIAL_PRECEDENCE` assertion
  from the template is preserved.

### Follow-up: the `okorolabs.io` cascade

Cowork-claude's `perl -i` pass propagated `okorolabs.io` widely. Every
hit needs a second substitution to `okoroapp.com`. The mechanical
substitution is safe (no ambiguity with other strings), but it must be
done **before** any DNS provisioning or operator-side provider config:

```bash
# Run after cowork-claude's scripts/rename-aegis-to-okoro/10-rename-checkout.sh.
git grep -l okorolabs.io | xargs perl -i -pe 's/okorolabs\.io/okoroapp.com/g'
git diff --stat
```

Provider-side cascade (operator-owned):

- DNS: register / configure `okoroapp.com` as the primary apex
- Email: `sales@okoroapp.com` (cowork-claude wrote `sales@okorolabs.io`)
- npm scope: `@okoro/*` is unchanged (scope is brand, not domain)
- Cloudflare zone: `okoroapp.com` must be a zone the operator owns in
  the Cloudflare account before the route pattern in
  `infra/cloudflare/wrangler.template.toml` will bind

### Finding 4 — `claims.iss` semantic drift (operator decision: add dedicated principal claim)

A deeper diagnostic pass surfaced a pre-existing contract drift between
the origin and the relying-party SDK:

- **Origin** ([apps/api/src/modules/verify/algorithm/verify.algorithm.ts:156](apps/api/src/modules/verify/algorithm/verify.algorithm.ts:156)):
  enforces RFC 9101 (JAR) semantics — `claims.iss !== undefined &&
claims.iss !== claims.sub` is a rejection. So origin treats
  `iss === sub === agentId`.
- **Verifier-rp** ([packages/verifier-rp/src/policy-claims.ts:34](packages/verifier-rp/src/policy-claims.ts:34)):
  `principalId: claims.iss ?? null` — treats `iss` as `principalId`,
  a different concept entirely (multi-tenant boundary vs. agent
  identity).

These are inconsistent. The rename did not cause this; cowork-claude
only touched the comment header. But the rename forced the question
because moving to OIDC-standard `iss = "https://api.okoroapp.com"`
would make verifier-rp set `principalId` to a URL string —
catastrophic for any relying party making authorization decisions
with that field.

**Operator decision (2026-05-21): add a dedicated principal claim.**

- Origin signs JWTs with a new claim (working name: `pcp`) carrying
  the principalId UUID. The `AgentTokenClaims` type in
  `packages/types/` and `apps/api/src/modules/verify/algorithm/verify.ports.ts`
  gains a `pcp: string` field. The signing path in
  `apps/api/src/modules/identity/` (challenge-response) and
  `apps/api/src/modules/policy/` (policy issuance) both emit it.
- Verifier-rp reads `claims.pcp` instead of `claims.iss` for
  `principalId`. `iss` reverts to RFC 9101 / OIDC-standard usage
  (issuer URL post-rename: `https://api.okoroapp.com`).
- Wire-format change. **Coordinates with the SDK major bump and
  therefore now blocks ADR-0021 D1**: edge cutover cannot precede
  the SDK major release that carries this change.
- Tests in every workspace that mock `AgentTokenClaims` need a `pcp`
  field. The `verifyJwt` mocks in
  `apps/api/src/modules/verify/algorithm/verify.algorithm.spec.ts`
  (14+ usages) all need updating.
- A new work module (proposed: `M-018-principal-claim`) tracks the
  implementation. The Cloudflare worker's
  `workers/cf-verify/src/token.ts` `AgentTokenClaims` interface must
  also gain the `pcp` field; the worker is otherwise pubkey-only and
  doesn't enforce `iss`, so this is purely additive at the edge.

**Sequencing update for D1**: edge rename now depends on
(a) API hard cutover on `main`,
(b) `M-018-principal-claim` implemented + SDK major published,
(c) ≥7 days shadow-mode parity. Cloudflare worker rename PR is
unblocked by (b)'s SDK major because the worker is itself a relying
party — its `AgentTokenClaims` shape ships in
`@okoro/cf-verify`'s dependency on `@okoro/types`.
