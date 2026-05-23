#!/usr/bin/env -S node --import=tsx
/**
 * CERNIQ — manual audit-retention sweep.
 *
 * Bootstraps a Nest standalone application context (no HTTP listener),
 * resolves `AuditRetentionService`, and invokes `runOnce()`. Useful for:
 *   - On-demand sweeps in environments where the long-running API isn't
 *     trusted with a 24h timer (cron, ECS scheduled task, ad-hoc).
 *   - Incident response: `--principal-id <id>` to scope to a single
 *     tenant when investigating a GDPR escalation.
 *   - Dry-run audits before policy changes: `--dry-run`.
 *
 * Output: one structured JSON object on stdout — pipe to `jq` for
 * dashboards or capture in an audit log of operator actions.
 *
 * Exit codes:
 *   0  — sweep completed; zero per-event failures.
 *   1  — sweep completed; one or more events failed (partial run).
 *   2  — usage error (bad CLI flag).
 *   3  — config / bootstrap error (DB not reachable, app context failed).
 *
 * Lives inside @cerniq/api so the relative imports into `src/*` resolve
 * cleanly and `@nestjs/core` is a real runtime dep. (Moved from
 * `scripts/run-audit-retention.ts` in Round 17 — see SESSION_HANDOFF.)
 */

import { stdout, stderr, exit, argv } from 'node:process';

import { Command, Option } from 'commander';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AuditRetentionService } from '../src/modules/compliance/audit-retention.service';

interface CliOpts {
  dryRun: boolean;
  principalId?: string;
  maxEvents?: number;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('run-audit-retention')
    .description('Run the CERNIQ audit-retention sweep on demand.')
    .addOption(new Option('--dry-run', 'log what would be redacted, no writes').default(false))
    .addOption(new Option('--principal-id <id>', 'restrict the sweep to one principal'))
    .addOption(
      new Option('--max-events <n>', 'safety cap on redactions in this run').argParser((v) => {
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error('--max-events must be a positive integer');
        }
        return n;
      }),
    );

  try {
    program.parse(argv);
  } catch (err) {
    stderr.write(`usage error: ${(err as Error).message}\n`);
    exit(2);
  }

  const opts = program.opts<CliOpts>();

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
  } catch (err) {
    stderr.write(`bootstrap failed: ${(err as Error).message}\n`);
    exit(3);
  }

  try {
    const svc = app.get(AuditRetentionService, { strict: false });
    const result = await svc.runOnce({
      dryRun: opts.dryRun,
      principalId: opts.principalId,
      maxEvents: opts.maxEvents,
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    await app.close();
    exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    stderr.write(`fatal: ${(err as Error).message}\n`);
    try {
      await app.close();
    } catch {
      // best-effort
    }
    exit(3);
  }
}

const isMain =
  argv[1] &&
  (argv[1].endsWith('run-audit-retention.ts') || argv[1].endsWith('run-audit-retention.js'));
if (isMain) {
  main().catch((err) => {
    stderr.write(`fatal: ${(err as Error).message}\n`);
    exit(3);
  });
}
