#!/usr/bin/env node
// reconciliation CLI — joins two NDJSON streams, prints a report.
//
//   pnpm tsx src/cli.ts --cerniq <ndjson> --psp <ndjson> [options]

import { readFile } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';

import {
  parseCerniqNdjson,
  parseSystemNdjson,
  reconcile,
  type ReconcileReport,
} from './reconcile.js';

interface CliArgs {
  cerniqPath: string;
  systemPath: string;
  json: boolean;
  includeMatched: boolean;
}

function parseArgs(input: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = input.indexOf(flag);
    if (idx === -1 || idx === input.length - 1) return undefined;
    return input[idx + 1];
  };
  const cerniqPath = get('--cerniq');
  const systemPath = get('--psp') ?? get('--system');
  if (!cerniqPath || !systemPath) {
    stderr.write(`reconcile: --cerniq <path> and --psp <path> (or --system) are required\n`);
    exit(2);
  }
  return {
    cerniqPath,
    systemPath,
    json: input.includes('--json'),
    includeMatched: input.includes('--include-matched'),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));
  const [cerniqRaw, systemRaw] = await Promise.all([
    readFile(args.cerniqPath, 'utf8'),
    readFile(args.systemPath, 'utf8'),
  ]);
  const cerniq = parseCerniqNdjson(cerniqRaw);
  const system = parseSystemNdjson(systemRaw);
  const report = reconcile(cerniq, system, { includeMatched: args.includeMatched });

  if (args.json) {
    stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printHumanReport(report);
  }
  // Non-zero exit when there's a mismatch — useful for CI / cron.
  return report.approvedMissing + report.deniedPresent + report.reversed > 0 ? 1 : 0;
}

function printHumanReport(report: ReconcileReport): void {
  const banner = report.approvedMissing + report.deniedPresent === 0 ? '✓ CLEAN' : '✗ MISMATCH';
  stdout.write(`CERNIQ reconciliation — ${banner}\n`);
  stdout.write('─'.repeat(60) + '\n');
  stdout.write(`cerniq rows           : ${report.totalCerniqRows}\n`);
  stdout.write(`system rows          : ${report.totalSystemRows}\n`);
  stdout.write(`matched & settled    : ${report.matchedSettled}\n`);
  stdout.write(
    `approved + missing   : ${report.approvedMissing}  ← network drop or system never executed\n`,
  );
  stdout.write(`denied + present     : ${report.deniedPresent}    ← gate bypass — INVESTIGATE\n`);
  stdout.write(`reversed             : ${report.reversed}         ← BATE feedback signal\n`);
  if (Object.keys(report.matchedTotalsByCurrency).length > 0) {
    stdout.write(`\nmatched totals (by currency):\n`);
    for (const [ccy, total] of Object.entries(report.matchedTotalsByCurrency).sort()) {
      stdout.write(`  ${ccy.padEnd(4)} ${total.toLocaleString()}\n`);
    }
  }

  const investigations = report.entries.filter(
    (e) => e.class === 'approved_missing' || e.class === 'denied_present',
  );
  if (investigations.length > 0) {
    stdout.write(`\nrows requiring investigation (${investigations.length}):\n`);
    for (const e of investigations.slice(0, 20)) {
      stdout.write(`  • ${e.class.padEnd(20)} ${e.endToEndId}`);
      if (e.cerniq) stdout.write(`  agent=${e.cerniq.agentId}`);
      if (e.system) stdout.write(`  system=${e.system.systemId}`);
      stdout.write('\n');
    }
    if (investigations.length > 20) {
      stdout.write(`  … ${investigations.length - 20} more — re-run with --json for full list\n`);
    }
  }
}

main()
  .then((code) => exit(code))
  .catch((err: unknown) => {
    stderr.write(
      `reconcile: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    exit(2);
  });
