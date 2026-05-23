#!/usr/bin/env tsx
/**
 * CERNIQ — preflight ship-readiness orchestrator.
 *
 * Single executable that runs every gating + warning check the operator
 * needs before deploy. Encodes `docs/TERMINAL_ORCHESTRATION.md` §5 (FAANG
 * checklist) and round-15's quality surfaces into one go/no-go gate.
 *
 * Usage:
 *   tsx tools/preflight/preflight.ts                    # full run, pretty
 *   tsx tools/preflight/preflight.ts --fast             # only fast checks (no vitest)
 *   tsx tools/preflight/preflight.ts --json             # machine-readable
 *   tsx tools/preflight/preflight.ts --only=tsc,lint    # selective
 *   tsx tools/preflight/preflight.ts --skip=peers       # exclude
 *   tsx tools/preflight/preflight.ts --prod             # fail on missing prod env vars
 *
 * Exit codes:
 *   0  all checks pass (or skipped)
 *   1  warnings present, no gating failure
 *   2  gating failure — DO NOT SHIP
 *   3  internal error in the preflight itself
 *
 * Why this exists: CERNIQ has 15 quality scripts (tsc, lint, audit:errors,
 * benchmark-verify, db-index-audit, check:migrations, etc.) but no single
 * orchestrator. Operators need ONE command that says "ship or don't ship."
 * This is that command.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckCategory = 'gating' | 'warning' | 'info';
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  status: CheckStatus;
  details?: string;
  metrics?: Record<string, number | string>;
  remediation?: string;
}

export interface Check {
  id: string;
  label: string;
  category: CheckCategory;
  fastSafe: boolean;
  run(ctx: Context): Promise<CheckResult> | CheckResult;
}

export interface Context {
  prod: boolean;
}

export interface CompletedCheck {
  id: string;
  label: string;
  category: CheckCategory;
  status: CheckStatus;
  elapsedMs: number;
  details?: string;
  metrics?: Record<string, number | string>;
  remediation?: string;
}

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

export interface Flags {
  fast: boolean;
  json: boolean;
  only?: Set<string>;
  skip: Set<string>;
  prod: boolean;
}

export function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { fast: false, json: false, skip: new Set(), prod: false };
  for (const arg of argv) {
    if (arg === '--fast') flags.fast = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--prod') flags.prod = true;
    else if (arg.startsWith('--only='))
      flags.only = new Set(arg.slice(7).split(',').filter(Boolean));
    else if (arg.startsWith('--skip='))
      flags.skip = new Set(arg.slice(7).split(',').filter(Boolean));
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`preflight: unknown flag ${arg}`);
      process.exit(3);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(`CERNIQ preflight — ship-readiness gate

Usage: tsx tools/preflight/preflight.ts [flags]

Flags:
  --fast              skip checks that shell out to vitest/jest
  --json              machine-readable JSON output
  --only=a,b          only run these check IDs
  --skip=a,b          skip these check IDs
  --prod              gate on missing prod env vars (default: warn-only)
  --help              this text

Exit codes: 0 pass · 1 warn · 2 fail · 3 internal error
`);
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

function exec(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): ExecResult {
  const r = spawnSync(cmd, args as string[], {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 180_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: r.status ?? (r.signal ? 124 : 1),
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export const CHECKS: Check[] = [
  {
    id: 'stack-signature',
    label: 'stack signature',
    category: 'info',
    fastSafe: true,
    run(): CheckResult {
      const apiSrc = resolve(REPO_ROOT, 'apps/api/src');
      const tsFiles = countFiles(apiSrc, /\.ts$/, /\.spec\.ts$/);
      const specFiles = countFiles(apiSrc, /\.spec\.ts$/);
      const modules = countDirs(resolve(apiSrc, 'modules'));
      const prismaPath = resolve(REPO_ROOT, 'apps/api/prisma/schema.prisma');
      const prismaModels = existsSync(prismaPath)
        ? (readFileSync(prismaPath, 'utf8').match(/^model\s+\w+/gm) ?? []).length
        : 0;
      const catalogPath = resolve(REPO_ROOT, 'apps/api/src/common/errors/error-catalog.ts');
      const catalogEntries = existsSync(catalogPath)
        ? (readFileSync(catalogPath, 'utf8').match(/^\s{4,}code:\s*'[a-zA-Z_]+'/gm) ?? []).length
        : 0;
      return {
        status: 'pass',
        details: `${tsFiles} ts · ${specFiles} specs · ${modules} modules · ${prismaModels} models · ${catalogEntries} errors`,
        metrics: { tsFiles, specFiles, modules, prismaModels, catalogEntries },
      };
    },
  },
  {
    id: 'peer-claims',
    label: 'active peer claims',
    category: 'info',
    fastSafe: true,
    run(): CheckResult {
      // peers `status` is the global-view command (despite the name, it lists
      // all active claims with `(you)` annotated for self). `list` is not a
      // real command — it just prints the help text.
      const peers = exec(`${process.env.HOME}/.claude/peers/bin/claude-peers`, ['status']);
      if (peers.status !== 0) return { status: 'skip', details: 'claude-peers not available' };
      const sids = Array.from(peers.stdout.matchAll(/sid=([0-9a-f]{8})/g)).map((m) => m[1]);
      const unique = Array.from(new Set(sids));
      return {
        status: 'pass',
        details:
          unique.length === 0
            ? 'no active claims'
            : `${unique.length} active (${unique.join(', ')})`,
        metrics: { activeClaims: unique.length },
      };
    },
  },
  {
    id: 'tsc-api',
    label: 'tsc @cerniq/api',
    category: 'gating',
    fastSafe: true,
    run(): CheckResult {
      const r = exec('pnpm', ['-F', '@cerniq/api', 'exec', 'tsc', '--noEmit']);
      if (r.status === 0) return { status: 'pass', details: '0 errors' };
      const errCount = (r.stdout.match(/error TS\d+/g) ?? []).length;
      return {
        status: 'fail',
        details: `${errCount} error(s)`,
        remediation: 'pnpm -F @cerniq/api exec tsc --noEmit  # see full output',
      };
    },
  },
  {
    id: 'lint-api',
    label: 'lint @cerniq/api',
    category: 'gating',
    fastSafe: true,
    run(): CheckResult {
      const r = exec('pnpm', ['-F', '@cerniq/api', 'lint']);
      if (r.status === 0) return { status: 'pass', details: '0 warnings' };
      // Distinguish environmental (missing plugin / config error) from code lint failure.
      const combined = r.stdout + r.stderr;
      if (/Cannot find package|Cannot find module|ENOENT|MODULE_NOT_FOUND/i.test(combined)) {
        const m = combined.match(/Cannot find package '([^']+)'/);
        return {
          status: 'warn',
          details: m
            ? `eslint config can't load '${m[1]}' (env issue, not lint)`
            : 'eslint config load error',
          remediation: 'pnpm install  # ensure all eslint plugins materialized',
        };
      }
      const warnCount = (combined.match(/^\s*\d+:\d+\s+warning/gm) ?? []).length;
      const errCount = (combined.match(/^\s*\d+:\d+\s+error/gm) ?? []).length;
      // If exit was non-zero but no warnings/errors parsed, treat as warn (likely tooling).
      if (warnCount === 0 && errCount === 0) {
        return {
          status: 'warn',
          details: `eslint exit ${r.status} but no parsed findings`,
          remediation: 'pnpm -F @cerniq/api lint  # see full output',
        };
      }
      return {
        status: 'fail',
        details: `${errCount} error(s) · ${warnCount} warning(s)`,
        remediation: 'pnpm -F @cerniq/api lint  # see full output',
      };
    },
  },
  {
    id: 'migration-immutability',
    label: 'migration immutability',
    category: 'gating',
    fastSafe: true,
    run(): CheckResult {
      const r = exec('pnpm', ['check:migrations']);
      if (r.status === 0) {
        const count = (r.stdout.match(/migration/gi) ?? []).length;
        return { status: 'pass', details: `${count > 0 ? count + ' migrations ' : ''}clean` };
      }
      return {
        status: 'fail',
        details: 'a committed migration was modified',
        remediation: 'restore migration files from git, add a new migration for the change',
      };
    },
  },
  {
    id: 'error-catalog-audit',
    label: 'error catalog audit',
    category: 'gating',
    fastSafe: true,
    run(): CheckResult {
      const r = exec('pnpm', ['-F', '@cerniq/scripts', 'audit:errors']);
      if (r.status === 0) {
        const m = r.stdout.match(/(\d+)\s+files\s+scanned[\s,]+(\d+)\s+throw\s+sites/i);
        return {
          status: 'pass',
          details: m ? `${m[1]} files / ${m[2]} throws / 0 uncataloged` : 'all throws cataloged',
        };
      }
      return {
        status: 'fail',
        details: 'uncataloged CerniqError subclass thrown',
        remediation: 'register the class in apps/api/src/common/errors/error-catalog.ts',
      };
    },
  },
  {
    id: 'cross-package-parity',
    label: 'cross-package parity tests',
    category: 'gating',
    fastSafe: false,
    run(): CheckResult {
      const r = exec('pnpm', ['vitest', 'run', 'tests/cross-package'], { timeoutMs: 240_000 });
      if (r.status === 0) {
        const m = r.stdout.match(/Test Files\s+(\d+)\s+passed/);
        return { status: 'pass', details: m ? `${m[1]} files passed` : 'all parity green' };
      }
      return {
        status: 'fail',
        details: 'parity drift between SDK / API / OpenAPI / catalog',
        remediation: 'pnpm vitest run tests/cross-package  # see which spec failed',
      };
    },
  },
  {
    id: 'env-vars',
    label: 'env vars',
    category: 'warning',
    fastSafe: true,
    run(ctx: Context): CheckResult {
      // Names sourced from .env.example (the canonical surface). Round 13
      // renamed AUDIT_* → CERNIQ_SIGNING_*; old names are deprecated aliases.
      // ADR-0014 added STRIPE_PRICE_TEAM and STRIPE_PRICE_SCALE.
      const required = [
        'DATABASE_URL',
        'REDIS_URL',
        'CERNIQ_SIGNING_PRIVATE_KEY',
        'CERNIQ_SIGNING_PUBLIC_KEY',
        'JWT_ED25519_PRIVATE_KEY_B64',
        'JWT_ED25519_PUBLIC_KEY_B64',
        'CERNIQ_WEBHOOK_SECRET_DEK_B64', // round-13 webhook secret-at-rest DEK
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_PRICE_DEVELOPER',
        'STRIPE_PRICE_TEAM',
        'STRIPE_PRICE_SCALE',
      ];
      const set = required.filter((k) => process.env[k]);
      const missing = required.filter((k) => !process.env[k]);
      if (missing.length === 0)
        return { status: 'pass', details: `${set.length}/${required.length} set` };
      const status: CheckStatus = ctx.prod ? 'fail' : 'warn';
      return {
        status,
        details: `${set.length}/${required.length} set (${missing.length} missing — ${ctx.prod ? 'gate' : 'flagged for prod'})`,
        metrics: { missing: missing.length, set: set.length },
        remediation: `set: ${missing.join(', ')}`,
      };
    },
  },
  {
    id: 'operator-decisions',
    label: 'operator decisions',
    category: 'warning',
    fastSafe: true,
    run(): CheckResult {
      const path = resolve(REPO_ROOT, 'OPERATOR_DECISIONS.md');
      if (!existsSync(path)) return { status: 'skip', details: 'OPERATOR_DECISIONS.md not found' };
      const body = readFileSync(path, 'utf8');
      const openCount = (body.match(/\|\s*OPEN\s*\|/g) ?? []).length;
      // Critical-path map: which OD blocks revenue. OD-003 (pricing) is THE
      // pre-revenue gate. Detect per-line so a row that mentions OD-003 in
      // a description doesn't poison the signal — only count the row that
      // *starts* with OD-003 and ends with OPEN.
      const lines = body.split('\n');
      const od003Lines = lines.filter((l) => /^\|\s*OD-003\s*\|/.test(l));
      const od003Open = od003Lines.some((l) => /\|\s*OPEN\s*\|/.test(l));
      const od003Decided = od003Lines.some((l) => /\|\s*DECIDED\s*\|/.test(l));
      if (openCount === 0) return { status: 'pass', details: 'all decisions resolved' };
      let detail: string;
      if (od003Open) detail = `${openCount} OPEN (CRITICAL PATH: OD-003 pricing)`;
      else if (od003Decided) detail = `${openCount} OPEN (OD-003 DECIDED — critical path clear)`;
      else detail = `${openCount} OPEN (none on critical path)`;
      return {
        status: 'warn',
        details: detail,
        metrics: {
          open: openCount,
          od003Open: od003Open ? 1 : 0,
          od003Decided: od003Decided ? 1 : 0,
        },
        remediation: od003Open
          ? 'resolve OD-003 in OPERATOR_DECISIONS.md before live billing'
          : 'review remaining OPEN decisions for ship blockers',
      };
    },
  },
  {
    id: 'optional-kms-provider',
    label: 'optional KMS provider',
    category: 'warning',
    fastSafe: true,
    run(): CheckResult {
      const provider = process.env.KMS_PROVIDER;
      if (!provider) return { status: 'skip', details: 'KMS_PROVIDER unset' };
      const map: Record<string, string> = {
        aws: 'node_modules/@aws-sdk/client-kms',
        gcp: 'node_modules/@google-cloud/kms',
        vault: 'node_modules/node-vault',
      };
      const expected = map[provider];
      if (!expected) {
        return {
          status: 'warn',
          details: `unknown provider '${provider}' (expected: aws|gcp|vault|memory)`,
        };
      }
      if (existsSync(resolve(REPO_ROOT, expected))) {
        return { status: 'pass', details: `${provider} SDK installed` };
      }
      return {
        status: 'warn',
        details: `KMS_PROVIDER=${provider} but ${expected} not installed`,
        remediation: `pnpm install  # picks up optionalDependencies for ${provider}`,
      };
    },
  },
  {
    id: 'perf-baseline-freshness',
    label: 'perf baseline',
    category: 'warning',
    fastSafe: true,
    run(): CheckResult {
      const path = resolve(REPO_ROOT, 'apps/api/perf-baseline.json');
      if (!existsSync(path)) return { status: 'skip', details: 'no baseline yet' };
      const body = readFileSync(path, 'utf8');
      // Targets-only: file has SLO targets but no real percentile measurements.
      // Detect by absence of measurement keys (e.g. "p50_ms": <real>) outside
      // the verify_slo target block, OR by presence of "Initial baseline" /
      // "Real measurements needed" notes.
      const isTargetsOnly =
        /Initial baseline|Real measurements needed|slo_targets_only|SLO_TARGETS/i.test(body) ||
        !/"measured_at"|"measurements"|"actual_p99"/i.test(body);
      if (isTargetsOnly) {
        return {
          status: 'warn',
          details: 'targets only — no real measurements yet',
          remediation:
            'pnpm bench:verify --output apps/api/perf-baseline.json  # after make dev + seed:demo',
        };
      }
      const ageMs = Date.now() - statSync(path).mtimeMs;
      const ageDays = Math.floor(ageMs / 86_400_000);
      if (ageDays > 30) {
        return {
          status: 'warn',
          details: `${ageDays}d old`,
          remediation: 'pnpm bench:verify --output apps/api/perf-baseline.json',
        };
      }
      return { status: 'pass', details: `${ageDays}d old` };
    },
  },
  {
    id: 'architecture-drift',
    label: 'architecture drift',
    category: 'warning',
    fastSafe: true,
    run(): CheckResult {
      // Round 15 left a self-arming setInterval in audit-retention.service.ts as
      // an interim until @nestjs/schedule lands (Terminal H). Flag this until
      // it migrates to @Cron — the framework cron is the right long-term shape.
      const retentionPath = resolve(
        REPO_ROOT,
        'apps/api/src/modules/compliance/audit-retention.service.ts',
      );
      if (!existsSync(retentionPath))
        return { status: 'skip', details: 'retention service not found' };
      const body = readFileSync(retentionPath, 'utf8');
      const stillSelfArming = body.includes('setInterval') && !body.includes('@Cron(');
      if (stillSelfArming) {
        return {
          status: 'warn',
          details: 'audit-retention uses setInterval — Terminal H owes @nestjs/schedule swap',
          remediation:
            'pnpm add @nestjs/schedule -F @cerniq/api · ScheduleModule.forRoot() in app.module.ts · @Cron in retention service',
        };
      }
      return { status: 'pass', details: 'audit-retention on framework cron' };
    },
  },
  {
    id: 'alert-runbook-parity',
    label: 'alert ↔ runbook parity',
    category: 'gating',
    fastSafe: true,
    run(): CheckResult {
      // Every Prometheus alert with a `runbook:` annotation must point to a
      // real file. Catches the inverse drift: alert references a renamed or
      // deleted runbook → on-call hits 404 mid-incident.
      const ruleFiles = [
        'infra/observability/alerts/cerniq.rules.yml',
        'infra/observability/alerts/cerniq-security.rules.yml',
      ];
      const broken: Array<{ rule: string; runbook: string }> = [];
      let totalRefs = 0;
      for (const rf of ruleFiles) {
        const path = resolve(REPO_ROOT, rf);
        if (!existsSync(path)) continue;
        const body = readFileSync(path, 'utf8');
        // Match: runbook: <path-or-quoted-string-or-url>
        // Skip obvious URL annotations (runbook_url:) — those go through DNS,
        // not the filesystem.
        const matches = body.matchAll(/^\s*runbook:\s*["']?([^"'\s#]+)["']?/gm);
        for (const m of matches) {
          totalRefs++;
          const ref = m[1] ?? '';
          // External URLs are allowed (referenced as docs site, not local file).
          if (/^https?:\/\//i.test(ref)) continue;
          // Strip a leading `./` and any trailing `#anchor` for filesystem check.
          const fsPath = ref.replace(/^\.\//, '').replace(/#.*$/, '');
          const candidates = [
            resolve(REPO_ROOT, fsPath),
            resolve(REPO_ROOT, 'infra/observability/runbooks', fsPath),
          ];
          if (!candidates.some(existsSync)) broken.push({ rule: rf, runbook: ref });
        }
      }
      if (broken.length === 0) {
        return { status: 'pass', details: `${totalRefs} runbook refs · all resolve` };
      }
      return {
        status: 'fail',
        details: `${broken.length}/${totalRefs} runbook refs broken`,
        metrics: { totalRefs, broken: broken.length },
        remediation: `fix or remove: ${broken
          .map((b) => b.runbook)
          .slice(0, 3)
          .join(', ')}${broken.length > 3 ? '…' : ''}`,
      };
    },
  },
  {
    id: 'webhook-cipher-wired',
    label: 'webhook secret-at-rest',
    category: 'gating',
    fastSafe: true,
    run(): CheckResult {
      // Round 13 design: WebhookSubscription.secret is AES-256-GCM ciphertext,
      // never plaintext. Detect regression by confirming the cipher import is
      // wired and `subscribe()` calls `cipher.encrypt()` before persisting.
      const servicePath = resolve(REPO_ROOT, 'apps/api/src/modules/webhooks/webhooks.service.ts');
      if (!existsSync(servicePath))
        return { status: 'skip', details: 'webhooks.service.ts not found' };
      const body = readFileSync(servicePath, 'utf8');
      const importsCipher = /WebhookSecretCipher|webhook-secret-cipher/.test(body);
      const callsEncrypt = /\.encrypt\s*\(\s*secret\s*\)|cipher\.encrypt\(/.test(body);
      const persistsCiphertext = /secret:\s*ciphertext/.test(body);
      if (importsCipher && callsEncrypt && persistsCiphertext) {
        return { status: 'pass', details: 'AES-256-GCM cipher wired (round 13)' };
      }
      const missing: string[] = [];
      if (!importsCipher) missing.push('cipher import');
      if (!callsEncrypt) missing.push('encrypt call');
      if (!persistsCiphertext) missing.push('ciphertext persist');
      return {
        status: 'fail',
        details: `webhook secret hardening regressed: missing ${missing.join(', ')}`,
        remediation:
          'restore round-13 design: import WebhookSecretCipher; call cipher.encrypt(secret); persist as ciphertext, never plaintext',
      };
    },
  },
  {
    id: 'adr-0014-cascade',
    label: 'ADR-0014 cascade',
    category: 'warning',
    fastSafe: true,
    run(): CheckResult {
      // ADR-0014 (2026-05-05) inserted TRIAL_EXHAUSTED into the denial
      // precedence chain. Detect whether the canonical source has it yet.
      // Until present: warn — CLAUDE.md invariant 6 is also stale.
      const constantsPath = resolve(REPO_ROOT, 'packages/types/src/constants.ts');
      if (!existsSync(constantsPath)) return { status: 'skip', details: 'constants.ts not found' };
      const body = readFileSync(constantsPath, 'utf8');
      // The canonical list is `export const DENIAL_REASON_PRECEDENCE = [...]`.
      const m = body.match(/DENIAL_REASON_PRECEDENCE[^\[]*\[([\s\S]*?)\]/);
      if (!m)
        return { status: 'skip', details: 'DENIAL_REASON_PRECEDENCE not found in constants.ts' };
      const reasons = Array.from((m[1] ?? '').matchAll(/'([A-Z_]+)'/g)).map((mm) => mm[1]!);
      const hasTrialExhausted = reasons.includes('TRIAL_EXHAUSTED');
      if (hasTrialExhausted) {
        return {
          status: 'pass',
          details: `${reasons.length} reasons (includes TRIAL_EXHAUSTED — ADR-0014 cascade applied)`,
          metrics: { reasonCount: reasons.length },
        };
      }
      return {
        status: 'warn',
        details: `${reasons.length} reasons — TRIAL_EXHAUSTED missing per ADR-0014`,
        metrics: { reasonCount: reasons.length },
        remediation:
          'add TRIAL_EXHAUSTED between SCOPE_NOT_GRANTED and SPEND_LIMIT_EXCEEDED in constants.ts; cascade to verify.dto.ts, OpenAPI spec, SECURITY.md, CLAUDE.md inv 6, denial-precedence-enum.spec.ts',
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Filesystem helpers (no external deps)
// ---------------------------------------------------------------------------

function countFiles(dir: string, include: RegExp, exclude?: RegExp): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next')
        continue;
      n += countFiles(full, include, exclude);
    } else if (include.test(entry.name) && (!exclude || !exclude.test(entry.name))) {
      n++;
    }
  }
  return n;
}

function countDirs(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
}

// ---------------------------------------------------------------------------
// Output — pretty + JSON
// ---------------------------------------------------------------------------

const isTty = process.stdout.isTTY === true;
const C = {
  reset: isTty ? '\x1b[0m' : '',
  dim: isTty ? '\x1b[2m' : '',
  bold: isTty ? '\x1b[1m' : '',
  green: isTty ? '\x1b[32m' : '',
  yellow: isTty ? '\x1b[33m' : '',
  red: isTty ? '\x1b[31m' : '',
  blue: isTty ? '\x1b[34m' : '',
  gray: isTty ? '\x1b[90m' : '',
};

function symbol(s: CheckStatus): string {
  switch (s) {
    case 'pass':
      return `${C.green}✅${C.reset}`;
    case 'warn':
      return `${C.yellow}⚠${C.reset} `;
    case 'fail':
      return `${C.red}❌${C.reset}`;
    case 'skip':
      return `${C.gray}⏭${C.reset} `;
  }
}

function printPretty(results: CompletedCheck[], totalMs: number, exitCode: number): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const sep = '─'.repeat(70);
  process.stdout.write(`\n${C.bold}CERNIQ Preflight${C.reset} — ${ts}\n${C.dim}${sep}${C.reset}\n`);
  const labelWidth = Math.max(...results.map((r) => r.label.length));
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const idx = `[${String(i + 1).padStart(2)}/${results.length}]`;
    const label = r.label.padEnd(labelWidth);
    const elapsed = r.elapsedMs > 0 ? `${C.dim}${(r.elapsedMs / 1000).toFixed(1)}s${C.reset}` : '';
    process.stdout.write(
      `${C.dim}${idx}${C.reset} ${symbol(r.status)} ${label}  ${r.details ?? ''} ${elapsed}\n`,
    );
    if (r.status === 'fail' && r.remediation) {
      process.stdout.write(`${C.dim}        fix: ${r.remediation}${C.reset}\n`);
    }
  }
  process.stdout.write(`${C.dim}${sep}${C.reset}\n`);
  const counts = tally(results);
  const summary = `${C.green}${counts.pass} pass${C.reset} · ${C.yellow}${counts.warn} warn${C.reset} · ${C.red}${counts.fail} fail${C.reset} · ${C.gray}${counts.skip} skip${C.reset}`;
  const verdict =
    exitCode === 0
      ? `${C.green}${C.bold}READY TO SHIP${C.reset}`
      : exitCode === 1
        ? `${C.yellow}${C.bold}SHIP WITH CARE${C.reset} (warnings)`
        : `${C.red}${C.bold}DO NOT SHIP${C.reset} (gating failure)`;
  process.stdout.write(`${verdict}\n`);
  process.stdout.write(`Result: ${summary}\n`);
  process.stdout.write(`Total:  ${(totalMs / 1000).toFixed(1)}s · exit ${exitCode}\n\n`);
}

function printJson(results: CompletedCheck[], totalMs: number, exitCode: number): void {
  const payload = {
    version: '1',
    timestamp: new Date().toISOString(),
    exitCode,
    result: exitCode === 0 ? 'pass' : exitCode === 1 ? 'warn' : 'fail',
    totalMs,
    summary: tally(results),
    checks: results,
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

export function tally(
  results: readonly CompletedCheck[],
): Record<CheckStatus, number> & { total: number } {
  const t: Record<CheckStatus, number> & { total: number } = {
    pass: 0,
    warn: 0,
    fail: 0,
    skip: 0,
    total: results.length,
  };
  for (const r of results) t[r.status]++;
  return t;
}

/**
 * Compute the exit code from a list of completed checks.
 *   - any gating fail   → 2
 *   - any warn or non-gating fail → 1
 *   - else → 0
 * Exported so tests can lock the policy.
 */
export function computeExitCode(results: readonly CompletedCheck[]): 0 | 1 | 2 {
  const anyGatingFail = results.some((r) => r.category === 'gating' && r.status === 'fail');
  if (anyGatingFail) return 2;
  const anyWarnOrFail = results.some(
    (r) => r.status === 'warn' || (r.status === 'fail' && r.category === 'warning'),
  );
  return anyWarnOrFail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  const ctx: Context = { prod: flags.prod };

  const planned = CHECKS.filter((c) => {
    if (flags.skip.has(c.id)) return false;
    if (flags.only && !flags.only.has(c.id)) return false;
    if (flags.fast && !c.fastSafe) return false;
    return true;
  });

  if (planned.length === 0) {
    console.error('preflight: no checks selected (try removing --only / --skip)');
    return 3;
  }

  const results: CompletedCheck[] = [];
  for (const check of planned) {
    if (!flags.json) {
      process.stdout.write(`${C.dim}running ${check.id}…${C.reset}\r`);
    }
    const t0 = Date.now();
    let result: CheckResult;
    try {
      result = await check.run(ctx);
    } catch (err) {
      result = {
        status: 'fail',
        details: `internal error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const elapsedMs = Date.now() - t0;
    results.push({
      id: check.id,
      label: check.label,
      category: check.category,
      status: result.status,
      elapsedMs,
      details: result.details,
      metrics: result.metrics,
      remediation: result.remediation,
    });
    if (!flags.json) {
      // Clear "running…" line.
      process.stdout.write('\x1b[2K\r');
    }
  }

  const exitCode = computeExitCode(results);
  const totalMs = results.reduce((acc, r) => acc + r.elapsedMs, 0);

  if (flags.json) printJson(results, totalMs, exitCode);
  else printPretty(results, totalMs, exitCode);

  return exitCode;
}

// Gate CLI execution so tests can import this file without invoking main().
// process.argv[1] is the entry script; compare against this file's URL.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('preflight: internal error', err);
      process.exit(3);
    });
}
