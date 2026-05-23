---
title: CERNIQ industry quickstarts
audience: developers picking the right vertical template for their integration
last-reviewed: 2026-05-02
owner: operator (Erwin)
---

# CERNIQ industry quickstarts

Three runnable, opinionated integrations — one per first-wave vertical
(`OD-011`). Each is a 30-line answer to "I'm a `<persona>`, how do I
adopt CERNIQ?" The verb shapes are identical across all three; the
domain plumbing is what differs.

| Vertical                 | Persona                         | Path                               | Maps to ticket |
| ------------------------ | ------------------------------- | ---------------------------------- | -------------- |
| `fintech-payments`       | merchant API engineer           | `examples/fintech-payments/`       | M-040e         |
| `ai-platform-tool-call`  | AI-platform / MCP server author | `examples/ai-platform-tool-call/`  | M-040f         |
| `saas-seat-provisioning` | enterprise SaaS platform team   | `examples/saas-seat-provisioning/` | M-040g         |

## How to start

```sh
# Install the CLI (post-goreleaser drop):
curl -fsSL https://get.cerniq.dev/install.sh | sh

# Or from source:
cd packages/cli && go build -o cerniq . && cp cerniq /usr/local/bin/

# Scaffold any vertical into the current directory:
cerniq init --industry fintech-payments
cerniq init --industry ai-platform-tool-call
cerniq init --industry saas-seat-provisioning

# Then read the README in the scaffolded directory and follow the
# golden-path instructions — each is ~10 minutes to first verify.
```

## Why these three

Each maps to a distinct adoption motion:

- **fintech-payments** — the highest-value gate. Every payment service
  that touches AI agents has the same problem (who, scoped to what,
  trustable now). Our verify call answers all three at once.
- **ai-platform-tool-call** — the fastest-growing surface. MCP is
  spreading across the AI-platform ecosystem; CERNIQ slots between MCP
  and the downstream API as the cryptographic gate. Pairs with the
  peer-shipped `@cerniq/mcp-server` package (2026-05-02).
- **saas-seat-provisioning** — the cleanest greenfield. Enterprise
  SaaS already has SCIM for human users; agent provisioning is shaped
  identically. Smallest blast radius for an early adopter.

The three were locked in OD-011 against eight realistic candidates.
Health, commerce-marketplace, gov, edu, supply-chain are deferred to
the second wave (post Phase 1 GA). See `docs/CERNIQ_AS_BACKBONE.md` § 7
for the operator's full roll-out order.

## Common pattern across all three

Whatever the vertical, the CERNIQ-side state machine is the same:

1. **Register an agent** (`cerniq agents register` or
   `cerniq.agents.register()`). Generates a public/private keypair
   client-side; CERNIQ only sees the public key.
2. **Mint a policy** (`cerniq policy create` or `cerniq.policies.create()`)
   binding the agent to scope + spend cap + domain allow-list + TTL.
   Returns a signed JWT.
3. **Sign a per-action token** (the SDK's `sign(privateKey, ...)`).
4. **Call `cerniq.verify(token, ctx)`** in the relying party. The
   verdict carries `valid`, optional `denialReason`,
   `scopesGranted`, `trustScore`, and an `auditEventId` to cross-link
   with your own logs.
5. **Subscribe to webhooks** for `agent.revoked`, `policy.expired`,
   `trust_score_changed` so a compromised agent stops working in
   seconds, not at TTL expiry.

The vertical-specific code is in step 4 — what `action.kind` you
pass, what `requestedAmount` and `requestedDomain` mean for your
domain, what `minTrustScore` you set per merchant risk appetite.
Everything else is identical.

## Second-wave verticals (deferred)

| Candidate                 | Why deferred                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| health-claim-submission   | HIPAA business-associate-agreement (BAA) work needed first; not a Phase 1 target          |
| commerce-marketplace      | Stripe Connect-style payouts add complexity (OAuth on top of policies); post-GA           |
| gov-procurement           | FedRAMP pathway requires US-region origin; gated on `docs/EU_RESIDENCY.md` shape decision |
| edu-credentialing         | Open Badges / W3C VC integration scope larger than a single quickstart                    |
| supply-chain-traceability | Pairs with EPCIS / GS1 standards; out of scope for Phase 1                                |

Each of these will get an `examples/<vertical>/` directory in its own
`M-04Xx` ticket once prioritized.

## Reference

- `OPERATOR_DECISIONS.md` OD-011 — the locked first-wave selection.
- `docs/CERNIQ_AS_BACKBONE.md` § 7 — operator's roll-out order across
  the four sister projects (FORGE / CerniQ / Apex / Bimba).
- `docs/personas/{developer,security,sre,auditor}.md` — per-persona
  curated entry paths.
- `WORK_BOARD.md` M-040e..g — the tickets each example completes.
