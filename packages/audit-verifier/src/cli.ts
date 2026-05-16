#!/usr/bin/env node
// AEGIS audit-verifier CLI.
//
//   aegis-audit-verify verify <export.ndjson> [options]
//   aegis-audit-verify verify-manifests <dir> [options]
//
// Subcommands:
//   verify             Walk an NDJSON export of AuditEvent rows; verify
//                      the row chain (signatures + prev-hash links).
//   verify-manifests   Walk a directory of audit-compression manifests
//                      (`*.manifest.json`); verify each signature and
//                      the per-slice manifest chain. Use this for
//                      offline corpus verification (ADR-0015 / M-036).
//
// Options (shared):
//   --jwks <url>           Fetch JWKS from URL (HTTPS).
//   --jwks-file <path>     Read JWKS from a local file (airgapped path).
//   --json                 Emit machine-readable JSON to stdout.
//
// Options (verify only):
//   --no-fail-fast         Walk every row even after a break; report all.
//   --max-row-detail <n>   Cap the per-row detail in JSON output (default 100).
//
// Options (verify-manifests only):
//   --recursive            Recurse into subdirectories. Default: flat.
//
// Exit codes:
//   0  chain intact / corpus valid
//   1  chain break detected (signature or link mismatch)
//   2  argument / IO error / empty input
//
// Examples:
//   aegis-audit-verify verify ./export.ndjson \
//     --jwks https://api.aegislabs.io/.well-known/audit-signing-key
//
//   aegis-audit-verify verify ./export.ndjson \
//     --jwks-file ./aegis-audit-jwks.json --json > report.json
//
//   aegis-audit-verify verify-manifests ./audit-corpus/ \
//     --jwks-file ./aegis-audit-jwks.json --json > manifest-report.json

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, exit, stdout, stderr } from 'node:process';

import { verifyChain } from './chain.js';
import { ManifestValidationError, validateSignedManifest } from './cli-validate.js';
import { loadJwksFromFile, loadJwksFromUrl } from './jwks.js';
import { parseAuditNdjson } from './index.js';
import { verifyManifestCorpus, type ManifestCorpusReport } from './manifest-corpus.js';
import type { SignedAuditCompressionManifest } from './manifest.js';
import type { ChainReport, JwksDocument } from './types.js';

interface CommonOptions {
  jwksUrl: string | undefined;
  jwksFile: string | undefined;
  json: boolean;
}

interface VerifyArgs extends CommonOptions {
  command: 'verify';
  ndjsonPath: string;
  failFast: boolean;
  maxRowDetail: number;
}

interface VerifyManifestsArgs extends CommonOptions {
  command: 'verify-manifests';
  dir: string;
  recursive: boolean;
}

type CliArgs = VerifyArgs | VerifyManifestsArgs;

function parseArgs(input: string[]): CliArgs {
  const sub = input[0];
  if (sub !== 'verify' && sub !== 'verify-manifests') {
    fail('first argument must be "verify" or "verify-manifests"', 2);
  }
  const pathArg = input[1];
  if (!pathArg || pathArg.startsWith('--')) {
    fail(
      sub === 'verify'
        ? 'missing NDJSON path: aegis-audit-verify verify <path>'
        : 'missing directory: aegis-audit-verify verify-manifests <dir>',
      2,
    );
  }
  const get = (flag: string): string | undefined => {
    const idx = input.indexOf(flag);
    if (idx === -1 || idx === input.length - 1) return undefined;
    return input[idx + 1];
  };
  const common: CommonOptions = {
    jwksUrl: get('--jwks'),
    jwksFile: get('--jwks-file'),
    json: input.includes('--json'),
  };
  if (!common.jwksUrl && !common.jwksFile) {
    fail('one of --jwks <url> or --jwks-file <path> is required', 2);
  }
  if (common.jwksUrl && common.jwksFile) {
    fail('use --jwks OR --jwks-file, not both', 2);
  }

  if (sub === 'verify') {
    const maxRowDetail = Number(get('--max-row-detail') ?? '100');
    if (!Number.isInteger(maxRowDetail) || maxRowDetail < 0) {
      fail(`--max-row-detail must be a non-negative integer, got "${get('--max-row-detail')}"`, 2);
    }
    // `pathArg` is narrowed to `string` here because the earlier
    // `if (!pathArg || …) fail(...)` exits via `fail(): never`.
    return {
      command: 'verify',
      ndjsonPath: pathArg,
      failFast: !input.includes('--no-fail-fast'),
      maxRowDetail,
      ...common,
    };
  }
  return {
    command: 'verify-manifests',
    dir: pathArg,
    recursive: input.includes('--recursive'),
    ...common,
  };
}

async function loadJwks(opts: CommonOptions): Promise<JwksDocument> {
  return opts.jwksFile ? await loadJwksFromFile(opts.jwksFile) : await loadJwksFromUrl(opts.jwksUrl!);
}

async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));
  const jwks = await loadJwks(args);

  if (args.command === 'verify') {
    const ndjson = await readFile(args.ndjsonPath, 'utf8');
    const rows = parseAuditNdjson(ndjson);
    const report = await verifyChain(rows, {
      jwks,
      failFast: args.failFast,
      maxRowDetail: args.maxRowDetail,
    });
    if (args.json) stdout.write(JSON.stringify(report, null, 2) + '\n');
    else printHumanReport(report);
    return report.valid ? 0 : 1;
  }

  // verify-manifests
  const files = await listManifestFiles(args.dir, args.recursive);
  if (files.length === 0) {
    fail(`no *.manifest.json files found under ${args.dir}`, 2);
  }
  const signed: SignedAuditCompressionManifest[] = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      fail(`${file}: invalid JSON — ${(err as Error).message}`, 2);
    }
    try {
      signed.push(validateSignedManifest(parsed, file));
    } catch (err) {
      if (err instanceof ManifestValidationError) fail(err.message, 2);
      throw err;
    }
  }
  const report = await verifyManifestCorpus(signed, jwks);
  if (args.json) stdout.write(JSON.stringify(report, null, 2) + '\n');
  else printManifestCorpusReport(report);
  return report.valid ? 0 : 1;
}

async function listManifestFiles(dir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...(await listManifestFiles(full, true)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.manifest.json')) {
      out.push(full);
    }
  }
  out.sort();
  return out;
}

function printManifestCorpusReport(report: ManifestCorpusReport): void {
  const tag = report.valid ? '✓ VALID' : '✗ INVALID';
  stdout.write(`AEGIS audit-compression corpus — ${tag}\n`);
  stdout.write('─'.repeat(60) + '\n');
  stdout.write(`manifests verified : ${report.totalManifests}\n`);
  stdout.write(`slices             : ${report.totalSlices}\n`);
  stdout.write(`rows covered       : ${report.totalRows}\n`);
  stdout.write(`signing keys used  : ${report.signingKeysUsed.join(', ') || '(none)'}\n`);
  stdout.write(`duration           : ${report.durationMs}ms\n`);
  const sigFailures = report.perManifest.filter((m) => !m.signatureValid);
  if (sigFailures.length > 0) {
    stdout.write('\nsignature failures:\n');
    for (const m of sigFailures) {
      stdout.write(`  • ${m.manifestId} (slice=${m.tenantSliceId} kid=${m.signingKeyId}): ${m.signatureReason}\n`);
    }
  }
  const walkFailures = report.perSlice.filter((s) => s.walked && s.walkOk === false);
  if (walkFailures.length > 0) {
    stdout.write('\nchain walk failures:\n');
    for (const s of walkFailures) {
      stdout.write(`  • slice=${s.tenantSliceId} failedAt=${s.walkFailedAtIndex} reason=${s.walkReason}\n`);
    }
  }
  const skipped = report.perSlice.filter((s) => !s.walked && s.manifestCount > 0);
  if (skipped.length > 0) {
    stdout.write('\nslices skipped (signature failure inside):\n');
    for (const s of skipped) {
      stdout.write(`  • slice=${s.tenantSliceId} manifests=${s.manifestCount}\n`);
    }
  }
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
