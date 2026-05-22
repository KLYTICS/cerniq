#!/usr/bin/env tsx
/**
 * generate-error-catalog — emit downstream-language mirrors of the
 * server-side ERROR_CATALOG (apps/api/src/common/errors/error-catalog.ts).
 *
 * The catalog is the single source of truth for SDK retry semantics. This
 * script keeps the TS package types and the Python SDK in lockstep with
 * the server source. Output files are committed (not gitignored) so
 * downstream installs work without a build step.
 *
 * Outputs:
 *   - packages/types/src/error-catalog.generated.ts
 *   - packages/sdk-py/okoro/error_catalog.py
 *
 * Both files start with a `// @generated` (or `# @generated`) banner. Do
 * not hand-edit. Re-run via `pnpm tsx scripts/generate-error-catalog.ts`.
 *
 * Strategy: dynamic-import the live ERROR_CATALOG via tsx so we read the
 * actual frozen object at build time — no parsing, no drift.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ErrorCatalogEntry {
  code: string;
  httpStatus: number;
  retryable: boolean;
  backoff?: 'none' | 'linear' | 'exponential' | 'on_retry_after_header';
  customerMessage: string;
  category: 'auth' | 'validation' | 'policy' | 'rate_limit' | 'billing' | 'crypto' | 'transient' | 'internal';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const CATALOG_SOURCE = '../apps/api/src/common/errors/error-catalog.ts';
const TS_OUT = resolve(REPO_ROOT, 'packages/types/src/error-catalog.generated.ts');
const PY_OUT = resolve(REPO_ROOT, 'packages/sdk-py/okoro/error_catalog.py');

async function loadCatalog(): Promise<Readonly<Record<string, ErrorCatalogEntry>>> {
  const mod = (await import(CATALOG_SOURCE)) as {
    ERROR_CATALOG: Readonly<Record<string, ErrorCatalogEntry>>;
  };
  return mod.ERROR_CATALOG;
}

/** Stable JSON: keys sorted by class name for deterministic diffs. */
function sortedEntries(catalog: Readonly<Record<string, ErrorCatalogEntry>>): Array<[string, ErrorCatalogEntry]> {
  return Object.keys(catalog)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => {
      const v = catalog[k];
      if (!v) throw new Error(`unreachable: missing entry for ${k}`);
      return [k, v] as [string, ErrorCatalogEntry];
    });
}

function renderTs(catalog: Readonly<Record<string, ErrorCatalogEntry>>): string {
  const lines: string[] = [];
  lines.push('// @generated — do not edit; run pnpm gen:error-catalog');
  lines.push('//');
  lines.push('// Mirror of apps/api/src/common/errors/error-catalog.ts. The SDK consults');
  lines.push('// this for retry decisions, customer messages, and category routing.');
  lines.push('// Keys are stable lower-snake-case `code` values; values include the');
  lines.push('// JS class name they originated from.');
  lines.push('');
  lines.push("export type Backoff = 'none' | 'linear' | 'exponential' | 'on_retry_after_header';");
  lines.push("export type Category =");
  lines.push("  | 'auth'");
  lines.push("  | 'validation'");
  lines.push("  | 'policy'");
  lines.push("  | 'rate_limit'");
  lines.push("  | 'billing'");
  lines.push("  | 'crypto'");
  lines.push("  | 'transient'");
  lines.push("  | 'internal';");
  lines.push('');
  lines.push('export interface ErrorCatalogEntry {');
  lines.push('  /** JS class name from the API source. */');
  lines.push('  className: string;');
  lines.push('  /** Stable lower-snake-case identifier — match on this. */');
  lines.push('  code: string;');
  lines.push('  httpStatus: number;');
  lines.push('  retryable: boolean;');
  lines.push('  backoff?: Backoff;');
  lines.push('  customerMessage: string;');
  lines.push('  category: Category;');
  lines.push('}');
  lines.push('');
  lines.push('/** Catalog keyed by stable `code` (lower-snake-case). */');
  lines.push('export const GENERATED_ERROR_CATALOG: Readonly<Record<string, ErrorCatalogEntry>> = Object.freeze({');
  for (const [className, entry] of sortedEntries(catalog)) {
    const quotedCode = JSON.stringify(entry.code);
    const quotedMsg = JSON.stringify(entry.customerMessage);
    const backoff = entry.backoff !== undefined ? `, backoff: ${JSON.stringify(entry.backoff)}` : '';
    lines.push(`  [${quotedCode}]: Object.freeze({`);
    lines.push(`    className: ${JSON.stringify(className)},`);
    lines.push(`    code: ${quotedCode},`);
    lines.push(`    httpStatus: ${entry.httpStatus},`);
    lines.push(`    retryable: ${entry.retryable}${backoff},`);
    lines.push(`    customerMessage: ${quotedMsg},`);
    lines.push(`    category: ${JSON.stringify(entry.category)},`);
    lines.push(`  }),`);
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

function pyRepr(value: string | number | boolean): string {
  if (typeof value === 'string') {
    // Python and JSON string literals are byte-compatible for our chars
    // (ASCII printable, no NUL). JSON.stringify gives correctly escaped
    // double-quoted form.
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

function renderPy(catalog: Readonly<Record<string, ErrorCatalogEntry>>): string {
  const lines: string[] = [];
  lines.push('# @generated — do not edit; run pnpm gen:error-catalog');
  lines.push('#');
  lines.push('# Mirror of apps/api/src/common/errors/error-catalog.ts. Keyed by');
  lines.push('# stable lower-snake-case `code`. The Python SDK consults this for');
  lines.push('# retry decisions, customer messages, and category routing.');
  lines.push('');
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('from typing import Final, TypedDict');
  lines.push('');
  lines.push('');
  lines.push('class ErrorCatalogEntry(TypedDict, total=False):');
  lines.push('    className: str');
  lines.push('    code: str');
  lines.push('    httpStatus: int');
  lines.push('    retryable: bool');
  lines.push('    backoff: str  # one of: none, linear, exponential, on_retry_after_header');
  lines.push('    customerMessage: str');
  lines.push('    category: str  # auth|validation|policy|rate_limit|billing|crypto|transient|internal');
  lines.push('');
  lines.push('');
  lines.push('GENERATED_ERROR_CATALOG: Final[dict[str, ErrorCatalogEntry]] = {');
  for (const [className, entry] of sortedEntries(catalog)) {
    lines.push(`    ${pyRepr(entry.code)}: {`);
    lines.push(`        "className": ${pyRepr(className)},`);
    lines.push(`        "code": ${pyRepr(entry.code)},`);
    lines.push(`        "httpStatus": ${pyRepr(entry.httpStatus)},`);
    lines.push(`        "retryable": ${pyRepr(entry.retryable)},`);
    if (entry.backoff !== undefined) {
      lines.push(`        "backoff": ${pyRepr(entry.backoff)},`);
    }
    lines.push(`        "customerMessage": ${pyRepr(entry.customerMessage)},`);
    lines.push(`        "category": ${pyRepr(entry.category)},`);
    lines.push(`    },`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<number> {
  const catalog = await loadCatalog();
  const ts = renderTs(catalog);
  const py = renderPy(catalog);
  writeFileSync(TS_OUT, ts, 'utf8');
  writeFileSync(PY_OUT, py, 'utf8');
  const codes = Object.values(catalog).map((e) => e.code);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length > 0) {
    process.stderr.write(`generate-error-catalog: duplicate codes detected: ${dupes.join(', ')}\n`);
    return 1;
  }
  process.stdout.write(
    `generate-error-catalog: wrote ${codes.length} entries\n  ${TS_OUT}\n  ${PY_OUT}\n`,
  );
  return 0;
}

main().then(
  (rc) => process.exit(rc),
  (err: unknown) => {
    process.stderr.write(`generate-error-catalog: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
