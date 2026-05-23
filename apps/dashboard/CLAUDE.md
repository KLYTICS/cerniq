# CERNIQ Dashboard - Claude contract

This directory owns the Next.js operator/developer surface. It is part of the
security product, not a marketing microsite. Build dense, calm, operational UI
that helps an enterprise user inspect agents, policies, billing, audit trails,
MCP servers, and webhooks without ambiguity.

## Product rules

- The first screen of each route should be useful product UI, not a landing
  page. Prefer tables, filters, status strips, timelines, and action panels over
  decorative card grids.
- Server components are the default. Use client components only for interaction,
  effects, optimistic UI, or browser APIs.
- Dashboard assumptions must come from `@cerniq/types`, API discovery endpoints,
  or colocated typed adapters. Do not hand-copy enums without a parity test.
- Never expose API keys, webhook secrets, private keys, bearer tokens, or raw
  customer payloads in the UI.
- Error states must be honest. Do not render empty success states when the API
  failed.
- Auth redirects must be same-origin and validated. Preserve conversion intent
  only through safe redirect helpers.

## UX quality bar

- Design for repeated operator use: compact hierarchy, stable dimensions,
  keyboard-friendly navigation, scannable tables, and explicit status.
- Use domain language: agent, policy, verify, trust score, denial reason,
  audit event, webhook delivery, plan, quota.
- Avoid hero-scale typography inside dashboards. Keep copy short and operational.
- Make loading, empty, partial, denied, and failed states distinct.
- Use accessible labels, focus styles, semantic controls, and no text overlap on
  mobile or desktop.

## Data and integration rules

- SSR-fetch platform state when freshness matters; use documented fallbacks only
  when offline build/render behavior requires them.
- Pricing is the canonical example: `resolvePricing()` should prefer
  `/.well-known/pricing.json` via `CERNIQ_API_BASE_URL`, expose provenance, and
  fall back only with a visible reason.
- If a page mirrors API constants, add or update a parity test in `tests/`.
- Server actions must validate inputs and return typed results. Do not leak stack
  traces or raw provider errors to the client.
- Billing and checkout flows must be idempotent from the UI perspective. Strip
  one-time intent parameters after use.
- Login and middleware redirects must use safe redirect helpers. Preserve
  checkout intent through Auth0 return paths without allowing open redirects.
- Until Auth0 v4 SDK is installed and configured, `/api/auth/login` is an
  integration receiver gap, not a reason to weaken the safe-return contract.

## Required verification

- Dashboard typecheck: `pnpm --filter @cerniq/dashboard typecheck`
- Dashboard build for broad UI/router changes: `pnpm --filter @cerniq/dashboard build`
- Cross-package parity when API/dashboard contracts meet: `pnpm test:parity`

For visual work, run the local dev server and inspect the changed route in a
browser before claiming it is polished.
