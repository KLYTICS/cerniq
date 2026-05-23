# Cross-package tests

Tests that verify behavior _across_ workspace package boundaries. They
exist to catch silent divergence between independent reimplementations
that must agree on a wire format.

## Currently here

- `sdk-api-jwt-parity.spec.ts` — `@cerniq/sdk` and `apps/api/JwtUtil` each
  implement EdDSA compact-JWT independently (intentional; keeps the
  verify hot path lean per ADR-0008). This test fails the moment they
  drift on header bytes, claim ordering, or base64url encoding.

## How to run

These tests are not picked up by per-package `vitest run` — they need a
workspace-aware runner. Add the following to a root `vitest.workspace.ts`
(M-025):

```ts
export default ['packages/*', 'apps/*', 'tests/cross-package'];
```

Then `pnpm vitest run` runs all three tiers including this one.

## Adding new cross-package tests

Two rules:

1. Pick the _thinnest_ contract you can. Test the wire bytes / canonical
   form, not the high-level API.
2. Tests must be deterministic. No clock-dependent assertions; pin time
   if you need to.

## Reference

- ADR-0008 (MCP backbone) — REST and MCP surfaces both rely on this JWT
  format being identical between SDK and API.
- WORK_BOARD M-025 (cross-package vitest workspace wiring).
