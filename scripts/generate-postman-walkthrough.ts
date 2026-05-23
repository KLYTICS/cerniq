#!/usr/bin/env tsx
/**
 * generate-postman-walkthrough — emit the "Denial Precedence Walk-through"
 * folder of `tools/postman/aegis.collection.json` from the canonical
 * `DENIAL_REASON_PRECEDENCE` tuple in `packages/types/src/constants.ts`.
 *
 * Closes OPERATOR_DECISIONS OD-019.e — the 2026-05-15 INTENT_MISMATCH
 * append (commit a51c894) had to be hand-edited into both the canonical
 * source AND the Postman walk-through; this generator removes the manual
 * second step so the next denial-reason addition only needs to land in
 * `@aegis/types` (plus its fixture map below).
 *
 * Strategy: dynamic-import the live precedence tuple via tsx, render each
 * entry from a per-reason fixture map, splice the new entries into the
 * existing collection in place of the walk-through folder's `item` array,
 * and write back. EVERYTHING outside the walk-through folder is preserved
 * bit-for-bit by string-splicing rather than `JSON.parse` + re-stringify
 * (which would re-flow the entire 1182-line document and obscure intent).
 *
 * Determinism: same input → byte-equal output. No timestamps, no random
 * ordering. The validator at `tools/postman/scripts/validate.ts` is the
 * downstream gate; the CI check `pnpm check:postman-walkthrough-gen`
 * re-runs this script and asserts `git diff --exit-code` is empty.
 *
 * Forward-compat: if `@aegis/types` exports a denial reason for which
 * this script has no fixture, we emit a TODO-marked scaffold entry so
 * the gap surfaces in the diff but the build doesn't break.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const PRECEDENCE_SOURCE = '../packages/types/src/constants.ts';
const COLLECTION_PATH = resolve(
  REPO_ROOT,
  'tools/postman/aegis.collection.json',
);

const FOLDER_NAME = 'Denial Precedence Walk-through';

// Indentation matches the hand-authored file: each entry's opening `{`
// sits at column 9 (8 spaces). Keep these as constants so any future
// re-flow only has to touch one place.
const INDENT_ENTRY = '        '; // 8 spaces — entry brace
const INDENT_FIELD = '          '; // 10 spaces — entry top-level field
const INDENT_NESTED1 = '            '; // 12 spaces
const INDENT_NESTED2 = '              '; // 14 spaces
const INDENT_NESTED3 = '                '; // 16 spaces
const INDENT_NESTED4 = '                  '; // 18 spaces

interface WalkthroughEntry {
  /** Per-entry index — the entry is named "{index}. {reason}". */
  index: number;
  /** Denial-reason identifier — also used in the test assertion. */
  reason: string;
  /** HTTP method — every current entry is POST. */
  method: 'POST';
  /** Header lines as already-rendered inline objects. */
  headers: ReadonlyArray<{ key: string; value: string }>;
  /** Request body — JSON.stringify is NOT applied; supply the JSON text. */
  bodyRaw: string;
  /** URL specification — `raw`, `host[]`, `path[]`. */
  url: { raw: string; host: readonly string[]; path: readonly string[] };
  /** Free-form human description, may contain `\n` for paragraph breaks. */
  description: string;
  /** Pre-rendered test-script lines (each becomes one element of `exec`). */
  testExec: readonly string[];
}

/**
 * Per-reason fixture map. Each function returns the entry data for the
 * walk-through; the renderer below stitches it into the v2.1 envelope.
 *
 * Shapes are ported verbatim from the hand-authored walkthrough in
 * `tools/postman/aegis.collection.json` lines 778-1178 so a first
 * generation produces byte-identical output to the current state.
 *
 * To add a new reason: append it to DENIAL_REASON_PRECEDENCE in
 * `@aegis/types` and add a matching entry here. If the script sees a
 * reason without a fixture it emits a clearly-marked TODO scaffold.
 */
type FixtureFactory = (index: number, reason: string) => WalkthroughEntry;

const VERIFY_TEST_EXEC = (reason: string): string[] => [
  `pm.test('denialReason = ${reason}', function () {`,
  '  const body = pm.response.json();',
  '  pm.expect(body.valid).to.eql(false);',
  `  pm.expect(body.denialReason).to.eql('${reason}');`,
  '});',
];

const VERIFY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-AEGIS-Verify-Key', value: '{{verify_key}}' },
  { key: 'Content-Type', value: 'application/json' },
];

const VERIFY_URL = {
  raw: '{{base_url}}/v1/verify',
  host: ['{{base_url}}'],
  path: ['v1', 'verify'],
} as const;

const FIXTURES: ReadonlyMap<string, FixtureFactory> = new Map<
  string,
  FixtureFactory
>([
  [
    'AGENT_NOT_FOUND',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhZ3RfMDAwMDAwMDAwMDAwMDAwMDAwMDBfTk9UX0ZPVU5EIn0.SIG",\n  "action": "commerce.purchase",\n  "amount": 1\n}',
      url: VERIFY_URL,
      description:
        'Precondition: craft a token with a `sub` claim that matches no row in `AgentIdentity`. Easiest: take a working token and rewrite the agentId to a random ULID. Expect `denialReason: AGENT_NOT_FOUND` (precedence position 1).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'AGENT_REVOKED',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "commerce.purchase",\n  "amount": 1\n}',
      url: VERIFY_URL,
      description:
        'Precondition: DELETE the agent (Identity → Revoke agent), then replay the previously-valid token within seconds. Expect `denialReason: AGENT_REVOKED` (position 2).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'INVALID_SIGNATURE',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhZ2VudF9pZCJ9.AAAA_INVALID_SIGNATURE_AAAA",\n  "action": "commerce.purchase",\n  "amount": 1\n}',
      url: VERIFY_URL,
      description:
        'Precondition: take a working JWT and tamper with the signature segment (last `.`-separated chunk). Expect `denialReason: INVALID_SIGNATURE` (position 3).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'POLICY_REVOKED',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "commerce.purchase",\n  "amount": 1\n}',
      url: VERIFY_URL,
      description:
        'Precondition: call DELETE /v1/agents/{agentId}/policies/{policyId} on the policy that minted `{{policy_token}}`, then replay the token. Expect `denialReason: POLICY_REVOKED` (position 4).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'POLICY_EXPIRED',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "commerce.purchase",\n  "amount": 1\n}',
      url: VERIFY_URL,
      description:
        'Precondition: create a policy with `expiresAt` 60s in the future, capture its `signedToken`, wait 60s, then verify. Expect `denialReason: POLICY_EXPIRED` (position 5).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'SCOPE_NOT_GRANTED',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "data-write.delete_account",\n  "amount": 0\n}',
      url: VERIFY_URL,
      description:
        'Precondition: hold a policy that only grants `commerce` scope, then verify with `action: data-write.delete_account`. Expect `denialReason: SCOPE_NOT_GRANTED` (position 6).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'TRIAL_EXHAUSTED',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "commerce.purchase",\n  "amount": 1\n}',
      url: VERIFY_URL,
      description:
        'Precondition: principal is on the FREE_TRIAL plan and has consumed >= `trialVerifiesCap` (default 10,000 per ADR-0014). Any subsequent verify denies with `denialReason: TRIAL_EXHAUSTED` (position 7) — distinct from `PLAN_LIMIT_EXCEEDED` (paid-tier monthly cap) and `SPEND_LIMIT_EXCEEDED` (per-policy spend cap). Maps to HTTP 200 verify response with `valid:false`. The pre-algorithm billing path may also surface this as HTTP 402 outside the verify envelope.',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'SPEND_LIMIT_EXCEEDED',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "commerce.purchase",\n  "amount": 999999.00,\n  "currency": "USD",\n  "merchantDomain": "delta.com"\n}',
      url: VERIFY_URL,
      description:
        'Precondition: create a policy with `maxPerTransaction: 500`, then verify with `amount: 999999`. Expect `denialReason: SPEND_LIMIT_EXCEEDED` (position 8).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'TRUST_SCORE_TOO_LOW',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "commerce.purchase",\n  "amount": 1.00\n}',
      url: VERIFY_URL,
      description:
        "Precondition: hammer the agent with `eventType: fraud_confirmed, severity: critical` reports until BATE pushes its trust score below the relying party's minimum band (FLAGGED). Expect `denialReason: TRUST_SCORE_TOO_LOW` (position 9).",
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    'ANOMALY_FLAGGED',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: VERIFY_HEADERS,
      bodyRaw:
        '{\n  "token": "{{policy_token}}",\n  "action": "commerce.purchase",\n  "amount": 100,\n  "context": {\n    "velocity_60s": 50,\n    "geo_jump_km": 9000\n  }\n}',
      url: VERIFY_URL,
      description:
        'Precondition: send a context block with strong anomaly signals (high velocity, impossible geo jump, brand-new merchant for a long-running agent). The BATE realtime layer flags it. Expect `denialReason: ANOMALY_FLAGGED` (position 10).',
      testExec: VERIFY_TEST_EXEC(reason),
    }),
  ],
  [
    // Special case per ADR-0017 D3: INTENT_MISMATCH lives on the
    // /v1/intent/{id}/actuals surface (Phase 2 dual-endpoint), not on
    // /v1/verify. Body shape, header set (API key + Idempotency-Key),
    // and test assertion (recommendedDenialReason + mismatches[]) all
    // differ from the verify-path entries above.
    'INTENT_MISMATCH',
    (index, reason) => ({
      index,
      reason,
      method: 'POST',
      headers: [
        { key: 'X-AEGIS-API-Key', value: '{{api_key}}' },
        { key: 'Content-Type', value: 'application/json' },
        {
          key: 'Idempotency-Key',
          value: 'walk-through-intent-mismatch-{{$timestamp}}',
        },
      ],
      bodyRaw:
        '{\n  "actuals": [{\n    "observedAt": {{$timestamp}},\n    "kind": "commerce-action",\n    "payload": { "action": "acp.payment", "merchantId": "ROGUE-MERCHANT", "amount": "500.00", "currency": "USD" }\n  }]\n}',
      url: {
        raw: '{{base_url}}/v1/intent/{{manifest_id}}/actuals',
        host: ['{{base_url}}'],
        path: ['v1', 'intent', '{{manifest_id}}', 'actuals'],
      },
      description:
        "Precondition: issue an intent manifest first via POST /v1/intent declaring a bounded action (e.g. action='acp.payment', merchantId='ACME-FLORIST', amountCap=$200, strictness='strict'). Capture the returned `manifestId` into the environment variable {{manifest_id}}. Then POST actuals that VIOLATE the declared intent (this fixture sends a wrong merchantId AND an amount over the cap to trigger two mismatches). Under strict reconciliation, expect HTTP 200 with `recommendedDenialReason: 'INTENT_MISMATCH'` and a non-empty `mismatches[]` array containing entries with `kind: 'wrong-merchant'` and `kind: 'over-amount-cap'`.\n\nWire-surface note: INTENT_MISMATCH is emitted from POST /v1/intent/{manifestId}/actuals, NOT POST /v1/verify (per ADR-0017 D3 — Phase 2 keeps intent denials in the dedicated /v1/intent/* response surface). The other 10 walk-through entries above all hit /v1/verify; this one hits the intent reconciliation endpoint. Precedence position 11 (per `DENIAL_REASON_PRECEDENCE` in `packages/types/src/constants.ts`, ADR-0016 DECISION 3).\n\nCross-RP travel: the same reconciliation also fires `INTENT_MISMATCH_OBSERVED` to BATE (`apps/api/src/modules/bate/bate.weights.ts:57` — `-100` per signal, `300` per-window cap). The agent's trust score drops; subsequent /v1/verify calls for the same agent against ANY relying party may return `TRUST_SCORE_TOO_LOW` (position 9) once the band cutoff is crossed.",
      testExec: [
        `pm.test('recommendedDenialReason = ${reason}', function () {`,
        '  const body = pm.response.json();',
        `  pm.expect(body.recommendedDenialReason).to.eql('${reason}');`,
        '  pm.expect(body.mismatches).to.be.an(\'array\').that.is.not.empty;',
        '});',
      ],
    }),
  ],
]);

/**
 * Fallback fixture for any denial reason exported by `@aegis/types`
 * without a registered FIXTURES entry. The output is intentionally
 * minimal and prefixed with TODO so the gap surfaces loudly in the
 * `git diff` produced by the next generator run — but the file stays
 * structurally valid (validator + JSON parser both pass), so a forgetful
 * reason addition doesn't brick the whole pipeline.
 */
function todoFixture(index: number, reason: string): WalkthroughEntry {
  return {
    index,
    reason,
    method: 'POST',
    headers: VERIFY_HEADERS,
    bodyRaw: `{\n  "TODO": "scaffold — add a real fixture for ${reason} in scripts/generate-postman-walkthrough.ts"\n}`,
    url: VERIFY_URL,
    description: `TODO(${reason}): no fixture registered in scripts/generate-postman-walkthrough.ts FIXTURES map. Add a per-reason factory that reproduces the conditions for this denial in the public verify path (or its emitting endpoint). Generated scaffold — do not ship to partners as-is.`,
    testExec: VERIFY_TEST_EXEC(reason),
  };
}

/**
 * Render a single header object on one line. Matches the hand-authored
 * shape: `{ "key": "X", "value": "Y" }`.
 */
function renderHeaderLine(h: { key: string; value: string }): string {
  return `{ "key": ${JSON.stringify(h.key)}, "value": ${JSON.stringify(h.value)} }`;
}

/**
 * Render the inline-string-array form used for `host` and `path`:
 *   ["a", "b", "c"]   (no inner newlines, single space after each comma)
 */
function renderInlineStringArray(xs: readonly string[]): string {
  return `[${xs.map((s) => JSON.stringify(s)).join(', ')}]`;
}

/**
 * Render one walk-through entry into the exact textual shape used by
 * the existing collection. Returns lines WITHOUT a trailing newline on
 * the closing `}` — callers join with `,\n` between entries.
 */
export function renderEntry(entry: WalkthroughEntry): string {
  const lines: string[] = [];
  lines.push(`${INDENT_ENTRY}{`);
  lines.push(
    `${INDENT_FIELD}"name": ${JSON.stringify(`${entry.index}. ${entry.reason}`)},`,
  );

  // event[] — test script wrapper
  lines.push(`${INDENT_FIELD}"event": [`);
  lines.push(`${INDENT_NESTED1}{`);
  lines.push(`${INDENT_NESTED2}"listen": "test",`);
  lines.push(`${INDENT_NESTED2}"script": {`);
  lines.push(`${INDENT_NESTED3}"type": "text/javascript",`);
  lines.push(`${INDENT_NESTED3}"exec": [`);
  for (let i = 0; i < entry.testExec.length; i++) {
    const line = entry.testExec[i] ?? '';
    const isLast = i === entry.testExec.length - 1;
    lines.push(`${INDENT_NESTED4}${JSON.stringify(line)}${isLast ? '' : ','}`);
  }
  lines.push(`${INDENT_NESTED3}]`);
  lines.push(`${INDENT_NESTED2}}`);
  lines.push(`${INDENT_NESTED1}}`);
  lines.push(`${INDENT_FIELD}],`);

  // request{}
  lines.push(`${INDENT_FIELD}"request": {`);
  lines.push(`${INDENT_NESTED1}"method": ${JSON.stringify(entry.method)},`);
  lines.push(`${INDENT_NESTED1}"header": [`);
  for (let i = 0; i < entry.headers.length; i++) {
    const h = entry.headers[i];
    if (!h) continue;
    const isLast = i === entry.headers.length - 1;
    lines.push(`${INDENT_NESTED2}${renderHeaderLine(h)}${isLast ? '' : ','}`);
  }
  lines.push(`${INDENT_NESTED1}],`);

  lines.push(`${INDENT_NESTED1}"body": {`);
  lines.push(`${INDENT_NESTED2}"mode": "raw",`);
  lines.push(`${INDENT_NESTED2}"raw": ${JSON.stringify(entry.bodyRaw)}`);
  lines.push(`${INDENT_NESTED1}},`);

  lines.push(`${INDENT_NESTED1}"url": {`);
  lines.push(`${INDENT_NESTED2}"raw": ${JSON.stringify(entry.url.raw)},`);
  lines.push(
    `${INDENT_NESTED2}"host": ${renderInlineStringArray(entry.url.host)},`,
  );
  lines.push(
    `${INDENT_NESTED2}"path": ${renderInlineStringArray(entry.url.path)}`,
  );
  lines.push(`${INDENT_NESTED1}},`);

  lines.push(
    `${INDENT_NESTED1}"description": ${JSON.stringify(entry.description)}`,
  );
  lines.push(`${INDENT_FIELD}},`);
  lines.push(`${INDENT_FIELD}"response": []`);
  lines.push(`${INDENT_ENTRY}}`);
  return lines.join('\n');
}

/**
 * Render the full `item` array contents (between the folder's `"item": [`
 * and its closing `]`) — entries joined by `,\n`, no leading or trailing
 * commas. Caller is responsible for the surrounding brackets + indent.
 */
export function renderItems(precedence: readonly string[]): string {
  // Filter out the pre-algorithm billing gate. The walkthrough exercises
  // the per-step algorithm chain only, matching DENIAL_REASON_PRECEDENCE
  // in `tools/postman/scripts/validate.ts:73-75`.
  const algorithmReasons = precedence.filter(
    (r) => r !== 'PLAN_LIMIT_EXCEEDED',
  );
  const entries = algorithmReasons.map((reason, idx) => {
    const factory = FIXTURES.get(reason) ?? todoFixture;
    return renderEntry(factory(idx + 1, reason));
  });
  return entries.join(',\n');
}

/**
 * Splice the new item array into the collection. Preserves everything
 * outside the walk-through folder bit-for-bit by anchoring on two stable
 * substrings that bracket the `item` array.
 *
 * Anchors (chosen for uniqueness within the file):
 *   - START_MARKER: the folder header through `"item": [\n`
 *   - END_MARKER:   `\n      ]\n    }\n  ]\n}\n` (folder + collection close)
 *
 * If either anchor is absent we abort loudly instead of guessing.
 */
export function spliceCollection(
  source: string,
  newItemsBody: string,
): string {
  // Find the walk-through folder header. There is exactly one folder
  // named "Denial Precedence Walk-through" at the top level today.
  const folderHeader = `"name": "${FOLDER_NAME}"`;
  const folderHeaderIdx = source.indexOf(folderHeader);
  if (folderHeaderIdx === -1) {
    throw new Error(
      `generate-postman-walkthrough: folder header ${JSON.stringify(folderHeader)} not found in collection`,
    );
  }
  // The folder's `item` array opens at the next `"item": [\n` after the
  // header. Walking forward avoids accidentally matching a different
  // folder's item array.
  const itemOpenMarker = '"item": [\n';
  const itemOpenIdx = source.indexOf(itemOpenMarker, folderHeaderIdx);
  if (itemOpenIdx === -1) {
    throw new Error(
      `generate-postman-walkthrough: folder ${JSON.stringify(FOLDER_NAME)} has no opening "item": [`,
    );
  }
  const itemBodyStart = itemOpenIdx + itemOpenMarker.length;

  // The folder's `item` array closes at the first line that is exactly
  // 6 spaces + `]` after the body start. That `      ]` line is followed
  // immediately by `    }` (the folder close) — we anchor on the pair so
  // a stray `]` inside an entry's body never matches.
  const itemCloseMarker = '\n      ]\n    }\n  ]\n}';
  const itemCloseIdx = source.indexOf(itemCloseMarker, itemBodyStart);
  if (itemCloseIdx === -1) {
    throw new Error(
      `generate-postman-walkthrough: could not locate folder close after walk-through items`,
    );
  }

  const before = source.slice(0, itemBodyStart);
  const after = source.slice(itemCloseIdx);
  return `${before}${newItemsBody}${after}`;
}

async function loadPrecedence(): Promise<readonly string[]> {
  const mod = (await import(PRECEDENCE_SOURCE)) as {
    DENIAL_REASON_PRECEDENCE: readonly string[];
  };
  return mod.DENIAL_REASON_PRECEDENCE;
}

async function main(): Promise<number> {
  const precedence = await loadPrecedence();
  if (precedence.length === 0) {
    process.stderr.write(
      'generate-postman-walkthrough: precedence tuple is empty\n',
    );
    return 1;
  }
  const dupes = precedence.filter((r, i) => precedence.indexOf(r) !== i);
  if (dupes.length > 0) {
    process.stderr.write(
      `generate-postman-walkthrough: duplicate reasons: ${dupes.join(', ')}\n`,
    );
    return 1;
  }

  const source = readFileSync(COLLECTION_PATH, 'utf8');
  const itemsBody = renderItems(precedence);
  const next = spliceCollection(source, itemsBody);

  // Sanity: result must still parse as JSON. A formatting bug in this
  // generator must not corrupt the collection on disk.
  try {
    JSON.parse(next);
  } catch (err) {
    process.stderr.write(
      `generate-postman-walkthrough: generated collection is not valid JSON: ${(err as Error).message}\n`,
    );
    return 1;
  }

  writeFileSync(COLLECTION_PATH, next, 'utf8');

  // Reporting: count of entries written (excluding PLAN_LIMIT_EXCEEDED)
  // and any TODO scaffolds emitted so the operator notices missing
  // fixtures even when CI is green.
  const algorithmReasons = precedence.filter(
    (r) => r !== 'PLAN_LIMIT_EXCEEDED',
  );
  const missing = algorithmReasons.filter((r) => !FIXTURES.has(r));
  process.stdout.write(
    `generate-postman-walkthrough: wrote ${algorithmReasons.length} entries to ${COLLECTION_PATH}\n`,
  );
  if (missing.length > 0) {
    process.stdout.write(
      `  TODO scaffolds emitted for: ${missing.join(', ')}\n` +
        `  Add fixtures in scripts/generate-postman-walkthrough.ts FIXTURES map.\n`,
    );
  }
  return 0;
}

// Only run main when invoked as a script (not when imported by tests).
const isDirectInvocation =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);
if (isDirectInvocation) {
  main().then(
    (rc) => process.exit(rc),
    (err: unknown) => {
      process.stderr.write(
        `generate-postman-walkthrough: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
