#!/usr/bin/env tsx
/**
 * generate-denial-reason — emit the SDK's `DenialReason` union from the
 * canonical `DENIAL_REASON_PRECEDENCE` tuple in `packages/types/src/constants.ts`.
 *
 * The server-side precedence tuple is the single source of truth for the
 * order top-wins denials are evaluated in `verifyAlgorithm`. The SDK ships
 * its own copy of the union type so relying parties can switch on
 * `denialReason` exhaustively. This script keeps them in lockstep.
 *
 * Output:
 *   - packages/sdk-ts/src/denial-reason.generated.ts
 *
 * The output is committed (not gitignored) so consumers of the SDK don't
 * need a build step. Re-run via `pnpm gen:denial-reason`.
 *
 * Strategy: dynamic-import the live tuple via tsx so we read the actual
 * frozen array at build time — no parsing, no drift.
 *
 * Determinism: the generator preserves the precedence-tuple order exactly
 * (it does NOT sort) because that order is itself canonical. Same input
 * therefore yields byte-equal output every run.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const SOURCE = '../packages/types/src/constants.ts';
const TS_OUT = resolve(REPO_ROOT, 'packages/sdk-ts/src/denial-reason.generated.ts');

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
  process.stdout.write(
    `generate-denial-reason: wrote ${precedence.length} reasons\n  ${TS_OUT}\n`,
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
