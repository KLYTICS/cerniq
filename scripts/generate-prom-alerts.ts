#!/usr/bin/env tsx
/**
 * generate-prom-alerts — emit Prometheus alert / recording rules
 * from the runbook YAML at `docs/runbooks/denial-reasons.yaml`.
 *
 * Closes the gap flagged in 8b0d499's commit body:
 *   "walk-denials switch case, prom alert rules — all also missing
 *    INTENT_MISMATCH per grep."
 *
 * Output:
 *   - infra/observability/alerts/denial-reasons.rules.yml
 *
 * Coexists with hand-tuned rule files in the same directory
 * (`aegis.rules.yml`, `aegis-security.rules.yml`). Two architectural
 * principles keep them from colliding:
 *
 *   1. The generated file uses a different alert-name namespace:
 *      AEGIS_BASELINE_<REASON>_SPIKE (vs. hand-tuned
 *      AEGIS_API_KEY_FAILURE_SPIKE / AEGIS_REPLAY_DETECTED etc.).
 *      Both can fire on the same incident; operators silence
 *      whichever they prefer.
 *
 *   2. The generated file is labeled `aegis_managed: generated`
 *      on every rule. Operators can split routing in Alertmanager
 *      by that label (e.g., route bespoke alerts to PagerDuty,
 *      generated baselines to Slack until they're tuned).
 *
 * What gets emitted per denial reason:
 *   - Always: a label-disambiguated row of the single recording
 *     rule `job:aegis_denial_rate:5m` keyed by `denial_reason`.
 *     This gives operators a named SLI series for dashboards.
 *   - For severity=critical: a baseline alert at a conservative
 *     threshold. The manually-tuned versions in
 *     `aegis-security.rules.yml` provide the tight, per-incident
 *     PagerDuty path; the generated baseline catches anything
 *     the manual alerts haven't been written for yet (INTENT_MISMATCH
 *     was the canary that surfaced this gap).
 *   - For severity=warning / info: no alert generated. These
 *     reasons (POLICY_EXPIRED is a normal flow event;
 *     PLAN_LIMIT_EXCEEDED is a billing nudge) would page-storm
 *     under any default rate threshold. Operators who need a
 *     warning alert can add one using the recording rule as the
 *     SLI series.
 *
 * Determinism: same input → same bytes. Reason ordering follows
 *   canonical DENIAL_REASON_PRECEDENCE (top wins) so the file
 *   reads in priority order.
 *
 * CI gate: `pnpm check:prom-alerts-gen` re-runs the generator and
 *   `git diff --exit-code`s. Add a denial reason → regenerate →
 *   commit, or CI reds.
 *
 * Re-run via: `pnpm gen:prom-alerts`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const YAML_SOURCE = resolve(REPO_ROOT, 'docs/runbooks/denial-reasons.yaml');
const RULES_OUT = resolve(REPO_ROOT, 'infra/observability/alerts/denial-reasons.rules.yml');
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

// Baseline alert thresholds per critical reason. These are conservative
// defaults; operators tune per deployment (traffic volume varies wildly).
// Each entry is { rate_per_second_threshold, sustained_window }.
const CRITICAL_THRESHOLDS: Readonly<Record<string, { rate: number; for: string }>> = {
  INVALID_SIGNATURE: { rate: 2, for: '5m' },
  ANOMALY_FLAGGED: { rate: 0.5, for: '5m' },
  INTENT_MISMATCH: { rate: 0.1, for: '10m' },
};

async function loadCanonical(): Promise<readonly string[]> {
  const mod = (await import(CANONICAL_SOURCE)) as { DENIAL_REASON_PRECEDENCE: readonly string[] };
  return mod.DENIAL_REASON_PRECEDENCE;
}

function loadYaml(): RunbookFile {
  const raw = readFileSync(YAML_SOURCE, 'utf8');
  return parseYaml(raw) as RunbookFile;
}

function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s.split('\n').map((line) => (line.length > 0 ? pad + line : line)).join('\n');
}

/**
 * Render a single annotation block. We escape `|` line-folding by using
 * the `>-` block-scalar (folded, strip trailing newlines) since runbook
 * text often contains markdown that should stay on one effective line
 * for Alertmanager template substitution.
 *
 * Indent is 10 spaces — the annotation entries are children of the
 * 8-space-indented `annotations:` key inside an alert rule list-item
 * (8 + 2 = 10). Mismatch (e.g. 8 here) would emit structurally invalid
 * YAML where `summary`/`description`/etc. parse as siblings of
 * `annotations:` rather than children, dropping every annotation when
 * promtool / Alertmanager parses the file.
 */
function annotationLine(key: string, value: string): string {
  // Inline scalar if short + no special chars; folded otherwise.
  const isShort = value.length < 70 && !value.includes('\n') && !/[:"'`#]/.test(value);
  if (isShort) {
    return `          ${key}: ${JSON.stringify(value)}`;
  }
  return `          ${key}: >-\n${indent(value, 12)}`;
}

function reasonAnchor(reason: string): string {
  // Mirror the slug the runbook-docs generator emits for `## N. \`REASON\``.
  // Pandoc/CommonMark anchor rules: lowercase, dashes for non-alphanums.
  const idx = (canonicalIndexCache.get(reason) ?? -1) + 1;
  return `${idx}-${reason.toLowerCase().replace(/_/g, '_')}`;
}

const canonicalIndexCache = new Map<string, number>();

export function renderRules(
  entries: ReadonlyArray<RunbookEntry>,
  canonical: readonly string[],
): string {
  // Hydrate the anchor index cache from canonical (deterministic order).
  canonicalIndexCache.clear();
  canonical.forEach((r, i) => canonicalIndexCache.set(r, i));

  const byReason = new Map(entries.map((e) => [e.reason, e]));
  const lines: string[] = [];

  lines.push('# @generated — do not edit; run `pnpm gen:prom-alerts`');
  lines.push('# Source: docs/runbooks/denial-reasons.yaml');
  lines.push('#');
  lines.push('# Closes the prom-alerts gap flagged in 8b0d499 — every reason in');
  lines.push('# DENIAL_REASON_PRECEDENCE now has at least a recording-rule SLI.');
  lines.push('# Critical-severity reasons additionally have a baseline alert.');
  lines.push('#');
  lines.push('# COEXISTENCE with hand-tuned rules:');
  lines.push('#   - infra/observability/alerts/aegis.rules.yml (latency / SRE)');
  lines.push('#   - infra/observability/alerts/aegis-security.rules.yml (specific');
  lines.push('#     INVALID_SIGNATURE / ANOMALY_FLAGGED alerts with bespoke');
  lines.push('#     thresholds tuned to specific incident patterns).');
  lines.push('# Both file kinds may fire on the same underlying signal; routing in');
  lines.push('# Alertmanager can split on label `aegis_managed: generated` vs.');
  lines.push('# (absent / bespoke). Operators may silence whichever they prefer.');
  lines.push('#');
  lines.push('# CI gate `pnpm check:prom-alerts-gen` re-runs the generator and reds');
  lines.push('# on any drift. Hand edits to this file are clobbered next run.');
  lines.push('');
  lines.push('groups:');

  // ── Recording group ────────────────────────────────────────────────────
  lines.push('  # Recording rule: emits a pre-aggregated denial-rate SLI series');
  lines.push('  # labeled by denial_reason. Operators build custom alerts /');
  lines.push('  # dashboards off this named series instead of re-deriving the');
  lines.push('  # PromQL in three places.');
  lines.push('  - name: aegis_denial_reasons.recording');
  lines.push('    interval: 30s');
  lines.push('    rules:');
  lines.push('      - record: job:aegis_denial_rate:5m');
  lines.push('        expr: |');
  lines.push('          sum by (denial_reason) (');
  lines.push('            rate(aegis_verify_total{decision="denied"}[5m])');
  lines.push('          )');
  lines.push('');

  // ── Baseline alerts (critical reasons only) ────────────────────────────
  lines.push('  # Baseline alerts — generated only for reasons tagged `critical`');
  lines.push('  # in docs/runbooks/denial-reasons.yaml. WARNING/INFO reasons get a');
  lines.push("  # recording rule above but no alert (defaults would page-storm");
  lines.push('  # for normal-flow events like POLICY_EXPIRED).');
  lines.push('  - name: aegis_denial_reasons.baseline_alerts');
  lines.push('    interval: 30s');
  lines.push('    rules:');

  const criticalReasonsInOrder = canonical.filter((r) => byReason.get(r)?.severity === 'critical');
  for (const reason of criticalReasonsInOrder) {
    const entry = byReason.get(reason)!;
    const threshold = CRITICAL_THRESHOLDS[reason];
    if (!threshold) {
      throw new Error(
        `generate-prom-alerts: critical-severity reason ${reason} has no entry in CRITICAL_THRESHOLDS. ` +
          `Add a baseline threshold (rate per second + sustained window) so the generated alert is meaningful.`,
      );
    }
    lines.push('');
    lines.push(`      - alert: AEGIS_BASELINE_${reason}_SPIKE`);
    lines.push('        expr: |');
    lines.push(`          sum(rate(aegis_verify_total{decision="denied",denial_reason="${reason}"}[5m])) > ${threshold.rate}`);
    lines.push(`        for: ${threshold.for}`);
    lines.push('        labels:');
    lines.push('          severity: page');
    lines.push('          team: aegis-oncall');
    lines.push('          domain: aegis');
    lines.push(`          denial_reason: ${reason}`);
    lines.push('          aegis_managed: generated');
    lines.push('        annotations:');
    lines.push(annotationLine('summary', `Baseline ${reason} denial-rate spike (operator-tunable)`));
    lines.push(annotationLine('description', entry.description));
    lines.push(annotationLine('relying_party_action', entry.relying_party_action));
    lines.push(annotationLine('operator_check', entry.operator_check));
    lines.push(annotationLine('runbook_md', `docs/runbooks/denial-reasons.md#${reasonAnchor(reason)}`));
    lines.push(annotationLine('threshold_note', `Baseline threshold: > ${threshold.rate}/sec sustained ${threshold.for}. Tune per deployment.`));
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<number> {
  const canonical = await loadCanonical();
  const yamlFile = loadYaml();
  const entries = yamlFile.reasons;

  // Completeness: same gates as the runbook generator.
  const yamlReasons = new Set(entries.map((e) => e.reason));
  const missing = canonical.filter((r) => !yamlReasons.has(r));
  if (missing.length > 0) {
    process.stderr.write(
      `generate-prom-alerts: YAML is missing entries for canonical reasons: ${missing.join(', ')}\n`,
    );
    return 1;
  }

  // Sanity: every critical reason has a baseline threshold defined.
  const criticalReasons = entries.filter((e) => e.severity === 'critical').map((e) => e.reason);
  const missingThresholds = criticalReasons.filter((r) => !(r in CRITICAL_THRESHOLDS));
  if (missingThresholds.length > 0) {
    process.stderr.write(
      `generate-prom-alerts: critical reasons missing baseline thresholds: ${missingThresholds.join(', ')}\n` +
        `Add entries to CRITICAL_THRESHOLDS in this generator.\n`,
    );
    return 1;
  }

  const out = renderRules(entries, canonical);
  writeFileSync(RULES_OUT, out, 'utf8');
  process.stdout.write(
    `generate-prom-alerts: wrote 1 recording rule + ${criticalReasons.length} baseline alerts\n  ${RULES_OUT}\n`,
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
        `generate-prom-alerts: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
