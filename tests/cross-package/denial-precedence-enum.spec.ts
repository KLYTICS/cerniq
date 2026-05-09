// Cross-package parity test — denial-reason enum across all 4 surfaces.
//
// CLAUDE.md invariant 6 fixes the 10-reason canonical precedence at the
// wire level (TRIAL_EXHAUSTED added 2026-05-05 per ADR-0014). Relying-
// party SDKs build retry / escalation logic on THIS exact order. Adding
// new reasons is non-breaking ONLY at the END of the list; reorders are
// breaking even if the set is unchanged.
//
// The enum lives on (at least) four surfaces. This test confirms they
// agree:
//
//   1. @aegis/types DENIAL_REASON_PRECEDENCE       (canonical SOURCE)
//   2. apps/api engine.interface DenialReason      (must EXACT-match)
//   3. docs/spec/AEGIS_API_SPEC.yaml VerifyResponse.denialReason
//                                                  (must EXACT-match)
//   4. @aegis/verifier-rp DenialReason             (must SUPERSET; may
//                                                   add REPLAY_DETECTED
//                                                   for RP observability
//                                                   per M-016 design)
//
// Why a runtime-checked test over the existing `spec-sync.yml` CI grep:
// the grep job uses `sort -u`, which catches set-difference but NOT
// order. This test is the only thing that catches the alphabetical-
// drift bug class that round 11 had to manually find (POLICY_EXPIRED
// was listed before POLICY_REVOKED in the OpenAPI).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DENIAL_REASON_PRECEDENCE } from '../../packages/types/src/constants';

const REPO_ROOT = join(__dirname, '..', '..');

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract a TypeScript union type's string-literal members from a
 *  source file. Permissive — works for any
 *    `export type X = | 'A' | 'B' | 'C';`
 *  shape regardless of formatting. */
function extractUnionMembers(filePath: string, typeName: string): string[] {
  const source = readFileSync(filePath, 'utf8');
  const re = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([\\s\\S]*?);`, 'm');
  const match = re.exec(source);
  if (!match) {
    throw new Error(`extractUnionMembers: could not find "export type ${typeName}" in ${filePath}`);
  }
  const body = match[1] ?? '';
  return Array.from(body.matchAll(/'([A-Z_][A-Z0-9_]*)'/g)).map((m) => m[1]!);
}

/** Extract the OpenAPI denialReason enum members in declared order. */
function extractOpenApiDenialEnum(): string[] {
  const yaml = readFileSync(join(REPO_ROOT, 'docs', 'spec', 'AEGIS_API_SPEC.yaml'), 'utf8');
  // Find the `denialReason:` block in VerifyResponse, then walk lines
  // until we leave the enum: list. A regex is sufficient — yaml
  // formatting in the spec is consistent.
  const re = /denialReason:[\s\S]*?enum:\s*((?:\s+- [A-Z_][A-Z0-9_]*\n?)+)/;
  const match = re.exec(yaml);
  if (!match) {
    throw new Error('extractOpenApiDenialEnum: could not locate VerifyResponse.denialReason.enum');
  }
  return Array.from((match[1] ?? '').matchAll(/- ([A-Z_][A-Z0-9_]*)/g)).map((m) => m[1]!);
}

/**
 * The OpenAPI wire enum is a SUPERSET of the algorithm chain — it
 * includes `PLAN_LIMIT_EXCEEDED` at position 0 as a billing pre-gate
 * (see `packages/types/src/constants.ts` lines 57-60). The 10-step
 * algorithm-chain surfaces (engine.interface, verifier-rp) do NOT
 * include the pre-gate. Strip it before comparing to CANONICAL.
 */
function extractOpenApiAlgorithmChain(): string[] {
  return extractOpenApiDenialEnum().filter((r) => r !== 'PLAN_LIMIT_EXCEEDED');
}

// ── Sources ──────────────────────────────────────────────────────────

// PLAN_LIMIT_EXCEEDED lives in DENIAL_REASON_PRECEDENCE at position 0 as a
// pre-algorithm billing pre-gate (see constants.ts comment). It is not part
// of the 10-step verify-algorithm chain that engine.interface and
// verifier-rp expose; those surfaces only know about chain reasons.
// We strip it when comparing against algorithm-side surfaces.
const CANONICAL = [...DENIAL_REASON_PRECEDENCE].filter((r) => r !== 'PLAN_LIMIT_EXCEEDED') as string[];

// ── Tests ────────────────────────────────────────────────────────────

describe('denial-reason enum parity (CLAUDE.md invariant 6)', () => {
  it('the canonical source has 10 reasons in fixed precedence order', () => {
    expect(CANONICAL).toEqual([
      'AGENT_NOT_FOUND',
      'AGENT_REVOKED',
      'INVALID_SIGNATURE',
      'POLICY_REVOKED',
      'POLICY_EXPIRED',
      'SCOPE_NOT_GRANTED',
      'TRIAL_EXHAUSTED',
      'SPEND_LIMIT_EXCEEDED',
      'TRUST_SCORE_TOO_LOW',
      'ANOMALY_FLAGGED',
    ]);
  });

  it('engine.interface.ts DenialReason is byte-identical (order + values) to canonical', () => {
    const engineMembers = extractUnionMembers(
      join(REPO_ROOT, 'apps', 'api', 'src', 'common', 'policy-engine', 'engine.interface.ts'),
      'DenialReason',
    );
    expect(engineMembers).toEqual(CANONICAL);
  });

  it('OpenAPI VerifyResponse.denialReason algorithm chain is byte-identical (order + values) to canonical', () => {
    // The wire enum prepends PLAN_LIMIT_EXCEEDED (billing pre-gate);
    // strip it for the algorithm-chain comparison.
    const apiSpecChain = extractOpenApiAlgorithmChain();
    expect(apiSpecChain).toEqual(CANONICAL);
  });

  it('OpenAPI wire enum has PLAN_LIMIT_EXCEEDED at position 0 (billing pre-gate)', () => {
    const apiSpecEnum = extractOpenApiDenialEnum();
    expect(apiSpecEnum[0]).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('@aegis/verifier-rp DenialReason is a SUPERSET of canonical (REPLAY_DETECTED extra is allowed by design)', () => {
    const verifierRpMembers = extractUnionMembers(
      join(REPO_ROOT, 'packages', 'verifier-rp', 'src', 'types.ts'),
      'DenialReason',
    );
    // Every canonical reason must appear (in any order — the verifier-
    // rp surface is RP-observability, not the wire ADR-0004 contract).
    for (const reason of CANONICAL) {
      expect(verifierRpMembers, `canonical reason "${reason}" missing from verifier-rp`).toContain(reason);
    }
    // Allowed extras are an explicit allow-list. Any new addition needs
    // to be added here AND documented in the verifier-rp README so we
    // notice "set drift" deliberately.
    const ALLOWED_EXTRAS = new Set(['REPLAY_DETECTED']);
    const extras = verifierRpMembers.filter((m) => !CANONICAL.includes(m));
    for (const extra of extras) {
      expect(ALLOWED_EXTRAS, `unexpected extra in verifier-rp DenialReason: ${extra}`).toContain(extra);
    }
  });

  it('no surface contains a value the canonical does NOT and the allow-list does NOT — set drift gate', () => {
    // A union of every value seen across sources must equal canonical
    // ∪ ALLOWED_EXTRAS. Anything else means a fifth surface has
    // been added without updating this test.
    const apiSpecEnum = new Set(extractOpenApiDenialEnum());
    const engineMembers = new Set(
      extractUnionMembers(
        join(REPO_ROOT, 'apps', 'api', 'src', 'common', 'policy-engine', 'engine.interface.ts'),
        'DenialReason',
      ),
    );
    const verifierRpMembers = new Set(
      extractUnionMembers(
        join(REPO_ROOT, 'packages', 'verifier-rp', 'src', 'types.ts'),
        'DenialReason',
      ),
    );
    const universe = new Set<string>([...apiSpecEnum, ...engineMembers, ...verifierRpMembers, ...CANONICAL]);
    // PLAN_LIMIT_EXCEEDED is the documented wire-level pre-gate: it appears
    // in the OpenAPI surface (and in @aegis/types DENIAL_REASON_PRECEDENCE
    // at position 0 — the unfiltered version) but not in the algorithm-chain
    // surfaces. REPLAY_DETECTED is the documented verifier-rp observability
    // extra (M-016 design).
    const allowed = new Set<string>([...CANONICAL, 'REPLAY_DETECTED', 'PLAN_LIMIT_EXCEEDED']);
    for (const v of universe) {
      expect(allowed, `value "${v}" appears on some surface but is not in canonical or ALLOWED_EXTRAS`).toContain(v);
    }
  });
});
