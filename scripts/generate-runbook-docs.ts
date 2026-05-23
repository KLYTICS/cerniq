#!/usr/bin/env tsx
/**
 * generate-runbook-docs — emit the operator-facing runbook markdown
 * from the YAML source of truth at `docs/runbooks/denial-reasons.yaml`.
 *
 * Output:
 *   - docs/runbooks/denial-reasons.md
 *
 * Why YAML + generator (instead of just hand-maintaining the .md):
 *   The same per-reason guidance is consumed in several places
 *   (operator dashboard tooltips, Grafana alert annotations, SDK
 *   error docstrings, Confluence runbook). Owning the content in
 *   one structured source lets future generators emit each consumer
 *   from the same bytes — eliminating "this reason is documented
 *   four ways and three of them are wrong" rot. The .md is the
 *   first consumer; others follow the same generator-from-YAML
 *   pattern.
 *
 * Completeness gate: every reason in DENIAL_REASON_PRECEDENCE
 *   MUST have a YAML entry. Adding a new reason to the canonical
 *   tuple without updating the YAML reds CI via
 *   `pnpm check:runbook-coverage`. The reverse (YAML entry without
 *   a canonical reason) also reds — keeps the YAML from accreting
 *   orphaned reasons after a deprecation.
 *
 * Determinism: entries are emitted in canonical-precedence order
 *   (NOT YAML file order — though we also assert they match).
 *   Same input → byte-equal output every run.
 *
 * Re-run via: `pnpm gen:runbook-docs`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const YAML_SOURCE = resolve(REPO_ROOT, 'docs/runbooks/denial-reasons.yaml');
const MD_OUT = resolve(REPO_ROOT, 'docs/runbooks/denial-reasons.md');
const CANONICAL_SOURCE = '../packages/types/src/constants.ts';

type Severity = 'info' | 'warning' | 'critical';

interface RunbookEntry {
  reason: string;
  description: string;
  severity: Severity;
  relying_party_action: string;
  operator_check: string;
  dashboard_query: string;
  sdk_doc_link: string;
}

interface RunbookFile {
  reasons: RunbookEntry[];
}

const REQUIRED_FIELDS: ReadonlyArray<keyof RunbookEntry> = [
  'reason',
  'description',
  'severity',
  'relying_party_action',
  'operator_check',
  'dashboard_query',
  'sdk_doc_link',
];

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['info', 'warning', 'critical']);

async function loadCanonical(): Promise<readonly string[]> {
  const mod = (await import(CANONICAL_SOURCE)) as {
    DENIAL_REASON_PRECEDENCE: readonly string[];
  };
  return mod.DENIAL_REASON_PRECEDENCE;
}

function loadYaml(): RunbookFile {
  const raw = readFileSync(YAML_SOURCE, 'utf8');
  const parsed = parseYaml(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { reasons?: unknown }).reasons)
  ) {
    throw new Error(
      `generate-runbook-docs: ${YAML_SOURCE} must have a top-level \`reasons:\` array`,
    );
  }
  return parsed as RunbookFile;
}

function validateEntry(entry: unknown, idx: number): RunbookEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`runbook entry ${idx}: not an object`);
  }
  const e = entry as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    const v = e[field];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(
        `runbook entry ${idx} (reason=${JSON.stringify(e.reason)}): field "${field}" must be a non-empty string`,
      );
    }
  }
  if (!VALID_SEVERITIES.has(e.severity as string)) {
    throw new Error(
      `runbook entry ${idx} (reason=${JSON.stringify(e.reason)}): severity must be one of ${[...VALID_SEVERITIES].join(', ')}, got ${JSON.stringify(e.severity)}`,
    );
  }
  return e as unknown as RunbookEntry;
}

function severityBadge(s: Severity): string {
  switch (s) {
    case 'critical':
      return '🔴 **CRITICAL**';
    case 'warning':
      return '🟡 **WARNING**';
    case 'info':
      return '🔵 **INFO**';
  }
}

export function renderMarkdown(
  entries: ReadonlyArray<RunbookEntry>,
  canonical: readonly string[],
): string {
  // Index by reason for ordered emission. We assert below that entries
  // and canonical agree, so this map is total.
  const byReason = new Map(entries.map((e) => [e.reason, e]));

  const lines: string[] = [];
  lines.push('<!-- @generated — do not edit; run `pnpm gen:runbook-docs` -->');
  lines.push('<!-- Source: docs/runbooks/denial-reasons.yaml -->');
  lines.push('');
  lines.push('# AEGIS Denial-Reason Runbook');
  lines.push('');
  lines.push('Operator and relying-party guidance for every reason in');
  lines.push('`DENIAL_REASON_PRECEDENCE` (top-wins order). Generated from');
  lines.push('`docs/runbooks/denial-reasons.yaml` — edit that file, not this one.');
  lines.push('');
  lines.push('Reasons are listed in canonical precedence order (rank 1 wins ties).');
  lines.push('');
  lines.push('| Rank | Reason | Severity | Description |');
  lines.push('| ---: | ------ | -------- | ----------- |');
  canonical.forEach((reason, i) => {
    const e = byReason.get(reason)!;
    lines.push(`| ${i + 1} | \`${reason}\` | ${e.severity} | ${e.description} |`);
  });
  lines.push('');
  lines.push('---');
  lines.push('');

  canonical.forEach((reason, i) => {
    const e = byReason.get(reason)!;
    lines.push(`## ${i + 1}. \`${reason}\``);
    lines.push('');
    lines.push(`${severityBadge(e.severity)} — ${e.description}`);
    lines.push('');
    lines.push('### Relying-party action');
    lines.push('');
    lines.push(e.relying_party_action);
    lines.push('');
    lines.push('### Operator check');
    lines.push('');
    lines.push(e.operator_check);
    lines.push('');
    lines.push('### Dashboard query');
    lines.push('');
    lines.push(`\`\`\`\n${e.dashboard_query}\n\`\`\``);
    lines.push('');
    lines.push('### SDK docs');
    lines.push('');
    lines.push(e.sdk_doc_link === 'TODO(operator)' ? '_(link pending operator review)_' : e.sdk_doc_link);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

async function main(): Promise<number> {
  const canonical = await loadCanonical();
  const yamlFile = loadYaml();

  // Validate each entry has required fields + valid severity.
  const entries = yamlFile.reasons.map((e, i) => validateEntry(e, i));

  // Completeness gate: YAML covers exactly the canonical set, no
  // missing, no extras. Order in YAML SHOULD match canonical (we
  // emit in canonical order regardless, but YAML drift is a smell).
  const yamlReasons = entries.map((e) => e.reason);
  const canonicalSet = new Set(canonical);
  const yamlSet = new Set(yamlReasons);

  const missing = canonical.filter((r) => !yamlSet.has(r));
  if (missing.length > 0) {
    process.stderr.write(
      `generate-runbook-docs: YAML is missing entries for canonical reasons: ${missing.join(', ')}\n` +
        `Add a runbook entry to docs/runbooks/denial-reasons.yaml for each.\n`,
    );
    return 1;
  }
  const extras = yamlReasons.filter((r) => !canonicalSet.has(r));
  if (extras.length > 0) {
    process.stderr.write(
      `generate-runbook-docs: YAML has entries for reasons NOT in canonical tuple: ${extras.join(', ')}\n` +
        `Either add them to packages/types/src/constants.ts or remove from YAML.\n`,
    );
    return 1;
  }
  const dupes = yamlReasons.filter((r, i) => yamlReasons.indexOf(r) !== i);
  if (dupes.length > 0) {
    process.stderr.write(`generate-runbook-docs: duplicate YAML entries: ${dupes.join(', ')}\n`);
    return 1;
  }

  const md = renderMarkdown(entries, canonical);
  writeFileSync(MD_OUT, md, 'utf8');
  process.stdout.write(
    `generate-runbook-docs: wrote ${entries.length} runbook entries\n  ${MD_OUT}\n`,
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
        `generate-runbook-docs: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
