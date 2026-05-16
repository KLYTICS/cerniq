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

const USAGE_TEXT = `aegis-audit-verify — offline audit-chain + manifest-corpus verifier

Usage:
  aegis-audit-verify verify <export.ndjson> [options]
  aegis-audit-verify verify-manifests <dir> [options]

Subcommands:
  verify             Walk an NDJSON export of AuditEvent rows; verify
                     the row chain (signatures + prev-hash links).
  verify-manifests   Walk a directory of audit-compression manifests
                     (*.manifest.json); verify each signature and the
                     per-slice manifest chain. Offline corpus path
                     (ADR-0015 / M-036).

Options (shared):
  --jwks <url>           Fetch JWKS from URL (HTTPS).
  --jwks-file <path>     Read JWKS from a local file (airgapped path).
  --json                 Emit machine-readable JSON to stdout.

Options (verify only):
  --no-fail-fast         Walk every row even after a break; report all.
  --max-row-detail <n>   Cap the per-row detail in JSON output (default 100).

Options (verify-manifests only):
  --recursive            Recurse into subdirectories. Default: flat.

Exit codes:
  0  chain intact / corpus valid
  1  chain break detected (signature or link mismatch)
  2  argument / IO error / empty input

Examples:
  aegis-audit-verify verify ./export.ndjson \\
    --jwks https://api.aegislabs.io/.well-known/audit-signing-key

  aegis-audit-verify verify-manifests ./audit-corpus/ \\
    --jwks-file ./aegis-audit-jwks.json --json > manifest-report.json
`;

function printUsage(stream: typeof stdout | typeof stderr): void {
  stream.write(USAGE_TEXT);
}

// Discriminated result type for parseArgs. Lets the parser stay side-effect
// free (no exit, no stderr writes) so every branch is unit-testable. The
// caller (main) handles the I/O and exit-code mapping. Three states:
//
//   ok        — args ready, run the subcommand.
//   help      — operator asked for usage (--help / -h / 'help' as arg0).
//               Caller prints to stdout, exits 0.
//   invalid   — argv is malformed in some way. Caller prints to stderr
//               and exits 2. `message` is the actionable detail to follow
//               the usage block.
export type ParseResult =
  | { ok: true; args: CliArgs }
  | { ok: false; reason: 'help'; exitCode: 0 }
  | { ok: false; reason: 'invalid'; message: string; exitCode: 2 };

const ASK_HELP = { ok: false, reason: 'help', exitCode: 0 } as const;
const invalid = (message: string): ParseResult => ({ ok: false, reason: 'invalid', message, exitCode: 2 });

// Per-subcommand known-flag sets. Drives the unknown-flag walk so an
// operator typo like `--josn` or `--frobnicate` (or a subcommand-mismatch
// like `verify-manifests d --max-row-detail 5`) fails fast with the
// catalogue of valid flags, instead of silently absorbing the typo.
const VERIFY_FLAGS: ReadonlySet<string> = new Set([
  '--jwks',
  '--jwks-file',
  '--json',
  '--no-fail-fast',
  '--max-row-detail',
]);
const VERIFY_MANIFESTS_FLAGS: ReadonlySet<string> = new Set([
  '--jwks',
  '--jwks-file',
  '--json',
  '--recursive',
]);

export function parseArgs(input: string[]): ParseResult {
  const sub = input[0];
  // Root-level help: -h / --help / 'help' as the first arg are operator-
  // initiated usage requests, not error paths. Caller prints to stdout and
  // exits 0. Anything else routes through the strict subcommand check below
  // (printing to stderr + exit 2 via the 'invalid' branch).
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    return ASK_HELP;
  }
  if (sub !== 'verify' && sub !== 'verify-manifests') {
    return invalid(
      sub === undefined
        ? 'no subcommand given; see usage above (or run --help for the same)'
        : `unknown subcommand "${sub}"; expected "verify" or "verify-manifests" — see usage above`,
    );
  }
  // Help-anywhere routing: `aegis-audit-verify verify --help` is a UX
  // expectation in every modern CLI. We don't yet have subcommand-specific
  // help bodies, but routing to root usage is strictly better than the
  // alternatives (path-validation rejecting `--help` as "missing NDJSON
  // path", or the unknown-flag walk rejecting `--help` as unknown). When
  // subcommand-specific help is added later, this branch becomes the
  // dispatch point.
  for (let i = 1; i < input.length; i++) {
    if (input[i] === '--help' || input[i] === '-h') {
      return ASK_HELP;
    }
  }
  const pathArg = input[1];
  if (!pathArg || pathArg.startsWith('--')) {
    return invalid(
      sub === 'verify'
        ? 'missing NDJSON path: aegis-audit-verify verify <path>'
        : 'missing directory: aegis-audit-verify verify-manifests <dir>',
    );
  }
  // Unknown-flag walk: scan input[2..] (past subcommand + path) for any
  // `--xxx` arg that isn't in this subcommand's whitelist. Catches:
  //   - Typos:                 verify x --josn --jwks https://y
  //   - Wrong subcommand:      verify-manifests d --jwks y --max-row-detail 5
  //   - Made-up flags:         verify x --jwks y --frobnicate
  // The previous parser silently absorbed all of these, leaving the
  // operator with no signal that their intent was discarded.
  //
  // Caveat: this walk doesn't know which `--xxx` slots are flag values
  // (e.g. `--jwks --json` would flag `--json` as the value-slot for
  // `--jwks`, then walk would see `--json` as a known flag — no false
  // positive). The tristate getFlag below catches the missing-value
  // case earlier with a more specific error.
  const known = sub === 'verify' ? VERIFY_FLAGS : VERIFY_MANIFESTS_FLAGS;
  for (let i = 2; i < input.length; i++) {
    const arg = input[i]!;
    if (arg.startsWith('--') && !known.has(arg)) {
      const validList = [...known].sort().join(', ');
      return invalid(
        `unknown flag "${arg}" for "${sub}" subcommand — valid flags: ${validList}`,
      );
    }
  }
  // getFlag distinguishes three states the old get() collapsed into one:
  //
  //   { present: false, value: undefined }                 — flag absent
  //   { present: true,  value: undefined }                 — flag present but
  //                                                          no value follows
  //                                                          (end of argv OR
  //                                                          another --flag)
  //   { present: true,  value: '<string>' }                — flag with value
  //
  // The old shape returned undefined for both "absent" and "missing value",
  // so callers could not emit a flag-specific error. Bugs that hid here:
  //   - `aegis-audit-verify verify x --jwks` (end of argv): silently fell
  //     through to "one of --jwks <url> or --jwks-file <path> is required",
  //     misleading because operator DID specify --jwks.
  //   - `aegis-audit-verify verify x --jwks --json`: silently captured
  //     '--json' as the JWKS URL, only failing later at loadJwksFromUrl.
  //   - `aegis-audit-verify verify x --jwks y --max-row-detail` (end of argv):
  //     silently defaulted maxRowDetail to 100 — operator intent discarded
  //     without any signal.
  const getFlag = (flag: string): { present: boolean; value: string | undefined } => {
    const idx = input.indexOf(flag);
    if (idx === -1) return { present: false, value: undefined };
    if (idx === input.length - 1) return { present: true, value: undefined };
    const next = input[idx + 1]!;
    if (next.startsWith('--')) return { present: true, value: undefined };
    return { present: true, value: next };
  };

  const jwksFlag = getFlag('--jwks');
  const jwksFileFlag = getFlag('--jwks-file');
  if (jwksFlag.present && jwksFlag.value === undefined) {
    return invalid('--jwks requires a URL value (got end of argv or another flag)');
  }
  if (jwksFileFlag.present && jwksFileFlag.value === undefined) {
    return invalid('--jwks-file requires a path value (got end of argv or another flag)');
  }
  const common: CommonOptions = {
    jwksUrl: jwksFlag.value,
    jwksFile: jwksFileFlag.value,
    json: input.includes('--json'),
  };
  if (!common.jwksUrl && !common.jwksFile) {
    return invalid('one of --jwks <url> or --jwks-file <path> is required');
  }
  if (common.jwksUrl && common.jwksFile) {
    return invalid('use --jwks OR --jwks-file, not both');
  }

  if (sub === 'verify') {
    const maxRowDetailFlag = getFlag('--max-row-detail');
    if (maxRowDetailFlag.present && maxRowDetailFlag.value === undefined) {
      return invalid('--max-row-detail requires a non-negative integer value (got end of argv or another flag)');
    }
    const maxRowDetail = Number(maxRowDetailFlag.value ?? '100');
    if (!Number.isInteger(maxRowDetail) || maxRowDetail < 0) {
      return invalid(`--max-row-detail must be a non-negative integer, got "${maxRowDetailFlag.value}"`);
    }
    return {
      ok: true,
      args: {
        command: 'verify',
        ndjsonPath: pathArg,
        failFast: !input.includes('--no-fail-fast'),
        maxRowDetail,
        ...common,
      },
    };
  }
  return {
    ok: true,
    args: {
      command: 'verify-manifests',
      dir: pathArg,
      recursive: input.includes('--recursive'),
      ...common,
    },
  };
}

async function loadJwks(opts: CommonOptions): Promise<JwksDocument> {
  return opts.jwksFile ? await loadJwksFromFile(opts.jwksFile) : await loadJwksFromUrl(opts.jwksUrl!);
}

async function main(): Promise<number> {
  const parsed = parseArgs(argv.slice(2));
  if (!parsed.ok) {
    // Dispatch the two non-ok branches:
    //   help    → usage to stdout, exit 0 (operator-requested).
    //   invalid → usage to stderr THEN actionable error message, exit 2.
    // Keeping the usage block before the error gives the operator both
    // the catalogue of options and the specific thing they got wrong,
    // without having to re-run with --help to find out.
    if (parsed.reason === 'help') {
      printUsage(stdout);
      return parsed.exitCode;
    }
    printUsage(stderr);
    stderr.write(`aegis-audit-verify: ${parsed.message}\n`);
    return parsed.exitCode;
  }
  const { args } = parsed;
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

// Entry-point guard: only auto-run main() when this module is the binary
// the OS invoked (process.argv[1] is the cli artifact). When the module is
// imported — e.g. by cli.spec.ts to test parseArgs — argv[1] is the test
// runner instead, and we skip the side-effects to avoid calling process.exit
// inside vitest. Matches dist/cli.{cjs,mjs} (tsup output) plus the in-source
// path used during vitest transform.
const entryPath = process.argv[1] ?? '';
const isCliEntry =
  entryPath.endsWith('/cli.cjs') ||
  entryPath.endsWith('/cli.mjs') ||
  entryPath.endsWith('/cli.js') ||
  entryPath.endsWith('/cli.ts') ||
  entryPath.endsWith('\\cli.cjs') ||
  entryPath.endsWith('\\cli.mjs');

if (isCliEntry) {
  main()
    .then((code) => exit(code))
    .catch((err: unknown) => {
      stderr.write(`aegis-audit-verify: fatal — ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      exit(2);
    });
}
