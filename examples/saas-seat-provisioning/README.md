# `saas-seat-provisioning` — SCIM-flavored agent provisioning + per-seat policies

The SaaS vertical: when an enterprise customer onboards, their identity
provider provisions agent identities and per-seat policies via
SCIM-shaped endpoints. CERNIQ holds the cryptographic identity; the
SaaS holds the seat assignment + business permissions.

## Why this pattern

Enterprise SaaS customers expect SCIM 2.0 (RFC 7643/7644) for user
provisioning. AI-agent provisioning is not standardized yet — but the
shape that works is identical: `POST /scim/v2/Users` provisions a
human, `POST /scim/v2/Agents` provisions an AI agent. By making
agent provisioning shaped like SCIM, the customer's IDP team can
auto-provision agent identities through the same workflows they
already use for human users.

CERNIQ provides the identity primitive. The SaaS owns the SCIM endpoint
and the policy-per-seat mapping.

## The flow

```
  Customer IDP (Okta, Azure AD, etc.)        Your SaaS                    CERNIQ
  ─────────────────────────────────         ──────────                    ──────
  1. POST /scim/v2/Agents          →        2. validate SCIM payload
     { displayName, externalId,             3. cerniq.agents.register()    →   created
       publicKey, ... }                                                    ←   agentId
                                            4. cerniq.policies.create()    →   created
                                               (scope per seat tier)       ←   policyJwt
                                            5. persist seat row
  ←  201 Created
     { id, agentId, ... }

  later, on every API call by the agent:
                                            cerniq.verify(...)             →   valid
                                            ↓
                                            apply per-seat business logic
```

## Run

```sh
cd examples/saas-seat-provisioning
pnpm install
CERNIQ_API_BASE=https://api.cerniq.io \
CERNIQ_API_KEY=cerniq_sk_... \
SAAS_TENANT_ID=acme \
pnpm tsx src/scim-server.ts

# In another terminal, batch-provision 10 agents to confirm the path
pnpm tsx src/provisioning-batch.ts --tenant acme --count 10
```

## SCIM-shape endpoint surface

Implements a deliberate subset of SCIM 2.0:

| Endpoint                             | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `POST /scim/v2/Agents`               | Provision (creates CERNIQ agent + per-seat policy)   |
| `GET /scim/v2/Agents/:id`            | Read (joins SaaS seat row + CERNIQ agent metadata)   |
| `PATCH /scim/v2/Agents/:id`          | Update seat tier (re-mints policy at new scope)      |
| `DELETE /scim/v2/Agents/:id`         | De-provision (revokes CERNIQ agent + drops seat row) |
| `GET /scim/v2/ServiceProviderConfig` | Discovery — capabilities + auth                      |
| `GET /scim/v2/Schemas`               | Discovery — agent schema                             |

The endpoints accept SCIM `application/scim+json` and emit the same.
SCIM filtering (`?filter=`) is intentionally narrow — only `displayName
sw "..."` and `externalId eq "..."` are supported in v1, matching what
99% of IDPs need for agent management.

## Per-seat policy mapping

The SaaS owns the policy table — one policy per (seat tier × tenant).
On provisioning, the right policy is minted for the agent. Tier upgrade
re-mints; the old policy is revoked. This keeps the CERNIQ surface
narrow (one policy per seat at any time) and the SaaS surface
expressive (whatever tiers, seats, add-ons the SaaS wants to offer).

| Seat tier  | CERNIQ scope            | Spend cap    | Domain allow-list  |
| ---------- | ----------------------- | ------------ | ------------------ |
| free       | `read:basic`            | $0           | (none — read-only) |
| pro        | `read:basic, write:own` | $100/day     | `*.your-saas.com`  |
| business   | `read:basic, write:any` | $1,000/day   | `*.your-saas.com`  |
| enterprise | `*`                     | per-contract | per-customer       |

## Production checklist

- [ ] SCIM auth: HTTP Bearer with the customer-IDP's API key. Rotate
      independently of CERNIQ API keys; never use the same key for both.
- [ ] Idempotency: SCIM provisioning by `externalId` must be idempotent.
      Re-POSTing the same `externalId` returns the existing seat row,
      not 409 Conflict, per SCIM 2.0 §3.3.
- [ ] Webhook on policy.expired + agent.revoked: a customer IDP that
      revokes a user expects the agent to stop working within seconds.
      The CERNIQ webhook → SaaS handler tear-down path is the only way
      to honor that SLA.
- [ ] Audit slice export: enterprise customers need their own audit
      slice. Use the CERNIQ NDJSON export filtered by `principalId` (one
      CERNIQ principal per SaaS tenant).
- [ ] Seat-tier upgrade race: when a customer upgrades a seat,
      re-minting the policy must happen before the user notices the
      old policy expired. Pre-mint the new policy, swap, then revoke
      the old — never revoke first.

## Reference

- RFC 7643 (SCIM 2.0 Core Schema), RFC 7644 (SCIM 2.0 Protocol)
- `docs/CERNIQ_AS_BACKBONE.md` § 2.3 — recommended consumption pattern
- WORK_BOARD M-040g (the ticket this example completes)
