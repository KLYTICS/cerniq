---
title: AEGIS Founder-Led Onboarding Runbook
last-reviewed: 2026-05-21
owner: operator (Erwin)
audience: operator / founder
---

# AEGIS — Founder-Led Onboarding Runbook

> The cheapest path to AEGIS's first 5-10 paying customers. Bypasses
> Stripe self-serve checkout, dashboard signup, and Auth0/Clerk
> vendor selection (`OPERATOR_DECISIONS.md` OD-015 still OPEN). The
> operator creates the Principal + issues the API key out-of-band and
> emails the customer manually.
>
> Strategic context: `docs/LAUNCH_READINESS_AUDIT_2026-05-21.md`
> § Phase Bα. Once 5+ customers are onboarded via this path, graduate
> to Phase B1-B5 (full self-serve with IDP SDK + Resend email).

---

## When to use this

✓ First 5-10 design-partner customers
✓ Negotiated-pricing enterprise deals (Stripe metered tier skipped)
✓ Any customer where the operator wants direct control over onboarding
✓ Pilot / proof-of-concept engagements

✗ Public PLG signup flow (use Phase B1-B5 instead)
✗ Self-service trial activation (use Phase B1-B5)
✗ Any onboarding the operator should NOT touch personally at scale

---

## Prerequisites

### Operator workstation

- `gh` CLI authenticated to KLYTICS/aegis
- `curl` or `httpie` (`http` command)
- 1Password or equivalent secure-share for delivering the API key

### Production environment

- `AEGIS_ADMIN_TOKEN` env var set on the production deploy:
  - Generate: `openssl rand -hex 32`
  - Length: ≥ 32 chars (enforced by config Zod schema)
  - Store in: production deploy environment ONLY (Railway/Vercel/
    whichever provider); NEVER in committed `.env*` files
  - Rotation: redeploy with new value; no cache, immediate effect
- Customer email and (optional) display name + plan tier in hand

### Local dev (testing the flow before customer)

```bash
# Generate a local admin token
echo "AEGIS_ADMIN_TOKEN=$(openssl rand -hex 32)" >> apps/api/.env.local

# Boot the API
pnpm --filter @aegis/api dev
```

---

## Procedure (per customer, ~5 minutes)

### Step 1 — Create the Principal

```bash
curl -X POST https://api.aegislabs.io/admin/principals \
  -H "x-aegis-admin-token: $AEGIS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "email": "customer@example.com",
    "name": "Customer Display Name",
    "planTier": "DEVELOPER"
  }'
```

**Expected response (HTTP 201)**:

```json
{
  "principalId": "cl…",
  "email": "customer@example.com",
  "planTier": "DEVELOPER",
  "createdAt": "2026-05-21T12:00:00.000Z"
}
```

**Save `principalId` for Step 2.**

**Plan tier values** (per `apps/api/prisma/schema.prisma` enum
`PlanTier`):
- `FREE` — 10K lifetime verifies (per ADR-0014); customer can upgrade later
- `DEVELOPER` — $49/mo, 50K verifies/mo (the cheapest paid tier; typical for
  design partners)
- `GROWTH` — $1,499/mo, 5M verifies/mo (renamed from SCALE per ADR-0014)
- `ENTERPRISE` — custom pricing; use for negotiated deals

**Error responses**:

| HTTP | Body                                                  | What it means                                          |
|-----:|-------------------------------------------------------|--------------------------------------------------------|
| 400  | `{error: "invalid_request", details: [...]}`         | Body failed Zod validation (email shape, planTier enum, name length) |
| 401  | `admin endpoint disabled`                            | `AEGIS_ADMIN_TOKEN` not set in prod env                |
| 401  | `missing admin token`                                | `x-aegis-admin-token` header absent                    |
| 401  | `invalid admin token`                                | Header value doesn't match `AEGIS_ADMIN_TOKEN`         |
| 409  | `{error: "principal_exists", principalId: "cl…"}`    | Email already in use; use the returned `principalId` in Step 2 (skip Step 1) |

### Step 2 — Issue the API key

Use the `principalId` from Step 1:

```bash
curl -X POST "https://api.aegislabs.io/admin/principals/<principalId>/api-keys" \
  -H "x-aegis-admin-token: $AEGIS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "label": "customer-corp-prod-2026-Q2",
    "scope": "FULL"
  }'
```

**Expected response (HTTP 201)**:

```json
{
  "apiKeyId": "ak_…",
  "plaintextKey": "aegis_sk_…",
  "keyPrefix": "aegis_sk_ab",
  "principalId": "cl…",
  "scope": "FULL",
  "issuedAt": "2026-05-21T12:00:30.000Z"
}
```

⚠️ **CRITICAL**: `plaintextKey` is returned EXACTLY ONCE. After this
response, only the bcrypt hash is persisted; the plaintext is
unrecoverable. If you lose it, you must issue a new key.

**Scope values**:
- `FULL` (default) — verify + identity + policy + audit read + billing read
- `VERIFY_ONLY` — `/v1/verify` only (relying-party use case; suitable for
  customers who only need to verify other agents' tokens)

**Label conventions** (recommended, optional):
- Include customer name + environment + quarter: `acme-prod-2026-Q2`
- Surfaces in dashboard API-keys table for the customer's ops team
- Without a label, the key is only identifiable by its 12-char prefix

### Step 3 — Deliver the key to the customer

Pick ONE method (in security preference order):

1. **1Password share** (best): create a one-time-view share, paste the
   `plaintextKey`, set expiry to 7 days, send the share link via email.
2. **Signal/secure messaging**: send the `plaintextKey` directly.
3. **Email** (acceptable if customer corp is on Google Workspace /
   Microsoft 365 with TLS): include the `plaintextKey` inline.

**Email template** (adapt as needed):

```
Subject: Your AEGIS API key — keep this safe

Hi [Name],

Welcome to AEGIS. Your API key is below — please store it in your
password manager immediately. We cannot recover or display this key
again after this email.

  Key:        aegis_sk_…
  Plan:       Developer
  Scope:      Full access
  Issued:     2026-05-21

Quick start:
  1. Read the docs: https://docs.aegislabs.io/quickstart
  2. Set AEGIS_API_KEY=<key> in your environment
  3. Make your first /v1/verify call

If you need to rotate this key (e.g. you suspect compromise), reply
to this email — we'll issue a new one and revoke this one in the
same step.

Best,
Erwin
```

### Step 4 — Verify the customer can connect

Quick smoke test the customer can run (include in the email):

```bash
export AEGIS_API_KEY=aegis_sk_…

# Should return your principal's plan + usage:
curl https://api.aegislabs.io/v1/principals/me \
  -H "x-aegis-api-key: $AEGIS_API_KEY"
```

Expected: HTTP 200 with `{planTier: "DEVELOPER", trialUsedCount: 0, ...}`.

### Step 5 — Record the onboarding

Append a row to `docs/CUSTOMER_LEDGER.md` (or your own ledger):

```markdown
| Date       | Customer          | principalId | planTier  | keyPrefix    | Notes              |
|------------|-------------------|-------------|-----------|--------------|--------------------|
| 2026-05-21 | customer@example  | cl_abc123   | DEVELOPER | aegis_sk_xy  | First design partner |
```

This is the source of truth for "how many customers do we have" until
the dashboard signup funnel is wired (Phase B1-B5).

---

## Rollback / recovery

### Customer reports they lost the key

```bash
# Issue a new key for the same principal
curl -X POST "https://api.aegislabs.io/admin/principals/<principalId>/api-keys" \
  -H "x-aegis-admin-token: $AEGIS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"label": "replacement-2026-05-22", "scope": "FULL"}'

# (Optionally) revoke the old key via the existing /v1/api-keys/:id
# endpoint with a FULL-scope key for that principal:
curl -X DELETE "https://api.aegislabs.io/v1/api-keys/<old-apiKeyId>" \
  -H "x-aegis-api-key: <NEW-plaintext-key>"
```

### Customer reports unauthorized access (suspected compromise)

1. **Immediately** revoke the compromised key (see above)
2. Issue a new key with a new label noting the rotation reason
3. Pull the customer's `/v1/audit/events` to scope blast radius
4. File an incident per `docs/RUNBOOK.md` § Incident Response if any
   audit event shows unauthorized verify activity

### `AEGIS_ADMIN_TOKEN` itself is compromised

1. Generate a new token: `openssl rand -hex 32`
2. Update production env var + redeploy
3. Old token rejects on next request (no cache)
4. Audit all `/admin/*` requests in the last 30 days via the API
   logs to scope blast radius
5. Re-issue API keys for any principal created during the compromise
   window (defensive)

---

## Escalation

- API endpoint returns 5xx repeatedly: check `apps/api/` is deployed and
  `AEGIS_ADMIN_TOKEN` is set in the deploy environment
- AdminGuard rejects despite correct token: check token length is ≥ 32
  chars; check for trailing whitespace in the header value
- Customer reports `/v1/verify` returns 401 despite valid key: check
  the key prefix matches what was issued; if mismatch, customer pasted
  the wrong key — re-deliver via Step 3

---

## When to graduate from this runbook

Graduate to **Phase B1-B5** (full self-serve onboarding) when ANY of:

1. ≥ 10 customers onboarded via this runbook
2. Operator time on customer #N onboarding > 10 minutes (signals friction)
3. Customer requests "can I just sign up on the website?" twice
4. Stripe metered billing is needed for usage-based pricing tier

Phase B1-B5 wires:
- Auth0 (or Clerk) dashboard signup → IDP adapter → Principal creation
- Resend (or SES) email service for self-serve API-key delivery
- Stripe checkout → API-key auto-issuance in `onCheckoutCompleted`
- Lazy Principal creation from `session.customer_email` for cold-stranger flow

See `docs/LAUNCH_READINESS_AUDIT_2026-05-21.md` § Phase B for the
sequence.

---

## Related

- `docs/LAUNCH_READINESS_AUDIT_2026-05-21.md` — strategic context
- `docs/spec/03_TECHNICAL_SPEC.md` — full API surface
- `apps/api/src/modules/admin/admin.controller.ts` — implementation
- `apps/api/src/common/guards/admin.guard.ts` — auth implementation
- `OPERATOR_DECISIONS.md` OD-015 — IdP vendor selection (Auth0 default)
- `scripts/launch-runbook/phase-0-check.sh` — verifies which gaps remain
