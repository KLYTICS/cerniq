---
title: OKORO for developers
audience: software engineers integrating OKORO as a relying party or as an agent operator
last-reviewed: 2026-05-02
---

# OKORO for developers — 30-second onboarding

You can be making `verify` calls in under 10 minutes. The single
artifact you need is an **API key** (manage or verify-only) — the rest
is libraries and CLI.

## Pick your role

You are one of two people:

- **An agent operator** — you are running an AI agent that calls other
  services. You need an OKORO *agent identity* and a *policy* binding
  it to scopes. Start with `examples/node-quickstart/`.
- **A relying party (RP)** — you operate a service that *receives*
  agent requests. You need a *verify-only key* and the
  `@okoro/verifier-rp` adapter for your stack. Start with
  `examples/relying-party-verifier/` or one of the industry templates
  below.

Most production teams are both, on different services. The two roles
use different keys; never share them.

## First five steps

1. **Install the CLI.** `curl -fsSL https://get.okoro.dev/install.sh | sh`.
2. **Authenticate.** `okoro login --api-key okoro_sk_...` (or via
   device-code OAuth if your tenant has Auth0 wired — see
   `docs/decisions/0009-auth0-bridge.md`).
3. **Diagnose.** `okoro doctor` confirms reachability, credential, JWKS,
   clock skew, plugin discovery. Run it whenever something feels off.
4. **Scaffold.** `okoro init --industry fintech-payments` (or
   `ai-platform-tool-call`, or `saas-seat-provisioning`) drops a
   runnable integration into the current directory.
5. **Verify your first call.** Follow the example's README — the
   golden path is ~30 lines of code.

## The one document worth reading end-to-end

`docs/OKORO_AS_BACKBONE.md` § 2.3 — the recommended consumption
pattern. Twenty lines of TypeScript. Internalize that and you'll know
what 90% of integrations look like.

## When you're stuck

- `okoro doctor` first. It catches most environment problems.
- Check `docs/SECURITY.md` § Denial Precedence if `verify` returns
  `valid: false` and you're unsure which reason maps to what
  user-facing message.
- Search the audit log: `okoro tail audit --follow` shows live
  decisions. Cross-link with the `auditEventId` returned in the
  verify response.

## Reference

- `docs/spec/OKORO_API_SPEC.yaml` — the OpenAPI source of truth.
- `packages/sdk-ts/` — TypeScript SDK (`@okoro/sdk`).
- `packages/sdk-py/` — Python SDK.
- `packages/verifier-rp/` — drop-in offline verifier for relying
  parties (Express / Fastify / Hono / edge runtimes).
- `examples/` — runnable integrations, including the three industry
  quickstarts (fintech / ai-platform / saas).
