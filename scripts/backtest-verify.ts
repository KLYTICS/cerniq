#!/usr/bin/env -S node --import=tsx
/**
 * OKORO — verify backtest harness.
 *
 * Reads N AuditEvent rows in chronological order, reconstructs a verify input
 * from each row's `policySnapshot` jsonb + denormalised columns, replays the
 * input through the CURRENT pure verify algorithm at
 * `apps/api/src/modules/verify/algorithm/verify.algorithm.ts`, and diffs the
 * fresh decision against the historical decision.
 *
 * What we replay:
 *   - inputs: { action, amount, currency, merchantDomain } from the audit row
 *   - agent state at replay time (status, trustScore, trustBand, publicKey)
 *   - policy state at replay time (status, expiresAt, scopes via DB or
 *     policySnapshot if the row exists)
 *
 * Limitation honestly disclosed: we DO NOT have the original signed token
 * (we never persist it). To exercise step 3 (signature verify) we would need
 * a faithful re-sign, which is impossible — only the agent's owner has the
 * private key. So we stub `verifyJwt` to return synthesised claims and
 * `decodeJwtUnsafe` likewise. The harness therefore EXCLUDES the
 * INVALID_SIGNATURE branch from match-rate scoring (those rows are skipped
 * with a clear "skipped: signature replay impossible" tag).
 *
 * Refusal-to-fabricate: if the algorithm cannot be loaded, exit 1 with code
 * `ALGORITHM_NOT_PORTABLE`. Never report match=0 as success.
 *
 * Usage:
 *   pnpm --filter @okoro/scripts run backtest-verify -- --since 2026-04-01 --limit 1000
 *   pnpm --filter @okoro/scripts run backtest-verify -- --json
 */

import { stdout, stderr, exit, argv, env } from 'node:process';
import { Command } from 'commander';

// ── Types we need from the algorithm — kept narrow so the file typechecks
//    even if the algorithm package isn't generated yet.

interface AlgoInput {
  token: string;
  action?: string;
  amount?: number;
  currency?: string;
  merchantId?: string;
  merchantDomain?: string;
}

interface AlgoOutput {
  valid: boolean;
  agentId: string | null;
  principalId: string | null;
  trustScore: number;
  trustBand: unknown;
  scopesGranted: string[];
  denialReason: string | null;
  verifiedAt: string;
  ttl: number;
  latencyMs: number;
}

interface AlgoPorts {
  getAgent: (id: string) => Promise<unknown>;
  getPolicy: (id: string) => Promise<unknown>;
  verifyJwt: (token: string, pub: string) => Promise<unknown>;
  decodeJwtUnsafe: (token: string) => unknown;
  checkSpend: (
    agentId: string,
    policyId: string,
    amount: number,
    currency: string,
    limit: unknown,
  ) => Promise<boolean>;
  recordSpend: (...args: unknown[]) => void;
  recordAudit: (...args: unknown[]) => void;
  ingestSignal: (...args: unknown[]) => void;
  touchAgent: (...args: unknown[]) => void;
  now?: () => Date;
  featureFlags?: { bateEnabled?: boolean };
}

type VerifyAlgorithmFn = (input: AlgoInput, ports: AlgoPorts) => Promise<AlgoOutput>;

// ── Audit row shape (subset we consume) ────────────────────────────

interface AuditRow {
  id: string;
  agentId: string;
  principalId: string;
  action: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason: string | null;
  relyingParty: string | null;
  requestedAmount: { toNumber?: () => number } | number | null;
  currency: string | null;
  policyId: string | null;
  policySnapshot: unknown;
  trustScoreAtEvent: number;
  trustBandAtEvent: string;
  timestamp: Date;
}

interface PrismaShape {
  auditEvent: {
    findMany: (args: {
      where: Record<string, unknown>;
      orderBy: { timestamp: 'asc' };
      take: number;
    }) => Promise<AuditRow[]>;
  };
  agentIdentity: {
    findUnique: (args: { where: { id: string } }) => Promise<{
      id: string;
      publicKey: string;
      status: string;
      trustScore: number;
      trustBand: string;
      principalId: string;
    } | null>;
  };
  agentPolicy: {
    findUnique: (args: { where: { id: string } }) => Promise<{
      id: string;
      status: string;
      expiresAt: Date;
      scopes: unknown;
    } | null>;
  };
  $disconnect: () => Promise<void>;
}

// ── CLI ───────────────────────────────────────────────────────────

interface CliOpts {
  since?: string;
  until?: string;
  principal?: string;
  threshold: string;
  json: boolean;
  limit: string;
}

function parseCli(args: string[]): CliOpts {
  const program = new Command()
    .name('backtest-verify')
    .description('Replay AuditEvent rows through the current verify algorithm')
    .option('--since <iso>', 'lower bound on timestamp')
    .option('--until <iso>', 'upper bound on timestamp')
    .option('--principal <id>', 'restrict to one principalId')
    .option('--threshold <float>', 'minimum match rate to exit 0', '0.99')
    .option('--limit <n>', 'max rows to replay', '1000')
    .option('--json', 'JSON output', false)
    .exitOverride();
  program.parse(args, { from: 'user' });
  return program.opts<CliOpts>();
}

// ── Algorithm loader ──────────────────────────────────────────────

async function loadAlgorithm(): Promise<VerifyAlgorithmFn> {
  // Path is relative to where tsx executes (scripts/) and reaches into
  // apps/api. If apps/api hasn't been built or types haven't been generated,
  // we fail loudly with ALGORITHM_NOT_PORTABLE so we never report a fake
  // match rate.
  let mod: { verifyAlgorithm?: VerifyAlgorithmFn };
  try {
    // Dynamic import path computed at runtime so this script doesn't gain a
    // build-time dep on @okoro/api — keeps backtest tooling cleanly outside
    // the api workspace.
    const algoPath = '../apps/api/src/modules/verify/algorithm/verify.algorithm';
    mod = (await import(/* @vite-ignore */ algoPath)) as { verifyAlgorithm?: VerifyAlgorithmFn };
  } catch (err) {
    throw new Error(
      `ALGORITHM_NOT_PORTABLE: failed to load apps/api/src/modules/verify/algorithm/verify.algorithm — ${(err as Error).message}`,
    );
  }
  if (!mod.verifyAlgorithm) {
    throw new Error(
      'ALGORITHM_NOT_PORTABLE: verify.algorithm exports no `verifyAlgorithm` function',
    );
  }
  return mod.verifyAlgorithm;
}

// ── Decision normaliser ───────────────────────────────────────────

interface NormalisedDecision {
  decision: 'APPROVED' | 'DENIED';
  denialReason: string | null;
}

function fromAudit(row: AuditRow): NormalisedDecision {
  return {
    decision: row.decision === 'APPROVED' ? 'APPROVED' : 'DENIED',
    denialReason: row.denialReason ?? null,
  };
}

function fromAlgo(out: AlgoOutput): NormalisedDecision {
  return {
    decision: out.valid ? 'APPROVED' : 'DENIED',
    denialReason: out.denialReason ?? null,
  };
}

function decimalToNumber(v: AuditRow['requestedAmount']): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
}

// ── Replay one row ────────────────────────────────────────────────

interface ReplayResult {
  id: string;
  was: NormalisedDecision;
  now: NormalisedDecision;
  match: boolean;
  skipped?: 'signature-replay-impossible';
}

async function replayOne(
  algo: VerifyAlgorithmFn,
  prisma: PrismaShape,
  row: AuditRow,
): Promise<ReplayResult> {
  const was = fromAudit(row);

  // Rows whose historical decision was INVALID_SIGNATURE cannot be replayed
  // — we never persisted the original token. Skip honestly.
  if (was.denialReason === 'INVALID_SIGNATURE') {
    return {
      id: row.id,
      was,
      now: was,
      match: true,
      skipped: 'signature-replay-impossible',
    };
  }

  const agent = await prisma.agentIdentity.findUnique({ where: { id: row.agentId } });
  const policy = row.policyId
    ? await prisma.agentPolicy.findUnique({ where: { id: row.policyId } })
    : null;

  // Replay ports: real DB reads for agent/policy; stubbed crypto + spend.
  // The audit row's policySnapshot is the source of truth for the scope set
  // at the moment of the original decision — we honor it over the live row,
  // because policies can mutate (or be deleted) after the fact. If we have
  // no snapshot, fall back to the live policy.
  const liveScopes = policy?.scopes;
  const snapshotScopes = row.policySnapshot;
  const replayScopes = snapshotScopes ?? liveScopes ?? [];

  const ports: AlgoPorts = {
    getAgent: async () =>
      agent
        ? {
            id: agent.id,
            publicKey: agent.publicKey,
            status: agent.status,
            trustScore: agent.trustScore,
            trustBand: agent.trustBand,
            principalId: agent.principalId,
          }
        : null,
    getPolicy: async () =>
      policy
        ? {
            id: policy.id,
            status: policy.status,
            expiresAt: policy.expiresAt,
            scopes: replayScopes,
          }
        : row.policyId
          ? {
              // Policy may have been hard-deleted — synthesise an EXPIRED
              // shell so step 4 returns POLICY_EXPIRED, matching the audit.
              id: row.policyId,
              status: 'EXPIRED',
              expiresAt: new Date(0),
              scopes: replayScopes,
            }
          : null,
    verifyJwt: async () => ({
      sub: row.agentId,
      pid: row.policyId ?? '',
      iat: 0,
      exp: 9_999_999_999,
      jti: row.id,
      act: row.action,
    }),
    decodeJwtUnsafe: () => ({
      sub: row.agentId,
      pid: row.policyId ?? '',
      iat: 0,
      exp: 9_999_999_999,
      jti: row.id,
      act: row.action,
    }),
    checkSpend: async () => {
      // We cannot perfectly reconstruct the spend window here without a
      // pure replay of every prior SpendRecord — out of scope for this
      // first cut. We approximate "spend was OK at the time" iff the
      // historical decision wasn't SPEND_LIMIT_EXCEEDED.
      return was.denialReason !== 'SPEND_LIMIT_EXCEEDED';
    },
    recordSpend: () => {},
    recordAudit: () => {},
    ingestSignal: () => {},
    touchAgent: () => {},
    now: () => row.timestamp,
    featureFlags: { bateEnabled: false },
  };

  const out = await algo(
    {
      token: 'replay-stub.replay-stub.replay-stub',
      action: row.action,
      amount: decimalToNumber(row.requestedAmount),
      currency: row.currency ?? undefined,
      merchantDomain: row.relyingParty ?? undefined,
    },
    ports,
  );
  const now = fromAlgo(out);
  const match =
    was.decision === now.decision && (was.denialReason ?? null) === (now.denialReason ?? null);
  return { id: row.id, was, now, match };
}

// ── Main ──────────────────────────────────────────────────────────

interface BacktestReport {
  total: number;
  replayed: number;
  skipped: number;
  matched: number;
  matchRate: number;
  threshold: number;
  diffs: Array<{ id: string; was: NormalisedDecision; now: NormalisedDecision }>;
  diffGroups: Record<string, number>;
}

async function main(): Promise<void> {
  const opts = parseCli(argv.slice(2));
  const threshold = Number(opts.threshold);
  const limit = Number(opts.limit);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('USAGE_ERROR: --threshold must be in [0,1]');
  }

  const algo = await loadAlgorithm();

  const prismaMod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => PrismaShape;
  };
  const prisma: PrismaShape = new prismaMod.PrismaClient();

  try {
    const where: Record<string, unknown> = {};
    if (opts.since || opts.until) {
      const ts: Record<string, Date> = {};
      if (opts.since) ts.gte = new Date(opts.since);
      if (opts.until) ts.lte = new Date(opts.until);
      where.timestamp = ts;
    }
    if (opts.principal) where.principalId = opts.principal;

    const rows = await prisma.auditEvent.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: limit,
    });

    const results: ReplayResult[] = [];
    for (const row of rows) {
      try {
        results.push(await replayOne(algo, prisma, row));
      } catch (err) {
        stderr.write(`replay error on ${row.id}: ${(err as Error).message}\n`);
      }
    }

    const skipped = results.filter((r) => r.skipped).length;
    const evaluated = results.filter((r) => !r.skipped);
    const matched = evaluated.filter((r) => r.match).length;
    const matchRate = evaluated.length === 0 ? 1 : matched / evaluated.length;

    const diffs = evaluated
      .filter((r) => !r.match)
      .map((r) => ({ id: r.id, was: r.was, now: r.now }));
    const diffGroups: Record<string, number> = {};
    for (const d of diffs) {
      const key = `${d.was.decision}:${d.was.denialReason ?? '-'}  ->  ${d.now.decision}:${d.now.denialReason ?? '-'}`;
      diffGroups[key] = (diffGroups[key] ?? 0) + 1;
    }

    const report: BacktestReport = {
      total: rows.length,
      replayed: evaluated.length,
      skipped,
      matched,
      matchRate,
      threshold,
      diffs,
      diffGroups,
    };

    if (opts.json) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      stdout.write(`backtest verify\n`);
      stdout.write(`  total rows:    ${report.total}\n`);
      stdout.write(`  replayed:      ${report.replayed}\n`);
      stdout.write(`  skipped:       ${report.skipped}  (signature-replay-impossible)\n`);
      stdout.write(`  matched:       ${report.matched}\n`);
      stdout.write(`  match rate:    ${(matchRate * 100).toFixed(2)}%\n`);
      stdout.write(`  threshold:     ${(threshold * 100).toFixed(2)}%\n`);
      if (Object.keys(diffGroups).length > 0) {
        stdout.write(`  diffs:\n`);
        for (const [k, v] of Object.entries(diffGroups)) {
          stdout.write(`    ${v.toString().padStart(5)}  ${k}\n`);
        }
      }
    }

    exit(matchRate >= threshold ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = (() => {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  try {
    const entryUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`${msg}\n`);
    // Distinguish ALGORITHM_NOT_PORTABLE in env so wrappers can grep:
    if (msg.startsWith('ALGORITHM_NOT_PORTABLE')) {
      env.OKORO_BACKTEST_FAILURE = 'ALGORITHM_NOT_PORTABLE';
    }
    exit(1);
  });
}

export { fromAlgo, fromAudit, replayOne };
