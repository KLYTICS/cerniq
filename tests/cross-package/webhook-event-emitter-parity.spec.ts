// Cross-package parity — webhook event NAMES emitted by the API
// vs the catalog in @aegis/types.
//
// The discovery (2026-05-22, this session): `apps/api/src/modules/
// policy/policy.expiry.worker.ts:144` emits
// `type: 'okoro.policy.expired'` — a string that does NOT match any
// value in `WEBHOOK_EVENT`. Subscriptions match on exact string
// (`events: { has: event.type }` in webhooks.service.ts:65), so
// every customer subscribed to `aegis.agent.policy_expired` (the
// catalog name) has been silently missing these events since the
// worker shipped.
//
// This spec is the regression net: it scans every API source file
// for `type: '...'` literals inside `enqueue(...)` calls and asserts
// each one matches a value in WEBHOOK_EVENT. Any future drift
// (typo, prefix change, abandoned-event-not-cleaned-up) fails CI.
//
// Strategy: AST-free regex over the API source. Same pattern as
// the M-IDEM-4 / M-WEBHOOK-1 parity gates — fast, no NestJS
// bootstrap required, runs in low milliseconds.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBHOOK_EVENT } from '../../packages/types/src/constants';

const REPO_ROOT = join(__dirname, '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');

/**
 * Recursively walk a directory, returning all `.ts` files except
 * `.spec.ts` (test files may reference legacy event names for
 * regression coverage and we don't want to assert against those).
 */
function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

interface Emission {
  file: string;
  line: number;
  eventName: string;
}

/**
 * Extract every `type: ...` value that appears within a webhook
 * enqueue() call. Supports two emission forms:
 *
 *   1. String literal: `type: 'aegis.agent.policy_expired'`
 *      → recorded as-is. Validated against WEBHOOK_EVENT below.
 *   2. Catalog constant: `type: WEBHOOK_EVENT.AGENT_POLICY_EXPIRED`
 *      → resolved by reading the WEBHOOK_EVENT object at runtime.
 *      Always valid by construction.
 *
 * Form #2 is the preferred path — refactor-safe, drift-proof — but
 * the gate accepts either so legacy literal-emitters still get
 * checked while the codebase migrates.
 *
 * Heuristic over AST: regex match within ~10 lines after `.enqueue(`
 * opens. No false positives in the current codebase; cheap and easy
 * to debug.
 */
function extractWebhookEmissions(): Emission[] {
  const out: Emission[] = [];
  const ENQUEUE_OPEN_RE = /\.enqueue\s*\(/;
  const TYPE_LITERAL_RE = /^\s*type:\s*(['"`])([^'"`\n]+)\1/;
  const TYPE_CATALOG_RE = /^\s*type:\s*WEBHOOK_EVENT\.([A-Z_]+)/;

  for (const file of walkTsFiles(API_SRC)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!ENQUEUE_OPEN_RE.test(lines[i]!)) continue;
      // 20-line scan window: large enough to accommodate inline
      // comment blocks between `.enqueue(` and the `type:` field
      // (the policy.expiry worker carries a 10-line rationale
      // comment above the type field — see comment at
      // policy.expiry.worker.ts:142).
      for (let j = 1; j <= 20 && i + j < lines.length; j += 1) {
        const line = lines[i + j]!;
        const litMatch = TYPE_LITERAL_RE.exec(line);
        if (litMatch) {
          out.push({
            file: relative(REPO_ROOT, file),
            line: i + j + 1,
            eventName: litMatch[2]!,
          });
          break;
        }
        const catMatch = TYPE_CATALOG_RE.exec(line);
        if (catMatch) {
          const key = catMatch[1]!;
          const resolved = (WEBHOOK_EVENT as Record<string, string>)[key];
          if (resolved === undefined) {
            // Catalog reference to a key that doesn't exist — record
            // the raw key so the drift check below reports a useful
            // error rather than silently dropping the emission.
            out.push({
              file: relative(REPO_ROOT, file),
              line: i + j + 1,
              eventName: `<unresolved WEBHOOK_EVENT.${key}>`,
            });
          } else {
            out.push({
              file: relative(REPO_ROOT, file),
              line: i + j + 1,
              eventName: resolved,
            });
          }
          break;
        }
      }
    }
  }
  return out;
}

describe('webhook event emitter parity', () => {
  const catalogValues = new Set<string>(Object.values(WEBHOOK_EVENT));

  it('detects at least one emit site (sanity check on the extractor)', () => {
    const emissions = extractWebhookEmissions();
    expect(emissions.length).toBeGreaterThanOrEqual(1);
  });

  it('every webhook event emitted by the API matches a catalog entry', () => {
    const emissions = extractWebhookEmissions();
    const drift = emissions.filter((e) => !catalogValues.has(e.eventName));
    // Build a readable failure message: each drift entry gets a line
    // with file:line + emitted name + suggested catalog values.
    if (drift.length > 0) {
      const message = drift
        .map(
          (d) =>
            `  ${d.file}:${d.line} emits "${d.eventName}" but no such ` +
            `value exists in WEBHOOK_EVENT. Valid catalog entries: ` +
            `${Array.from(catalogValues).join(', ')}`,
        )
        .join('\n');
      throw new Error(
        `Webhook event drift detected (${drift.length} site(s)):\n${message}`,
      );
    }
    expect(drift).toEqual([]);
  });

  it('reports legitimate emit sites (regression coverage)', () => {
    const emissions = extractWebhookEmissions();
    const names = new Set(emissions.map((e) => e.eventName));
    // Sanity: we expect both known emit sites to be discovered.
    expect(names).toContain(WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED);
    expect(names).toContain(WEBHOOK_EVENT.AGENT_POLICY_EXPIRED);
  });
});
