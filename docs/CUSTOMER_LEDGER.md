---
title: AEGIS Customer Ledger
last-reviewed: 2026-05-22
owner: operator (Erwin)
audience: operator / founder
classification: internal — contains customer PII (email, name)
---

# AEGIS — Customer Ledger

> Single source of truth for "how many customers does AEGIS have?" until
> the dashboard signup funnel is wired (Phase B1-B5 per the launch
> audit). Append a row for every customer onboarded via the founder-led
> flow per `docs/runbooks/FOUNDER_LED_ONBOARDING.md`.
>
> **Classification**: internal — this file contains customer email
> addresses. Do NOT publish to a public branch, public docs site, or
> any artifact distributed outside the KLYTICS team. Operator-only.

---

## Active customers

> Append rows newest-at-top. Format: ISO-8601 date, customer email,
> principalId from `POST /admin/principals`, plan tier, key prefix
> (first 12 chars of plaintext for human disambiguation; safe to log),
> short context note.

| Date       | Customer email     | principalId | planTier  | keyPrefix    | Notes                  |
|------------|--------------------|-------------|-----------|--------------|------------------------|
| _(none yet — first row lands when operator runs the FOUNDER_LED_ONBOARDING runbook against customer #1)_ |||||||

---

## Churned / revoked

> Append when a customer asks to leave, their key is revoked for cause,
> or the principal is decommissioned. Move row from § Active to here
> and add a churn-reason note.

| Churn date | Customer email | principalId | Original date | Churn reason                |
|------------|----------------|-------------|---------------|------------------------------|
| _(none yet)_ |||||

---

## Metrics derivable from this ledger

- **Total customers ever**: `wc -l` minus headers across both tables
- **Active count**: rows in § Active
- **Churn rate**: § Churned count / total ever, scoped to a window
- **Plan-tier mix**: `awk` over § Active's `planTier` column
- **First-customer date**: oldest row across both tables
- **Time-to-first-customer**: AEGIS repo creation (`git log --reverse | head -1`) → oldest ledger row

Once the dashboard signup funnel lands (Phase B4: API-key auto-issuance
in Stripe webhook), this ledger becomes a snapshot of the founder-led
era and the dashboard's `Principal` table becomes canonical.

---

## Operational rules

1. **Append, never edit**. The ledger is conceptually append-only —
   if a row is wrong, append a correction note rather than rewriting.
   Treat this as a small-scale audit-chain analog of `AuditEvent`.
2. **No plaintext keys here**. Only `keyPrefix` (first 12 chars of the
   plaintext). The plaintext was returned exactly once by the admin
   endpoint and lives only in the customer's vault.
3. **Email is PII**. Don't share this ledger in any channel that
   doesn't comply with the privacy policy. Operator-only viewing.
4. **Match against `/admin/principals` audit events**. Every row here
   should have a corresponding `admin_principal_created` log line in
   the API logs at the row's date. If a row exists without a log
   match, the API was bypassed (red flag — investigate).
5. **Revocation parity**. When you move a row to § Churned, you MUST
   also revoke the customer's API keys via the public `/v1/api-keys/:id`
   endpoint (or via direct Prisma `revoke()` if the operator has DB
   access). The ledger row alone does NOT revoke access.

---

## Cross-references

- `docs/runbooks/FOUNDER_LED_ONBOARDING.md` — the onboarding procedure
  that produces rows in § Active
- `docs/LAUNCH_READINESS_AUDIT_2026-05-21.md` — strategic context for
  why this manual ledger exists ahead of dashboard signup
- `apps/api/src/modules/admin/admin.controller.ts` — the endpoint
  whose outputs populate this ledger
- `scripts/launch-runbook/phase-0-check.sh` — when this script reports
  all 8 gates PASS, this ledger graduates into a historical artifact
- `OPERATOR_DECISIONS.md` OD-004 (audit retention) — applies to this
  ledger; recommend mirroring whatever audit-chain horizon is selected

---

## When to retire this document

When the dashboard signup funnel is wired AND the `Principal` table is
the canonical customer registry (post-Phase-B4), this ledger becomes a
historical snapshot. At that point:

1. Final-row the ledger with a "graduated to dashboard" entry
2. Archive a copy to `docs/historical/CUSTOMER_LEDGER_<final-date>.md`
3. Delete the live file with a commit message linking to the archive

Do NOT retire prematurely — the dashboard `Principal` table is only
canonical after at least ONE end-to-end self-serve signup has
completed without operator intervention.
