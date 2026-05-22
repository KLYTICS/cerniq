# OKORO — Network topology (operator-facing)

OKORO sits behind Cloudflare and is hosted on Railway in v1. The trust
model assumes Cloudflare terminates TLS, applies WAF + DDoS rules, and
forwards to Railway's edge, which forwards to the API service. Postgres
and Redis are reached over Railway's internal network — they never
expose public endpoints. Outbound calls (Stripe, Sentry, customer
webhooks) leave through Railway's NAT and are scrutinised at the
application layer because customer-controlled webhook URLs are an SSRF
vector.

This directory documents both directions:

- [`ingress.md`](./ingress.md) — public traffic into OKORO.
- [`egress-policies.md`](./egress-policies.md) — OKORO reaching outbound services.

For the trust-boundary diagram, see
[`../../docs/SECURITY.md`](../../docs/SECURITY.md) § 2. For the
disaster-recovery view of network failures, see
[`../../docs/DR_RUNBOOK.md`](../../docs/DR_RUNBOOK.md).
