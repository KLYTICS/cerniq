#!/usr/bin/env tsx
/**
 * generate-denial-reason — emit `DenialReason` mirrors for the public SDKs
 * from the canonical `DENIAL_REASON_PRECEDENCE` tuple in
 * `packages/types/src/constants.ts`.
 *
 * The server-side precedence tuple is the single source of truth for the
 * order top-wins denials are evaluated in `verifyAlgorithm`. Both SDKs
 * ship their own copy of the union/enum so relying parties can switch
 * exhaustively. This script keeps them all in lockstep.
 *
 * Outputs:
 *   - packages/sdk-ts/src/denial-reason.generated.ts
 *   - packages/sdk-py/aegis/_denial_reason_generated.py
 *
 * Both outputs are committed (not gitignored) so consumers of either SDK
 * don't need a build step. Re-run via `pnpm gen:denial-reason`.
 * CI gate (`pnpm check:denial-reason-gen`) re-runs this generator and
 * fails if the committed outputs diverge from the canonical source.
 *
 * Strategy: dynamic-import the live tuple via tsx so we read the actual
 * frozen array at build time — no parsing, no drift.
 *
 * Determinism: the generator preserves the precedence-tuple order exactly
 * (it does NOT sort) because that order is itself canonical. Same input
 * therefore yields byte-equal output every run. Determinism is what makes
 * the CI gate's `git diff --exit-code` check load-bearing.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const SOURCE = '../packages/types/src/constants.ts';
const TS_OUT = resolve(REPO_ROOT, 'packages/sdk-ts/src/denial-reason.generated.ts');
const PY_OUT = resolve(REPO_ROOT, 'packages/sdk-py/aegis/_denial_reason_generated.py');

async function loadPrecedence(): Promise<readonly string[]> {
  const mod = (await import(SOURCE)) as {
    DENIAL_REASON_PRECEDENCE: readonly string[];
  };
  return mod.DENIAL_REASON_PRECEDENCE;
}

export function renderTs(precedence: readonly string[]): string {
  const lines: string[] = [];
  lines.push('// @generated — do not edit; run pnpm gen:denial-reason');
  lines.push('//');
  lines.push('// Mirror of DENIAL_REASON_PRECEDENCE in packages/types/src/constants.ts.');
  lines.push('// Order matches the canonical precedence (top-wins). Relying-party SDK');
  lines.push('// consumers switch on this union to handle each denial reason.');
  lines.push('');
  lines.push('export const DENIAL_REASONS = [');
  for (const r of precedence) {
    lines.push(`  ${JSON.stringify(r)},`);
  }
  lines.push('] as const;');
  lines.push('');
  lines.push('export type DenialReason = (typeof DENIAL_REASONS)[number];');
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the sdk-py side as a generated module exporting:
 *   - DENIAL_REASON_PRECEDENCE: Final[tuple[str, ...]]
 *   - DenialReason: StrEnum (with Python <3.11 fallback shim matching
 *                            the pattern in models.py)
 *
 * The shape must be parseable by the regex-based parity test
 * `tests/cross-package/denial-reason-sdk-py-parity.spec.ts` as belt-and-
 * braces against hand edits to this generated file. Specifically:
 *   - tuple form `DENIAL_REASON_PRECEDENCE: Final[tuple[str, ...]] = ( ... )`
 *   - enum members on lines starting with exactly 4 spaces, format
 *     `NAME = "NAME"` (self-equal, StrEnum invariant).
 */
export function renderPy(precedence: readonly string[]): string {
  const lines: string[] = [];
  lines.push('# @generated — do not edit; run `pnpm gen:denial-reason`');
  lines.push('#');
  lines.push('# Mirror of DENIAL_REASON_PRECEDENCE in packages/types/src/constants.ts.');
  lines.push('# Order matches the canonical precedence (top-wins). Relying-party SDK');
  lines.push('# consumers switch on this enum to handle each denial reason exhaustively.');
  lines.push('#');
  lines.push('# CI gate `pnpm check:denial-reason-gen` re-runs the generator and fails');
  lines.push('# if this file diverges from the canonical source. Hand edits will be');
  lines.push('# clobbered by the next `pnpm gen:denial-reason` invocation.');
  lines.push('');
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('import sys');
  lines.push('from typing import Final');
  lines.push('');
  lines.push('if sys.version_info >= (3, 11):');
  lines.push('    from enum import StrEnum');
  lines.push('else:');
  lines.push('    from enum import Enum');
  lines.push('');
  lines.push('    class StrEnum(str, Enum):  # type: ignore[no-redef]');
  lines.push('        """Backport of StrEnum for Python <3.11."""');
  lines.push('');
  lines.push('');
  lines.push('DENIAL_REASON_PRECEDENCE: Final[tuple[str, ...]] = (');
  for (const r of precedence) {
    // Single-line entries with no inline comment — the canonical source
    // owns the per-reason rationale; generated mirrors stay shape-only
    // so the parity-test regex can parse them deterministically.
    lines.push(`    ${JSON.stringify(r)},`);
  }
  lines.push(')');
  lines.push('');
  lines.push('');
  lines.push('class DenialReason(StrEnum):');
  lines.push('    """Denial-reason enum mirroring DENIAL_REASON_PRECEDENCE.');
  lines.push('');
  lines.push('    StrEnum invariant: each member\'s value equals its name so the');
  lines.push('    wire-format string never silently diverges from the Python');
  lines.push('    identifier on serialization.');
  lines.push('    """');
  lines.push('');
  for (const r of precedence) {
    lines.push(`    ${r} = ${JSON.stringify(r)}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<number> {
  const precedence = await loadPrecedence();
  if (precedence.length === 0) {
    process.stderr.write('generate-denial-reason: precedence is empty\n');
    return 1;
  }
  const dupes = precedence.filter((r, i) => precedence.indexOf(r) !== i);
  if (dupes.length > 0) {
    process.stderr.write(`generate-denial-reason: duplicate reasons detected: ${dupes.join(', ')}\n`);
    return 1;
  }
  const ts = renderTs(precedence);
  writeFileSync(TS_OUT, ts, 'utf8');
  const py = renderPy(precedence);
  writeFileSync(PY_OUT, py, 'utf8');
  process.stdout.write(
    `generate-denial-reason: wrote ${precedence.length} reasons\n  ${TS_OUT}\n  ${PY_OUT}\n`,
  );
  return 0;
}

// Only run main when invoked as a script (not when imported by tests).
const isDirectInvocation = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);
if (isDirectInvocation) {
  main().then(
    (rc) => process.exit(rc),
    (err: unknown) => {
      process.stderr.write(`generate-denial-reason: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
