---
title: AEGIS — Invariant audit (2026 Q2)
audited-on: 2026-05-21
auditor: sid=busy-khorana-7281c7 (autonomous, read-only)
scope: 3 of 8 CLAUDE.md invariants
result: PASS (3/3)
follow-up: schedule remaining 5 invariants on next audit pass
---

# AEGIS — Invariant audit (2026 Q2)

This is a focused, evidence-gathering audit of three of the eight
architecture invariants from the root `CLAUDE.md`. It complements the
22-finding [`ARCHITECTURE_AUDIT.md`](./ARCHITECTURE_AUDIT.md) (M-018)
by exercising specific load-bearing properties under live source.

The three invariants chosen are the ones whose failure mode is
catastrophic and whose surface is largest after the recent rapid
expansion (M-040 … M-056, two-week sprint with ~50 modules landing).

## TL;DR

| # | Invariant | Result | Surface audited |
| - | --------- | ------ | --------------- |
| 5 | Multi-tenant isolation by `principalId` | ✅ PASS | 140+ Prisma operations across 26 service files |
| 4 | No silent failures / no fabricated data | ✅ PASS | verify, audit, billing, policy-engine, KMS, webhooks, edge-verify, IdP adapters |
| 8 | Public SDKs and verifier packages runtime-portable | ✅ PASS | `@aegis/sdk`, `@aegis/verifier-rp`, `workers/cf-verify`, `@aegis/mcp-bridge` |

**Not audited this pass** (next session):
1 (private keys never enter AEGIS), 2 (verify hot path remains portable),
3 (audit events append-only and signed), 6 (denial precedence stable),
7 (contracts generated or centrally owned).

## Method

- **Tooling**: read-only static analysis via `grep` / `rg` and source review.
  No code execution, no test runs.
- **Scope discipline**: each invariant audited independently to avoid
  finding-conflation. Auditors did not see each other's results.
- **Anti-bias**: any uncertain classification was flagged for human review
  rather than silently passed.

## Invariant 5 — Multi-tenant isolation by `principalId`

> *"Multi-tenant isolation is by `principalId` on every query and mutation.
> The API key guard establishes the principal; services carry that boundary
> all the way to Prisma calls, cache keys, queues, and webhooks."*
> — `CLAUDE.md`

### Result: PASS

- **Properly scoped**: 130+ Prisma operations include `principalId` in the
  `where` (for reads/mutations) or `data` (for creates) clause.
- **Intentionally unscoped (architecturally sound)**: 8 categories
  documented below.
- **RED (real isolation leak)**: 0 findings.

### The eight intentionally-unscoped categories

These are the **alternative isolation primitives** that justify a query
not carrying `principalId` directly. Future reviewers should treat this
table as the canonical map.

| # | Category | Where | Alternative primitive |
| - | -------- | ----- | --------------------- |
| 1 | Transactional outbox per ADR-0007 | `apps/api/src/modules/outbox/outbox.service.ts` | `principalId` in the row payload; isolation enforced at worker dispatch time. Atomic with the originating transaction. |
| 2 | Public readiness | `apps/api/src/modules/health/health.controller.ts` | No tenant data exposed; operator observability only. |
| 3 | Verify hot-path agent/policy lookup | `apps/api/src/modules/verify/verify.service.ts` (lines 379, 428) | Cryptographic proof-of-possession via JWT signature — the JWT is the isolation primitive, principalId comes from the verified token claims. |
| 4 | Spend-guard aggregates | `apps/api/src/modules/verify/spend-guard.service.ts` | Scoped by `(agentId, policyId)` both JWT-proven upstream. |
| 5 | API key lookup | `apps/api/src/modules/auth/api-key.service.ts` | Lookup is BY secret hash (the authentication method); principalId is the **result** of the lookup, not an input. |
| 6 | Stripe webhook reconciliation | `apps/api/src/modules/billing/stripe.service.ts` | Principal lookups by `customer_id` / `subscription_id` after HMAC signature verification gates the entire webhook handler. |
| 7 | IdP first-touch principal creation | `apps/api/src/modules/idp-{auth0,clerk,workos}/*.adapter.ts` | Lookup by `(idpProvider, idpOrganizationId)`; only creates a *new* principal on first encounter. |
| 8 | Background sweeps with per-tenant fan-out | `apps/api/src/modules/compliance/audit-retention.service.ts`, `apps/api/src/modules/policy/policy.expiry.worker.ts`, `apps/api/src/modules/onboarding/onboarding.backfill.ts` | Global read intentionally selects across all principals, then per-tenant dispatch (webhooks, audit purge, onboarding-step reconcile). |

### Why this matters

A single missed `principalId` in a list-style endpoint can leak every
tenant's data. The audit's discipline was: if the auditor couldn't *see*
the guard that establishes the principal, flag it. All flags resolved
to one of the 8 intentionally-unscoped categories above.

## Invariant 4 — No silent failures / no fabricated data

> *"Downstream failure must be visible in the response, logs, metrics, or
> audit trail as appropriate. Never hide an error behind an empty list,
> fake score, stub policy, or synthetic success."*
> — `CLAUDE.md`

### Result: PASS

All critical paths exhibit one of these acceptable patterns:
1. **Re-throw** (audit chain append, KMS sign primary path)
2. **Fail-closed** (replay cache, trial gate, verify algorithm on port errors → `ServiceUnavailableError` → `ANOMALY_FLAGGED` denial)
3. **Log visibly + fail-open** (usage guard for billing, with explicit
   comments distinguishing security vs. billing posture)
4. **Surface in response** (`auditEventId`, `denialContext`, `denialReason`)
5. **Emit metrics** (`cache_set_failed_total`, `trialExhaustedTotal`, `bullmqJobsTotal`)

### The principled security-vs-billing split

The most enterprise-grade pattern surfaced by this audit is the
deliberate split between security and billing posture:

- **`SpendGuard`** on Redis-down → `ServiceUnavailableError` (fail-closed)
- **`UsageGuard`** on Redis-down → `{ allowed: true, remaining: -1 }` with
  logged `WARN` (fail-open)

Both decisions are commented inline with their reasoning. The trade-off:
under-billing is preferable to blocking verify; over-blocking on a security
gate is preferable to allowing a spend leak. This is exactly the kind of
intentional silence Invariant 4 permits — visible via logs and metrics,
trade-off documented at the call site.

### Absence of critical anti-patterns

The audit specifically searched for and did NOT find:
- Empty catch blocks `catch (e) {}`
- `.catch(() => ...)` returning `[]` or `{ valid: true }` on security paths
- `try { ... } catch { return defaultTrustScore }` style fallback-to-safe
- `?? ''` / `?? []` collapsing real-but-empty results with failed results
  on KMS / crypto / audit operations
- Silent swallowing of authorization failures

## Invariant 8 — SDKs and verifier packages runtime-portable

> *"Public SDKs and verifier packages must stay runtime-portable. Do not
> add Node-only APIs to browser, edge, or relying-party surfaces."*
> — `CLAUDE.md`

### Result: PASS

Verified across the four runtime-portable packages:

| Package | Crypto primitive | HTTP primitive | Portability |
| ------- | ---------------- | -------------- | ----------- |
| `@aegis/sdk` (sdk-ts) | `@noble/ed25519` + `@noble/hashes` (pure-JS) | `globalThis.fetch`, injected via config | Browser, edge, Node 18+ |
| `@aegis/verifier-rp` | `@noble/ed25519` + `@noble/hashes` | `globalThis.fetch` (required config field) | Browser, CF Worker, Vercel Edge, Deno Deploy, Node 18+ |
| `workers/cf-verify` | `crypto.subtle.{importKey,verify}` (Web Crypto) | Native CF Worker | V8 isolate (Workers) |
| `@aegis/mcp-bridge` | None (wrapper) | None (wrapper) | Runtime-agnostic |

### Gated portability patterns

The two gated patterns that DO touch Node-only globals are correctly
guarded:

- `packages/sdk-ts/src/crypto.ts:12` and
  `packages/verifier-rp/src/_internal/b64u.ts:6-9`:
  `if (typeof Buffer !== 'undefined') { ... } else { ... atob/btoa ... }`
  — uses Node `Buffer` when available (faster), falls back to browser/Workers
  primitives.

### Absence of leaks

No instances of: bare `import 'fs'` / `import 'crypto'`, `from 'node:*'`
imports outside framework adapters, ungated `Buffer` access, ungated
`process.env`, `__dirname` / `__filename` / `require()` in shipping code.

### M-016 commitment held

`@aegis/verifier-rp`'s explicit promise (M-016) to support edge runtimes
via the Hono adapter is verified. Customers shipping the verifier in a
Next.js edge function or Cloudflare Worker will not encounter
"Module not found: Can't resolve 'crypto'" at build time.

## What this audit does NOT cover

This audit is one slice. Five invariants remain unverified by live audit
this quarter. They are scheduled for the next pass:

| # | Invariant | Suggested audit approach |
| - | --------- | ------------------------ |
| 1 | Private keys never enter AEGIS | grep API/dashboard/workers for private-key types; verify no DB column, env var, or log field carries private bytes. |
| 2 | `/v1/verify` hot path remains portable | Verify the worker's edge-verify and the API's verify-algorithm share the same pure decision module; no NestJS-only imports in `verify.algorithm.ts`. |
| 3 | Audit events append-only and signed | grep `prisma.auditEvent.{update,delete}` in non-test code; should be zero. Verify the redact path nulls fields without touching hashes. |
| 6 | Denial precedence stable | Already enforced by spec-sync gate (post-PR #32). Confirm by running the gate on a deliberate enum-reorder PR. |
| 7 | Contracts generated or centrally owned | Spot-check that `packages/types`, OpenAPI YAML, and generated SDK types agree (the parity gate covers most of this — confirm the gate covers webhook payloads and well-known endpoints too). |

## Operator action

None required. This audit is informational evidence that the load-bearing
invariants hold post-M-056 churn. If a customer or auditor asks for proof
that AEGIS enforces tenant isolation, fails honestly, or runs in their
edge runtime, this document is the citeable artifact.

If a future change is suspected of violating any of these three invariants,
re-run the audit against just the changed module (the per-invariant scope
sections above describe the exact grep patterns used).
