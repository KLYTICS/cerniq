#!/usr/bin/env node
// AEGIS audit-verifier CLI.
//
//   aegis-audit-verify verify <export.ndjson> [options]
//   aegis-audit-verify verify-manifests <dir> [options]
//
// Subcommands:
//   verify             Verify an NDJSON audit-event export end-to-end.
//   verify-manifests   Verify the signed-manifest corpus in <dir>.
//   help / --help / -h Print this usage block.
//
// Flags:
//   --jwks <url>           Fetch JWKS from URL (HTTPS).
//   --jwks-file <path>     Read JWKS from a local file (airgapped path).
//   --no-fail-fast         (verify only) Walk every row past a break.
//   --max-row-detail <n>   (verify only) Cap per-row detail (default 100).
//   --recursive            (verify-manifests only) Walk subdirectories.
//   --json                 Emit machine-readable JSON to stdout.
//
// Exit codes:
//   0  chain intact / help requested
//   1  chain break detected (signature or link mismatch)
//   2  argument / IO error
//
// Examples:
//   aegis-audit-verify verify ./export.ndjson \
//     --jwks https://api.aegislabs.io/.well-known/audit-signing-key
//
//   aegis-audit-verify verify ./export.ndjson \
//     --jwks-file ./aegis-audit-jwks.json --json > report.json
//
//   aegis-audit-verify verify-manifests ./audit-corpus \
//     --jwks-file ./aegis-audit-jwks.json --recursive

import { readFile, readdir } from 'node:fs/promises';
import { argv, exit, stdout, stderr } from 'node:process';
import { join } from 'node:path';

import { verifyChain } from './chain.js';
import { loadJwksFromFile, loadJwksFromUrl } from './jwks.js';
import { verifyManifestCorpus } from './manifest-corpus.js';
import { parseAuditNdjson } from './index.js';
import type { SignedAuditCompressionManifest } from './manifest.js';
import type { ChainReport } from './types.js';

// ────────────────────────────────────────────────────────────────────
// Types — exported so cli.spec.ts can assert ParseResult discriminants
// ────────────────────────────────────────────────────────────────────

export interface VerifyArgs {
  command: 'verify';
  ndjsonPath: string;
  jwksUrl: string | undefined;
  jwksFile: string | undefined;
  failFast: boolean;
  maxRowDetail: number;
  json: boolean;
}

export interface VerifyManifestsArgs {
  command: 'verify-manifests';
  dir: string;
  jwksUrl: string | undefined;
  jwksFile: string | undefined;
  recursive: boolean;
  json: boolean;
}

export type CliArgs = VerifyArgs | VerifyManifestsArgs;

export type ParseResult =
  | { ok: true; args: CliArgs }
  | { ok: false; reason: 'help'; exitCode: 0 }
  | { ok: false; reason: 'invalid'; exitCode: 2; message: string };

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

/** Tokens that route the parse to a 'help' ParseResult, anywhere in argv. */
const HELP_TOKENS = new Set(['--help', '-h', 'help']);

/** Valid flags for `verify`. Listed in JS default-sort order. */
const VERIFY_FLAGS = ['--json', '--jwks', '--jwks-file', '--max-row-detail', '--no-fail-fast'] as const;

/** Valid flags for `verify-manifests`. */
const VERIFY_MANIFESTS_FLAGS = ['--json', '--jwks', '--jwks-file', '--recursive'] as const;

/** Value-bearing flags vs. boolean flags. Value-bearing flags consume the next argv slot. */
const VALUE_FLAGS = new Set(['--jwks', '--jwks-file', '--max-row-detail']);

// ────────────────────────────────────────────────────────────────────
// Public parser
// ────────────────────────────────────────────────────────────────────

/**
 * Parse `aegis-audit-verify`'s argv (the slice past `argv[0]` and
 * `argv[1]`). Total function — never throws, never exits, returns a
 * discriminator-valid {@link ParseResult} for any string[] input.
 *
 * Help routing: if any of `--help`, `-h`, or the bare token `help`
 * appears anywhere in argv, the result is `{ ok: false, reason: 'help' }`.
 *
 * Otherwise: validate the first-arg subcommand, then dispatch to the
 * subcommand-specific flag parser.
 */
export function parseArgs(input: readonly string[]): ParseResult {
  // (1) Help anywhere short-circuits. The spec locks --help-wins-over-everything.
  for (const tok of input) {
    if (HELP_TOKENS.has(tok)) return help();
  }

  // (2) First-arg routing.
  if (input.length === 0) return invalid('no subcommand given. Expected "verify" or "verify-manifests".');
  const cmd = input[0]!;
  if (cmd === 'verify') return parseVerify(input);
  if (cmd === 'verify-manifests') return parseVerifyManifests(input);
  return invalid(`unknown subcommand "${cmd}". expected "verify" or "verify-manifests".`);
}

// ────────────────────────────────────────────────────────────────────
// verify subcommand parser
// ────────────────────────────────────────────────────────────────────

function parseVerify(input: readonly string[]): ParseResult {
  const ndjsonPath = input[1];
  if (!ndjsonPath || ndjsonPath.startsWith('--')) {
    return invalid('missing NDJSON path: aegis-audit-verify verify <path>');
  }

  // (a) Flag-value validation (missing-value silent-typo guard).
  const jwksRaw = getFlagValue(input, '--jwks');
  if (jwksRaw.present && jwksRaw.value === null) {
    return invalid('--jwks requires a URL value');
  }
  const jwksFileRaw = getFlagValue(input, '--jwks-file');
  if (jwksFileRaw.present && jwksFileRaw.value === null) {
    return invalid('--jwks-file requires a path value');
  }
  const maxRowRaw = getFlagValue(input, '--max-row-detail');
  if (maxRowRaw.present && maxRowRaw.value === null) {
    return invalid('--max-row-detail requires a non-negative integer value');
  }

  // (b) Source-of-keys: exactly one of --jwks or --jwks-file.
  if (!jwksRaw.present && !jwksFileRaw.present) {
    return invalid('one of --jwks <url> or --jwks-file <path> is required');
  }
  if (jwksRaw.present && jwksFileRaw.present) {
    return invalid('use --jwks OR --jwks-file, not both');
  }

  // (c) maxRowDetail strict integer validation.
  let maxRowDetail = 100;
  if (maxRowRaw.present && maxRowRaw.value !== null) {
    if (!/^[0-9]+$/.test(maxRowRaw.value)) {
      return invalid(`--max-row-detail must be a non-negative integer, got "${maxRowRaw.value}"`);
    }
    maxRowDetail = Number(maxRowRaw.value);
  }

  // (d) Unknown-flag rejection. Any --xxx not in VERIFY_FLAGS is a typo.
  const unknown = findUnknownFlag(input, VERIFY_FLAGS);
  if (unknown !== null) {
    return invalid(unknownFlagMessage(unknown, 'verify', VERIFY_FLAGS));
  }

  return {
    ok: true,
    args: {
      command: 'verify',
      ndjsonPath,
      jwksUrl: jwksRaw.value ?? undefined,
      jwksFile: jwksFileRaw.value ?? undefined,
      failFast: !input.includes('--no-fail-fast'),
      maxRowDetail,
      json: input.includes('--json'),
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// verify-manifests subcommand parser
// ────────────────────────────────────────────────────────────────────

function parseVerifyManifests(input: readonly string[]): ParseResult {
  const dir = input[1];
  if (!dir || dir.startsWith('--')) {
    return invalid('missing directory: aegis-audit-verify verify-manifests <dir>');
  }

  const jwksRaw = getFlagValue(input, '--jwks');
  if (jwksRaw.present && jwksRaw.value === null) {
    return invalid('--jwks requires a URL value');
  }
  const jwksFileRaw = getFlagValue(input, '--jwks-file');
  if (jwksFileRaw.present && jwksFileRaw.value === null) {
    return invalid('--jwks-file requires a path value');
  }

  if (!jwksRaw.present && !jwksFileRaw.present) {
    return invalid('one of --jwks <url> or --jwks-file <path> is required');
  }
  if (jwksRaw.present && jwksFileRaw.present) {
    return invalid('use --jwks OR --jwks-file, not both');
  }

  const unknown = findUnknownFlag(input, VERIFY_MANIFESTS_FLAGS);
  if (unknown !== null) {
    return invalid(unknownFlagMessage(unknown, 'verify-manifests', VERIFY_MANIFESTS_FLAGS));
  }

  return {
    ok: true,
    args: {
      command: 'verify-manifests',
      dir,
      jwksUrl: jwksRaw.value ?? undefined,
      jwksFile: jwksFileRaw.value ?? undefined,
      recursive: input.includes('--recursive'),
      json: input.includes('--json'),
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Flag-value helpers (tristate semantics)
// ────────────────────────────────────────────────────────────────────

interface FlagLookup {
  /** Was the flag present anywhere in argv? */
  present: boolean;
  /** The consuming value, or null if flag was at end-of-argv or followed by another flag. */
  value: string | null;
}

/**
 * Tristate lookup of a value-bearing flag. First occurrence wins
 * (matches the indexOf semantics the spec locks). Returns:
 *
 *   - `{ present: false, value: null }` — flag not in argv.
 *   - `{ present: true, value: null }` — flag at end of argv OR followed
 *     by another `--*` token (missing value, silent-typo case).
 *   - `{ present: true, value: <str> }` — flag with a real value.
 */
function getFlagValue(input: readonly string[], flag: string): FlagLookup {
  const idx = input.indexOf(flag);
  if (idx === -1) return { present: false, value: null };
  const next = input[idx + 1];
  if (next === undefined || next.startsWith('--')) return { present: true, value: null };
  return { present: true, value: next };
}

/**
 * Walk argv and find the first `--xxx` token that is not in the
 * known-flag list AND is not the value-position of a known value-bearing
 * flag. Returns the bad flag string or null if none found.
 */
function findUnknownFlag(input: readonly string[], known: readonly string[]): string | null {
  const knownSet = new Set<string>(known);
  // Compute the set of indices that are flag-value positions to skip them.
  const valuePositions = new Set<number>();
  for (let i = 0; i < input.length; i++) {
    const tok = input[i]!;
    if (VALUE_FLAGS.has(tok) && knownSet.has(tok)) {
      const next = input[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        valuePositions.add(i + 1);
      }
    }
  }
  // Position 0 is the subcommand; position 1 is the positional path/dir.
  // Both are consumed regardless of shape.
  for (let i = 2; i < input.length; i++) {
    if (valuePositions.has(i)) continue;
    const tok = input[i]!;
    if (tok.startsWith('--') && !knownSet.has(tok)) {
      return tok;
    }
  }
  return null;
}

function unknownFlagMessage(flag: string, subcommand: 'verify' | 'verify-manifests', known: readonly string[]): string {
  // Sort lexicographically (JS default sort, codepoint order). The spec
  // locks the order to catch silent reorderings of the operator-facing
  // catalogue.
  const sorted = [...known].sort();
  return `unknown flag "${flag}" for "${subcommand}" subcommand. valid flags: ${sorted.join(', ')}`;
}

// ────────────────────────────────────────────────────────────────────
// ParseResult constructors
// ────────────────────────────────────────────────────────────────────

function help(): ParseResult {
  return { ok: false, reason: 'help', exitCode: 0 };
}

function invalid(message: string): ParseResult {
  return { ok: false, reason: 'invalid', exitCode: 2, message };
}

// ────────────────────────────────────────────────────────────────────
// Usage block (printed on help)
// ────────────────────────────────────────────────────────────────────

const USAGE = `aegis-audit-verify — offline audit-chain verifier.

USAGE
  aegis-audit-verify verify <export.ndjson> --jwks <url>|--jwks-file <path> [flags]
  aegis-audit-verify verify-manifests <dir> --jwks <url>|--jwks-file <path> [flags]
  aegis-audit-verify --help

SUBCOMMANDS
  verify             Verify an NDJSON audit-event export end-to-end.
                     Recomputes prev_hash + canonical(payload) for every
                     row and checks the Ed25519 signature against the
                     published JWKS.
  verify-manifests   Verify the signed-manifest corpus in <dir>. Walks
                     manifest files and validates the slice-cohesion
                     invariants against the JWKS.

FLAGS (verify)
  --jwks <url>           Fetch JWKS from URL (HTTPS).
  --jwks-file <path>     Read JWKS from a local file (airgapped path).
  --no-fail-fast         Walk every row even after a break; report all.
  --max-row-detail <n>   Cap per-row detail in JSON output (default 100).
  --json                 Emit machine-readable JSON to stdout.

FLAGS (verify-manifests)
  --jwks <url>           Fetch JWKS from URL (HTTPS).
  --jwks-file <path>     Read JWKS from a local file (airgapped path).
  --recursive            Walk subdirectories of <dir>.
  --json                 Emit machine-readable JSON to stdout.

EXIT CODES
  0  chain intact / help requested
  1  chain break detected (signature or link mismatch)
  2  argument / IO error

EXAMPLES
  aegis-audit-verify verify ./export.ndjson \\
    --jwks https://api.aegislabs.io/.well-known/audit-signing-key

  aegis-audit-verify verify ./export.ndjson \\
    --jwks-file ./aegis-audit-jwks.json --json > report.json

  aegis-audit-verify verify-manifests ./audit-corpus \\
    --jwks-file ./aegis-audit-jwks.json --recursive
`;

// ────────────────────────────────────────────────────────────────────
// main() — dispatches the parsed args
// ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const result = parseArgs(argv.slice(2));
  if (!result.ok) {
    if (result.reason === 'help') {
      stdout.write(USAGE);
      return 0;
    }
    // Usage block precedes the specific error so the operator sees both
    // context and the thing they got wrong. Spec contract: subprocess
    // tests assert both blocks appear on stderr in this order.
    stderr.write(USAGE);
    stderr.write(`\naegis-audit-verify: ${result.message}\n`);
    return 2;
  }

  if (result.args.command === 'verify') return runVerify(result.args);
  return runVerifyManifests(result.args);
}

async function runVerify(args: VerifyArgs): Promise<number> {
  const jwks = args.jwksFile
    ? await loadJwksFromFile(args.jwksFile)
    : await loadJwksFromUrl(args.jwksUrl!);

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

async function runVerifyManifests(args: VerifyManifestsArgs): Promise<number> {
  const jwks = args.jwksFile
    ? await loadJwksFromFile(args.jwksFile)
    : await loadJwksFromUrl(args.jwksUrl!);

  const manifests = await loadManifestsFromDir(args.dir, args.recursive);
  if (manifests.length === 0) {
    stderr.write(`aegis-audit-verify: no manifest files found under ${args.dir}\n`);
    return 2;
  }

  const report = await verifyManifestCorpus(manifests, jwks);

  if (args.json) {
    stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    stdout.write(`AEGIS manifest corpus — ${report.valid ? '✓ INTACT' : '✗ BROKEN'}\n`);
    stdout.write('─'.repeat(60) + '\n');
    stdout.write(`manifests verified : ${report.totalManifests}\n`);
    stdout.write(`slices             : ${report.totalSlices}\n`);
    stdout.write(`signing keys       : ${report.signingKeysUsed.join(', ') || '(none)'}\n`);
    stdout.write(`duration           : ${report.durationMs}ms\n`);
  }
  return report.valid ? 0 : 1;
}

async function loadManifestsFromDir(
  dir: string,
  recursive: boolean,
): Promise<SignedAuditCompressionManifest[]> {
  const out: SignedAuditCompressionManifest[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        out.push(...(await loadManifestsFromDir(path, true)));
      }
      continue;
    }
    if (!entry.name.endsWith('.manifest.json')) continue;
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as SignedAuditCompressionManifest;
    out.push(parsed);
  }
  return out;
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

// ────────────────────────────────────────────────────────────────────
// Entry-point guard
// ────────────────────────────────────────────────────────────────────
//
// Only invoke main() when this file is executed directly (i.e. as the
// binary). Importing it (e.g. from cli.spec.ts) must NOT trigger
// argv parsing or process.exit. The entry-point check matches the
// suffix conventions for cli.cjs (the tsup-built CommonJS bundle) and
// cli.mjs (the ESM build).

const entrypoint = argv[1] ?? '';
const isEntrypoint =
  entrypoint.endsWith('/cli.cjs') ||
  entrypoint.endsWith('/cli.mjs') ||
  entrypoint.endsWith('/cli.js') ||
  entrypoint.endsWith('\\cli.cjs') ||
  entrypoint.endsWith('\\cli.mjs') ||
  entrypoint.endsWith('\\cli.js');

if (isEntrypoint) {
  main()
    .then((code) => exit(code))
    .catch((err: unknown) => {
      stderr.write(
        `aegis-audit-verify: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      exit(2);
    });
}
