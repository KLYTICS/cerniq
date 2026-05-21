#!/usr/bin/env node
// AEGIS audit-verifier CLI.
//
//   aegis-audit-verify verify <export.ndjson> [options]
//
// Options:
//   --jwks <url>           Fetch JWKS from URL (HTTPS).
//   --jwks-file <path>     Read JWKS from a local file (airgapped path).
//   --no-fail-fast         Walk every row even after a break; report all.
//   --max-row-detail <n>   Cap the per-row detail in JSON output (default 100).
//   --json                 Emit machine-readable JSON to stdout.
//
// Exit codes:
//   0  chain intact
//   1  chain break detected (signature or link mismatch)
//   2  argument / IO error
//
// Examples:
//   aegis-audit-verify verify ./export.ndjson \
//     --jwks https://api.aegislabs.io/.well-known/audit-signing-key
//
//   aegis-audit-verify verify ./export.ndjson \
//     --jwks-file ./aegis-audit-jwks.json --json > report.json

import { readFile } from 'node:fs/promises';
import { argv, exit, stdout, stderr } from 'node:process';

import { verifyChain } from './chain.js';
import { loadJwksFromFile, loadJwksFromUrl } from './jwks.js';
import type { ChainReport } from './types.js';

import { parseAuditNdjson } from './index.js';

interface CliArgs {
  command: 'verify';
  ndjsonPath: string;
  jwksUrl: string | undefined;
  jwksFile: string | undefined;
  failFast: boolean;
  maxRowDetail: number;
  json: boolean;
}

function parseArgs(input: string[]): CliArgs {
  if (input[0] !== 'verify') {
    fail('first argument must be "verify"', 2);
  }
  const ndjsonPath = input[1];
  if (!ndjsonPath || ndjsonPath.startsWith('--')) {
    fail('missing NDJSON path: aegis-audit-verify verify <path>', 2);
  }
  const get = (flag: string): string | undefined => {
    const idx = input.indexOf(flag);
    if (idx === -1 || idx === input.length - 1) return undefined;
    return input[idx + 1];
  };
  const args: CliArgs = {
    command: 'verify',
    ndjsonPath,
    jwksUrl: get('--jwks'),
    jwksFile: get('--jwks-file'),
    failFast: !input.includes('--no-fail-fast'),
    maxRowDetail: Number(get('--max-row-detail') ?? '100'),
    json: input.includes('--json'),
  };
  if (!args.jwksUrl && !args.jwksFile) {
    fail('one of --jwks <url> or --jwks-file <path> is required', 2);
  }
  if (args.jwksUrl && args.jwksFile) {
    fail('use --jwks OR --jwks-file, not both', 2);
  }
  if (!Number.isInteger(args.maxRowDetail) || args.maxRowDetail < 0) {
    fail(`--max-row-detail must be a non-negative integer, got "${get('--max-row-detail')}"`, 2);
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));

  let jwks;
  if (args.jwksFile) {
    jwks = await loadJwksFromFile(args.jwksFile);
  } else if (args.jwksUrl) {
    jwks = await loadJwksFromUrl(args.jwksUrl);
  } else {
    fail('one of --jwks <url> or --jwks-file <path> is required', 2);
  }

  const ndjson = await readFile(args.ndjsonPath, 'utf8');
  const rows = parseAuditNdjson(ndjson);

  const report = await verifyChain(rows, {
    jwks,
    failFast: args.failFast,
    maxRowDetail: args.maxRowDetail,
  });

  if (args.json) {
    stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printHumanReport(report);
  }
  return report.valid ? 0 : 1;
}

function printHumanReport(report: ChainReport): void {
  const tag = report.valid ? '✓ INTACT' : '✗ BROKEN';
  stdout.write(`AEGIS audit chain — ${tag}\n`);
  stdout.write('─'.repeat(60) + '\n');
  stdout.write(`rows verified : ${report.totalRows}\n`);
  stdout.write(`signing keys  : ${report.signingKeys.join(', ') || '(none)'}\n`);
  stdout.write(`rotation events: ${report.rotationEvents.length}\n`);
  for (const r of report.rotationEvents) {
    stdout.write(`  • atIndex=${r.atIndex}  ${r.fromKid} → ${r.toKid}\n`);
  }
  stdout.write(`duration      : ${report.durationMs}ms\n`);
  if (report.firstBreak) {
    stdout.write('\n');
    stdout.write(`first break   : row ${report.firstBreak.index} (${report.firstBreak.eventId})\n`);
    stdout.write(`  kid         : ${report.firstBreak.signingKeyId}\n`);
    stdout.write(`  signature   : ${report.firstBreak.signatureValid ? 'ok' : 'INVALID'}\n`);
    stdout.write(`  chain link  : ${report.firstBreak.chainLinkValid ? 'ok' : 'INVALID'}\n`);
    stdout.write(`  reason      : ${report.firstBreak.reason ?? '(none)'}\n`);
  }
}

function fail(msg: string, code: number): never {
  stderr.write(`aegis-audit-verify: ${msg}\n`);
  exit(code);
}

main()
  .then((code) => exit(code))
  .catch((err: unknown) => {
    stderr.write(`aegis-audit-verify: fatal — ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    exit(2);
  });
