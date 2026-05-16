#!/usr/bin/env tsx
/**
 * generate-shared-constants — emit sdk-py mirrors of the wire-level
 * constants in `packages/types/src/constants.ts`.
 *
 * Scope: the constants every public-API consumer agrees on by name
 * AND value — header names, trust-band score thresholds, TTL
 * bounds, webhook event identifiers. Anything that, if it drifted
 * between TS and Py, would silently produce a different request /
 * response / cache-key / webhook subscription on the Python side.
 *
 * Output:
 *   - packages/sdk-py/aegis/_shared_constants_generated.py
 *
 * Companion to `generate-denial-reason.ts` (which owns the
 * DENIAL_REASON_PRECEDENCE tuple + DenialReason StrEnum). Same
 * pattern, same CI-gate discipline; kept as a separate file so each
 * generator has a single, narrow responsibility.
 *
 * NOT in scope:
 *   - REDIS_KEY (TS factory functions; Py re-implements with its
 *     own helpers — different ergonomics on each side).
 *   - DENIAL_REASON_PRECEDENCE / DenialReason (owned by
 *     `_denial_reason_generated.py`).
 *   - TOKEN_TTL_DEFAULT_SECONDS (sdk-py-only; documented as known
 *     asymmetry in _constants.py — see comment there).
 *
 * Re-run via: `pnpm gen:shared-constants`.
 * CI gate: `pnpm check:shared-constants-gen` re-runs and asserts
 * `git diff --exit-code` is empty.
 *
 * Determinism: same as denial-reason generator — no timestamps, no
 * randomization, deterministic key ordering by source-of-truth
 * insertion order. Byte-deterministic re-runs are what make the CI
 * gate load-bearing.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const SOURCE = '../packages/types/src/constants.ts';
const PY_OUT = resolve(REPO_ROOT, 'packages/sdk-py/aegis/_shared_constants_generated.py');

interface SharedConstants {
  AEGIS_HEADER_API_KEY: string;
  AEGIS_HEADER_VERIFY_KEY: string;
  AEGIS_HEADER_REQUEST_ID: string;
  AEGIS_HEADER_TOKEN: string;
  AEGIS_HEADER_SIGNATURE: string;
  AEGIS_HEADER_IDEMPOTENCY: string;
  TRUST_BAND_THRESHOLDS: Readonly<Record<string, number>>;
  TOKEN_TTL_MIN_SECONDS: number;
  TOKEN_TTL_MAX_SECONDS: number;
  POLICY_TTL_MAX_DAYS: number;
  VERIFY_RESULT_DEFAULT_TTL_SECONDS: number;
  WEBHOOK_EVENT: Readonly<Record<string, string>>;
}

async function loadConstants(): Promise<SharedConstants> {
  const mod = (await import(SOURCE)) as Partial<SharedConstants>;
  const required = [
    'AEGIS_HEADER_API_KEY',
    'AEGIS_HEADER_VERIFY_KEY',
    'AEGIS_HEADER_REQUEST_ID',
    'AEGIS_HEADER_TOKEN',
    'AEGIS_HEADER_SIGNATURE',
    'AEGIS_HEADER_IDEMPOTENCY',
    'TRUST_BAND_THRESHOLDS',
    'TOKEN_TTL_MIN_SECONDS',
    'TOKEN_TTL_MAX_SECONDS',
    'POLICY_TTL_MAX_DAYS',
    'VERIFY_RESULT_DEFAULT_TTL_SECONDS',
    'WEBHOOK_EVENT',
  ] as const;
  for (const key of required) {
    if (mod[key] === undefined) {
      throw new Error(
        `generate-shared-constants: canonical TS source is missing required export ${key}. ` +
          `Check packages/types/src/constants.ts — exports may have been removed without ` +
          `updating this generator. Each removal needs an explicit cross-language migration plan.`,
      );
    }
  }
  return mod as SharedConstants;
}

/**
 * Render a Python dict literal with stable insertion order. Order
 * matches the source iteration; we do NOT sort so the generator stays
 * deterministic and the source-of-truth ordering remains observable.
 */
function renderPyDict(
  name: string,
  pyType: string,
  entries: ReadonlyArray<readonly [string, string | number]>,
): string[] {
  const lines: string[] = [];
  lines.push(`${name}: Final[${pyType}] = {`);
  for (const [k, v] of entries) {
    const valueRepr = typeof v === 'string' ? JSON.stringify(v) : String(v);
    lines.push(`    ${JSON.stringify(k)}: ${valueRepr},`);
  }
  lines.push('}');
  return lines;
}

export function renderPy(c: SharedConstants): string {
  const lines: string[] = [];
  lines.push('# @generated — do not edit; run `pnpm gen:shared-constants`');
  lines.push('#');
  lines.push('# Wire-level constants mirrored from packages/types/src/constants.ts.');
  lines.push('# Header names, trust-band thresholds, TTL bounds, webhook event IDs —');
  lines.push('# anything that, if it drifted between TS and Py, would silently produce');
  lines.push('# a different request, cache key, or webhook subscription on the Python');
  lines.push('# side. Companion to _denial_reason_generated.py.');
  lines.push('#');
  lines.push('# CI gate `pnpm check:shared-constants-gen` re-runs the generator and');
  lines.push('# fails if this file diverges from the canonical source. Hand edits will');
  lines.push('# be clobbered by the next `pnpm gen:shared-constants` invocation.');
  lines.push('');
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('from typing import Final');
  lines.push('');
  lines.push('# ── HTTP headers ─────────────────────────────────────────────');
  lines.push(`AEGIS_HEADER_API_KEY: Final[str] = ${JSON.stringify(c.AEGIS_HEADER_API_KEY)}`);
  lines.push(`AEGIS_HEADER_VERIFY_KEY: Final[str] = ${JSON.stringify(c.AEGIS_HEADER_VERIFY_KEY)}`);
  lines.push(`AEGIS_HEADER_REQUEST_ID: Final[str] = ${JSON.stringify(c.AEGIS_HEADER_REQUEST_ID)}`);
  lines.push(`AEGIS_HEADER_TOKEN: Final[str] = ${JSON.stringify(c.AEGIS_HEADER_TOKEN)}`);
  lines.push(`AEGIS_HEADER_SIGNATURE: Final[str] = ${JSON.stringify(c.AEGIS_HEADER_SIGNATURE)}`);
  lines.push(`AEGIS_HEADER_IDEMPOTENCY: Final[str] = ${JSON.stringify(c.AEGIS_HEADER_IDEMPOTENCY)}`);
  lines.push('');
  lines.push('# ── Trust band thresholds (lower bound, inclusive) ───────────');
  lines.push(
    ...renderPyDict(
      'TRUST_BAND_THRESHOLDS',
      'dict[str, int]',
      Object.entries(c.TRUST_BAND_THRESHOLDS),
    ),
  );
  lines.push('');
  lines.push('# ── Token / policy TTL bounds ────────────────────────────────');
  lines.push(`TOKEN_TTL_MIN_SECONDS: Final[int] = ${c.TOKEN_TTL_MIN_SECONDS}`);
  lines.push(`TOKEN_TTL_MAX_SECONDS: Final[int] = ${c.TOKEN_TTL_MAX_SECONDS}`);
  lines.push(`POLICY_TTL_MAX_DAYS: Final[int] = ${c.POLICY_TTL_MAX_DAYS}`);
  lines.push('');
  lines.push('# ── Verify-response cache TTL ────────────────────────────────');
  lines.push(`VERIFY_RESULT_DEFAULT_TTL_SECONDS: Final[int] = ${c.VERIFY_RESULT_DEFAULT_TTL_SECONDS}`);
  lines.push('');
  lines.push('# ── Webhook event names ──────────────────────────────────────');
  lines.push(
    ...renderPyDict(
      'WEBHOOK_EVENT',
      'dict[str, str]',
      Object.entries(c.WEBHOOK_EVENT),
    ),
  );
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<number> {
  const c = await loadConstants();

  // Sanity: every webhook event value must be a non-empty string starting
  // with `aegis.` — anything else is either a typo or an upstream contract
  // violation that should fail the generator hard.
  for (const [k, v] of Object.entries(c.WEBHOOK_EVENT)) {
    if (typeof v !== 'string' || !v.startsWith('aegis.') || v.length === 0) {
      process.stderr.write(
        `generate-shared-constants: WEBHOOK_EVENT.${k} = ${JSON.stringify(v)} ` +
          `does not match expected shape (non-empty string starting with "aegis.")\n`,
      );
      return 1;
    }
  }

  // Sanity: TTL bounds must be positive + ordered.
  if (
    c.TOKEN_TTL_MIN_SECONDS <= 0 ||
    c.TOKEN_TTL_MAX_SECONDS <= 0 ||
    c.TOKEN_TTL_MIN_SECONDS > c.TOKEN_TTL_MAX_SECONDS
  ) {
    process.stderr.write(
      `generate-shared-constants: TOKEN_TTL bounds invalid ` +
        `(min=${c.TOKEN_TTL_MIN_SECONDS}, max=${c.TOKEN_TTL_MAX_SECONDS})\n`,
    );
    return 1;
  }

  const py = renderPy(c);
  writeFileSync(PY_OUT, py, 'utf8');
  process.stdout.write(
    `generate-shared-constants: wrote ${Object.keys(c).length} top-level constants\n  ${PY_OUT}\n`,
  );
  return 0;
}

const isDirectInvocation = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);
if (isDirectInvocation) {
  main().then(
    (rc) => process.exit(rc),
    (err: unknown) => {
      process.stderr.write(
        `generate-shared-constants: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
