#!/usr/bin/env -S node --import=tsx
/**
 * OKORO — `pnpm db:index-audit` — verify-hot-path index recommendation.
 *
 * Connects to `DATABASE_URL` and runs `EXPLAIN (ANALYZE, FORMAT JSON)`
 * against six representative hot queries the verify path issues against
 * Postgres on every authenticated call. Parses the plan, classifies the
 * top scan as `Index Scan` / `Index Only Scan` / `Bitmap Index Scan` /
 * `Seq Scan`, captures total cost + actual time, and emits:
 *
 *   1. A markdown report at `dist/db-index-audit-report.md` with one row
 *      per query.
 *   2. For every flagged sequential scan above the cost threshold, a
 *      recommended `CREATE INDEX` statement (printed only — never auto-applied;
 *      schema changes go through Prisma migrations + operator approval).
 *
 * SAFETY
 *   - Read-only. The only SQL we send is `EXPLAIN ANALYZE SELECT …`.
 *   - We use parameter values from the demo seed (Maria's `principalId`,
 *     `maria/checkout-bot`) rather than mining the live DB so the operator
 *     can run this on staging without leaking customer ids into the report.
 *   - Refuses to run if `DATABASE_URL` is missing.
 *
 * NOTE: this script is *advisory*. Schema-level @@index additions still
 * have to land via a Prisma migration; this just produces the recommendation
 * artifact so the operator can approve / reject in review.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, env, exit, stderr, stdout } from 'node:process';

import { Command, Option } from 'commander';

// ──────────────────────────────────────────────────────────────────
// Hot-query catalog. The six queries below mirror the call sites listed in
// CLAUDE.md / scripts/benchmark-verify.ts:
//
//   1. ApiKey lookup by hashed key                  (auth guard, every req)
//   2. AgentIdentity by (principalId, label)        (verify, every req)
//   3. AgentPolicy by (agentId, status='ACTIVE')    (verify, every req)
//   4. AuditEvent ordered by (principalId, ts DESC) (retention scan)
//   5. BateSignal by (agentId, occurredAt > N)      (trust scoring)
//   6. WebhookSubscription by (principalId, active) (fan-out)
//
// We use parameterized SQL (`$1`, `$2`) so EXPLAIN sees the same plan the
// real query planner picks. Some plans are sensitive to parameter values
// (skew etc.) — using realistic demo-seed values keeps the audit honest.
// ──────────────────────────────────────────────────────────────────

export interface HotQueryDef {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
  /** Suggested index when this query falls back to a Seq Scan over the threshold. */
  readonly remediation: {
    readonly table: string;
    readonly columns: ReadonlyArray<string>;
    readonly where?: string;
  };
}

export const DEFAULT_DEMO_PRINCIPAL_ID = 'demo-principal-placeholder';
export const DEFAULT_DEMO_AGENT_ID = 'demo-agent-placeholder';
export const DEFAULT_DEMO_KEY_HASH = '$2a$04$placeholderbcrypthashvalueXXXXXXXXXXXXXXXXXXXX';

export function buildHotQueries(args: {
  principalId: string;
  agentId: string;
  apiKeyHash: string;
  bateLookbackDays: number;
}): HotQueryDef[] {
  const lookbackInterval = `${args.bateLookbackDays} days`;
  return [
    {
      id: 'apikey-by-hash',
      description: 'ApiKey lookup by hashed key (every authenticated request)',
      sql: 'SELECT id, "principalId", scope, "expiresAt", "revokedAt" FROM "ApiKey" WHERE "keyHash" = $1 LIMIT 1',
      params: [args.apiKeyHash],
      remediation: { table: 'ApiKey', columns: ['keyHash'] },
    },
    {
      id: 'agent-by-principal-label',
      description: 'AgentIdentity lookup by (principalId, label) (every verify)',
      sql: 'SELECT id, status, "trustScore", "trustBand", "publicKey" FROM "AgentIdentity" WHERE "principalId" = $1 AND label = $2 LIMIT 1',
      params: [args.principalId, 'maria/checkout-bot'],
      remediation: { table: 'AgentIdentity', columns: ['principalId', 'label'] },
    },
    {
      id: 'policy-by-agent-active',
      description: 'AgentPolicy lookup by (agentId, status=ACTIVE) (every verify)',
      sql: 'SELECT id, "expiresAt", scopes, "tokenHash" FROM "AgentPolicy" WHERE "agentId" = $1 AND status = $2 ORDER BY "createdAt" DESC LIMIT 1',
      params: [args.agentId, 'ACTIVE'],
      remediation: {
        table: 'AgentPolicy',
        columns: ['agentId', 'status', 'createdAt'],
      },
    },
    {
      id: 'audit-by-principal-ts',
      description: 'AuditEvent ordered by (principalId, timestamp DESC) (retention scan + dashboard)',
      sql: 'SELECT id, decision, "denialReason", "timestamp" FROM "AuditEvent" WHERE "principalId" = $1 ORDER BY "timestamp" DESC LIMIT 100',
      params: [args.principalId],
      remediation: { table: 'AuditEvent', columns: ['principalId', 'timestamp DESC'] },
    },
    {
      id: 'bate-by-agent-recent',
      description: 'BateSignal filtered by (agentId, occurredAt > N days ago) (trust scoring)',
      sql: `SELECT id, "signalType", severity, "scoreDelta" FROM "BateSignal" WHERE "agentId" = $1 AND "occurredAt" > NOW() - INTERVAL '${lookbackInterval}' ORDER BY "occurredAt" DESC`,
      params: [args.agentId],
      remediation: { table: 'BateSignal', columns: ['agentId', 'occurredAt DESC'] },
    },
    {
      id: 'webhooks-by-principal-active',
      description: 'WebhookSubscription filtered by (principalId, active=true, events @> X) (fan-out)',
      sql: 'SELECT id, url, secret, events FROM "WebhookSubscription" WHERE "principalId" = $1 AND active = TRUE AND events @> $2',
      params: [args.principalId, ['verify.allowed']],
      remediation: {
        table: 'WebhookSubscription',
        columns: ['principalId', 'active'],
        where: 'active = TRUE',
      },
    },
  ];
}

// ──────────────────────────────────────────────────────────────────
// EXPLAIN parsing — pure, covered by the spec when a fixture is added.
// ──────────────────────────────────────────────────────────────────

export type ScanType =
  | 'Index Scan'
  | 'Index Only Scan'
  | 'Bitmap Index Scan'
  | 'Bitmap Heap Scan'
  | 'Seq Scan'
  | 'Other';

export interface PlanSummary {
  scanType: ScanType;
  totalCost: number;
  actualTimeMs: number | null;
  rawNodeType: string;
}

interface ExplainNode {
  'Node Type'?: string;
  'Total Cost'?: number;
  'Actual Total Time'?: number;
  Plans?: ExplainNode[];
}

/**
 * Walk the plan tree, return the worst node (by total cost) along the
 * common access path. Postgres often parents an Index Scan under a Limit
 * or Sort, so we descend until we find a scan node.
 */
export function summarizeExplain(planJson: ReadonlyArray<{ Plan: ExplainNode }>): PlanSummary {
  const root = planJson[0]?.Plan;
  if (!root) {
    return { scanType: 'Other', totalCost: 0, actualTimeMs: null, rawNodeType: 'Empty' };
  }

  let worst: ExplainNode = root;
  const stack: ExplainNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const isScan = typeof node['Node Type'] === 'string' && /Scan/.test(node['Node Type']);
    if (isScan) {
      const wc = worst['Total Cost'] ?? 0;
      const nc = node['Total Cost'] ?? 0;
      if (nc >= wc) worst = node;
    }
    if (Array.isArray(node.Plans)) {
      for (const child of node.Plans) stack.push(child);
    }
  }

  return {
    scanType: classifyScan(worst['Node Type']),
    totalCost: worst['Total Cost'] ?? 0,
    actualTimeMs: typeof worst['Actual Total Time'] === 'number' ? worst['Actual Total Time'] : null,
    rawNodeType: worst['Node Type'] ?? 'Unknown',
  };
}

function classifyScan(nodeType: string | undefined): ScanType {
  switch (nodeType) {
    case 'Index Scan':
    case 'Index Only Scan':
    case 'Bitmap Index Scan':
    case 'Bitmap Heap Scan':
    case 'Seq Scan':
      return nodeType;
    default:
      return 'Other';
  }
}

// ──────────────────────────────────────────────────────────────────
// Recommendations.
// ──────────────────────────────────────────────────────────────────

export interface AuditRow {
  query: HotQueryDef;
  plan: PlanSummary;
  flagged: boolean;
  recommendation: string | null;
}

export function buildRecommendation(query: HotQueryDef): string {
  const cols = query.remediation.columns
    .map((c) => {
      // Allow `colname DESC` etc. straight through.
      const [name, ...rest] = c.split(' ');
      const ident = `"${name}"`;
      return rest.length > 0 ? `${ident} ${rest.join(' ')}` : ident;
    })
    .join(', ');
  const idxName = `idx_${query.remediation.table.toLowerCase()}_${query.remediation.columns
    .map((c) => c.split(' ')[0]!.toLowerCase())
    .join('_')}`;
  const whereClause = query.remediation.where ? ` WHERE ${query.remediation.where}` : '';
  return `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${idxName}" ON "${query.remediation.table}" (${cols})${whereClause};`;
}

export function evaluateRow(query: HotQueryDef, plan: PlanSummary, costThreshold: number): AuditRow {
  const flagged = plan.scanType === 'Seq Scan' && plan.totalCost > costThreshold;
  return {
    query,
    plan,
    flagged,
    recommendation: flagged ? buildRecommendation(query) : null,
  };
}

// ──────────────────────────────────────────────────────────────────
// Markdown rendering.
// ──────────────────────────────────────────────────────────────────

export function renderMarkdownReport(rows: ReadonlyArray<AuditRow>, generatedAt: string): string {
  const lines: string[] = [];
  lines.push('# OKORO — DB Index Audit (verify hot path)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Source: `scripts/db-index-audit.ts` — runs `EXPLAIN ANALYZE` against six representative hot queries on the verify path. Read-only; no schema changes are applied.');
  lines.push('');
  lines.push('| # | Query | Scan Type | Total Cost | Actual Time (ms) | Flagged |');
  lines.push('|---|-------|-----------|-----------:|-----------------:|---------|');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const time = r.plan.actualTimeMs === null ? 'n/a' : r.plan.actualTimeMs.toFixed(3);
    const flag = r.flagged ? 'YES' : 'no';
    lines.push(
      `| ${i + 1} | \`${r.query.id}\` — ${escapeMd(r.query.description)} | ${r.plan.scanType} | ${r.plan.totalCost.toFixed(2)} | ${time} | ${flag} |`,
    );
  }
  lines.push('');

  const flagged = rows.filter((r) => r.flagged);
  if (flagged.length === 0) {
    lines.push('## Recommendations');
    lines.push('');
    lines.push('No sequential scans above the cost threshold detected. Indexes look healthy for the demo dataset; re-run after meaningful traffic growth.');
  } else {
    lines.push('## Recommended Indexes (operator review required)');
    lines.push('');
    lines.push('Each statement below uses `CREATE INDEX CONCURRENTLY` so it can be applied without locking the table. Add them to a Prisma migration; do not apply directly to production.');
    lines.push('');
    for (const r of flagged) {
      lines.push(`### ${r.query.id}`);
      lines.push('');
      lines.push(r.query.description);
      lines.push('');
      lines.push('```sql');
      lines.push(r.recommendation!);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|');
}

// ──────────────────────────────────────────────────────────────────
// Structural Prisma surface — keeps the script testable + decouples from
// generated client types that may not exist when type-checking in isolation.
// ──────────────────────────────────────────────────────────────────

export interface ExplainPrisma {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
  $disconnect(): Promise<void>;
}

export type ExplainRow = { 'QUERY PLAN': Array<{ Plan: ExplainNode }> };

/**
 * Run `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS)` for each query. ANALYZE
 * actually executes the SELECT — that's intentional; we want real timings,
 * not just planner cost estimates.
 */
export async function runExplainAll(
  prisma: ExplainPrisma,
  queries: ReadonlyArray<HotQueryDef>,
): Promise<Array<{ query: HotQueryDef; plan: PlanSummary; rawError?: string }>> {
  const out: Array<{ query: HotQueryDef; plan: PlanSummary; rawError?: string }> = [];
  for (const q of queries) {
    try {
      const rows = await prisma.$queryRawUnsafe<ExplainRow[]>(
        `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS) ${q.sql}`,
        ...q.params,
      );
      const planJson = rows[0]?.['QUERY PLAN'] ?? [];
      out.push({ query: q, plan: summarizeExplain(planJson) });
    } catch (err) {
      out.push({
        query: q,
        plan: { scanType: 'Other', totalCost: 0, actualTimeMs: null, rawNodeType: 'Error' },
        rawError: (err as Error).message,
      });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// CLI entry.
// ──────────────────────────────────────────────────────────────────

interface CliOpts {
  costThreshold: string;
  bateDays: string;
  output: string;
  principalId: string;
  agentId: string;
  apiKeyHash: string;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('db-index-audit')
    .description('EXPLAIN ANALYZE the verify-hot-path queries; flag missing indexes.')
    .addOption(new Option('--cost-threshold <n>', 'flag Seq Scan above this total-cost').default('100'))
    .addOption(new Option('--bate-days <n>', 'BateSignal lookback window in days').default('30'))
    .addOption(new Option('--output <path>', 'markdown report path').default('dist/db-index-audit-report.md'))
    .addOption(
      new Option('--principal-id <id>', 'principalId to bind into the EXPLAIN params').default(
        env.OKORO_DEMO_PRINCIPAL_ID ?? DEFAULT_DEMO_PRINCIPAL_ID,
      ),
    )
    .addOption(
      new Option('--agent-id <id>', 'agentId (DB id, not label) to bind into EXPLAIN params').default(
        env.OKORO_DEMO_AGENT_ID ?? DEFAULT_DEMO_AGENT_ID,
      ),
    )
    .addOption(
      new Option('--api-key-hash <hash>', 'bcrypt hash to bind into the ApiKey EXPLAIN').default(
        env.OKORO_DEMO_API_KEY_HASH ?? DEFAULT_DEMO_KEY_HASH,
      ),
    );

  try {
    program.parse(argv);
  } catch (err) {
    stderr.write(`usage error: ${(err as Error).message}\n`);
    exit(2);
  }
  const opts = program.opts<CliOpts>();

  if (!env.DATABASE_URL) {
    stderr.write('DATABASE_URL is required\n');
    exit(3);
  }

  const costThreshold = Number.parseInt(opts.costThreshold, 10);
  const bateDays = Number.parseInt(opts.bateDays, 10);
  if (!Number.isFinite(costThreshold) || costThreshold < 0) {
    stderr.write(`--cost-threshold must be a non-negative integer (got ${opts.costThreshold})\n`);
    exit(2);
  }
  if (!Number.isFinite(bateDays) || bateDays <= 0) {
    stderr.write(`--bate-days must be a positive integer (got ${opts.bateDays})\n`);
    exit(2);
  }

  const queries = buildHotQueries({
    principalId: opts.principalId,
    agentId: opts.agentId,
    apiKeyHash: opts.apiKeyHash,
    bateLookbackDays: bateDays,
  });

  // type-rationale: PrismaClient's generated types may not exist when this
  // script is type-checked in isolation; cast through unknown to a structural
  // surface that exposes only what we need.
  const prismaMod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => ExplainPrisma;
  };
  const prisma: ExplainPrisma = new prismaMod.PrismaClient();

  try {
    const explained = await runExplainAll(prisma, queries);
    const rows: AuditRow[] = explained.map((e) => evaluateRow(e.query, e.plan, costThreshold));
    const md = renderMarkdownReport(rows, new Date().toISOString());
    const outPath = resolve(opts.output);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, md, 'utf8');
    stdout.write(`wrote ${outPath}\n`);

    const flagged = rows.filter((r) => r.flagged);
    if (flagged.length > 0) {
      stdout.write(`\nFLAGGED: ${flagged.length} sequential scan(s) above cost ${costThreshold}.\n`);
      for (const f of flagged) {
        stdout.write(`  ${f.query.id}: ${f.recommendation}\n`);
      }
    } else {
      stdout.write('\nNo sequential scans flagged. Indexes look healthy.\n');
    }
    exit(flagged.length > 0 ? 1 : 0);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain =
  argv[1] !== undefined &&
  (argv[1].endsWith('db-index-audit.ts') || argv[1].endsWith('db-index-audit.js'));

if (isMain) {
  main().catch((err) => {
    stderr.write(`fatal: ${(err as Error).message}\n`);
    exit(1);
  });
}
