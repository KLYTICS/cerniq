// agent-token-claims.parity.spec.ts — compile-time gate for the dual
//                                     `AgentTokenClaims` interfaces.
//
// AEGIS has TWO `AgentTokenClaims` declarations by design, per
// CLAUDE.md invariant #2 (the /v1/verify hot path must remain
// framework-portable):
//
//   • Nest-side       — apps/api/src/common/crypto/jwt.util.ts
//   • Algorithm-side  — apps/api/src/modules/verify/algorithm/verify.ports.ts
//
// The duplication is intentional: the algorithm file is framework-free
// so the Cloudflare Worker adapter (workers/cf-verify) can import it
// unchanged without dragging in NestJS. Having a parallel Nest-side
// declaration keeps the Nest module graph self-contained.
//
// THE HAZARD: nothing structurally forces the two interfaces to stay in
// sync. A future contributor could add a field to one without the other
// (this nearly happened on the RFC-9101 JAR landing: db55481 added
// iss/aud/authorization_details to the Nest side; the algorithm side was
// pre-staged in parallel by peer bf9d6030 — but had they not been, the
// algorithm would have silently dropped JAR claims when the verifyJwt
// port narrowed the Nest-side return type to the algorithm-side shape).
// The bug class — "algorithm silently ignores claims the Nest layer
// validates" — is exactly the half-wired-defect class that scopes like
// `aegis:rar-in-jar-hotpath-integration` exist to close.
//
// This gate is COMPILE-TIME. TypeScript types are erased at runtime, so
// there is no useful runtime equality check; we rely on tsc to catch
// drift. Mechanics:
//
//   Equal<X, Y> is the standard higher-order-inference equality check
//   (sometimes attributed to Matt Pocock / TypeScript-Type-Challenges).
//   It returns `true` iff X and Y are structurally identical including
//   optional-ness, readonly-ness, and exact field types.
//
//   _assertNestAlgorithmParity is declared `Equal<Nest, Algorithm>` and
//   assigned `true`. If parity holds, the type evaluates to `true` and
//   the assignment typechecks. If parity drifts, the type evaluates to
//   `false` and the assignment fails compilation with
//   `Type 'true' is not assignable to type 'false'`.
//
// HOW TO VERIFY THE GATE WORKS (smoke test for the parity test itself):
//   1. Comment out the `iss?` field on either interface.
//   2. Run `pnpm --filter @aegis/api typecheck`.
//   3. Expect a `Type 'true' is not assignable to type 'false'` error
//      pointing at the constant below.
//   4. Restore the field; typecheck clean.
//
// HOW TO FIX IF THE GATE FIRES IN A REAL CHANGE:
//   The contributor adding a field to one side must add the same field
//   (same name, same type modulo aliases, same optional-ness) to the
//   other side in the same commit. Both interfaces have JSDoc that
//   explains their respective concerns; copy the JSDoc that's relevant
//   to each side rather than mirroring it verbatim.

import type { AgentTokenClaims as NestAgentTokenClaims } from './jwt.util';
import type { AgentTokenClaims as AlgorithmAgentTokenClaims } from '../../modules/verify/algorithm/verify.ports';

// Higher-order-inference structural equality. The function-type wrapper
// is what forces TypeScript to compare X and Y identically rather than
// settling for bivariant assignability. See:
//   https://github.com/microsoft/TypeScript/issues/27024
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
  ? true
  : false;

// Meta-sanity: prove `Equal<>` itself distinguishes identical from
// non-identical shapes. These two lines must BOTH compile for the
// parity gate below to be trustworthy. If a future TypeScript change
// broke higher-order-inference equality, the second line would fail
// to compile and surface the regression BEFORE the gate would.
const _equalIsSoundForIdentical: Equal<{ a: number }, { a: number }> = true;
const _equalIsSoundForDifferent: Equal<{ a: number }, { a: string }> = false;
void _equalIsSoundForIdentical;
void _equalIsSoundForDifferent;

// THE GATE. If parity drifts, this line fails to typecheck.
const _assertNestAlgorithmParity: Equal<NestAgentTokenClaims, AlgorithmAgentTokenClaims> = true;

describe('AgentTokenClaims parity — Nest jwt.util ↔ algorithm verify.ports', () => {
  it('structural equality is asserted at compile time via Equal<Nest, Algorithm>', () => {
    // The real gate is the const above. This test exists so the file is
    // picked up by Jest (and a future contributor doesn't garbage-collect
    // it as "unused"). At runtime the constant is always `true` if the
    // file compiled; the value is a side-effect of the type-level check.
    expect(_assertNestAlgorithmParity).toBe(true);
  });
});
