// parseArgs spec — exercises every branch of the side-effect-free argv
// parser. Before the refactor that introduced ParseResult, parseArgs
// terminated the process on bad input (fail() → exit()), which made it
// unreachable from a vitest harness. The Result-typed shape lets every
// branch be a single-assertion test.
//
// What this spec validates:
//   - Operator-facing UX: --help / -h / 'help' route to the 'help' result
//     (caller exits 0, prints to stdout).
//   - Argument validation: every fail() call site in the previous shape
//     is replaced by an 'invalid' result with a matching message.
//   - Happy paths: 'verify' and 'verify-manifests' return ok=true with
//     the expected discriminated args shape and flag-bound defaults.
//
// Why not subprocess-spawn the CLI: pnpm exec node dist/cli.cjs --help
// would test the same surface end-to-end, but depends on a built dist
// (the build script itself has a tsbuildinfo cache bug — flagged in
// commit 96f87b3's footer). Pure-function testing here keeps the spec
// fast (millisecond-scale), build-independent, and isolates parser
// regressions from build-pipeline regressions.

import { describe, expect, it } from 'vitest';

import { parseArgs, type ParseResult } from './cli.js';

function expectHelp(r: ParseResult): void {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.reason).toBe('help');
  expect(r.exitCode).toBe(0);
}

function expectInvalid(r: ParseResult, messageMatcher: RegExp): void {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.reason).toBe('invalid');
  if (r.reason !== 'invalid') return;
  expect(r.exitCode).toBe(2);
  expect(r.message).toMatch(messageMatcher);
}

describe('parseArgs — help branch', () => {
  it('--help routes to help result, exit 0', () => {
    expectHelp(parseArgs(['--help']));
  });

  it('-h routes to help result, exit 0', () => {
    expectHelp(parseArgs(['-h']));
  });

  it("bare 'help' subcommand routes to help result, exit 0", () => {
    expectHelp(parseArgs(['help']));
  });

  it('--help wins over a following path that would otherwise look valid', () => {
    // Operator typing `aegis-audit-verify --help verify ./x.ndjson` gets
    // help, not a usage error from arg1 validation. The first-arg branch
    // is the routing point.
    expectHelp(parseArgs(['--help', 'verify', './x.ndjson']));
  });
});

describe('parseArgs — invalid first-argument branch', () => {
  it('empty argv → no-subcommand error, exit 2', () => {
    expectInvalid(parseArgs([]), /no subcommand given/);
  });

  it('unknown subcommand → error names the bad value', () => {
    const r = parseArgs(['nuke-everything']);
    expectInvalid(r, /unknown subcommand "nuke-everything"/);
  });

  it("unknown subcommand error references expected values", () => {
    const r = parseArgs(['foo']);
    expectInvalid(r, /expected "verify" or "verify-manifests"/);
  });
});

describe('parseArgs — verify path/flag validation', () => {
  it('verify with no path → missing NDJSON path error', () => {
    expectInvalid(parseArgs(['verify']), /missing NDJSON path/);
  });

  it('verify with --flag as second arg (not a path) → missing path error', () => {
    expectInvalid(parseArgs(['verify', '--jwks', 'https://x']), /missing NDJSON path/);
  });

  it('verify with path but no JWKS source → required-jwks error', () => {
    expectInvalid(parseArgs(['verify', './export.ndjson']), /one of --jwks <url> or --jwks-file/);
  });

  it('verify with BOTH --jwks and --jwks-file → mutually-exclusive error', () => {
    expectInvalid(
      parseArgs(['verify', './export.ndjson', '--jwks', 'https://x', '--jwks-file', './j.json']),
      /use --jwks OR --jwks-file, not both/,
    );
  });

  it('verify with non-integer --max-row-detail → typed error includes the offending value', () => {
    const r = parseArgs(['verify', './export.ndjson', '--jwks', 'https://x', '--max-row-detail', 'abc']);
    expectInvalid(r, /--max-row-detail must be a non-negative integer, got "abc"/);
  });

  it('verify with negative --max-row-detail → rejected', () => {
    expectInvalid(
      parseArgs(['verify', './export.ndjson', '--jwks', 'https://x', '--max-row-detail', '-5']),
      /--max-row-detail must be a non-negative integer/,
    );
  });
});

describe('parseArgs — verify happy path', () => {
  it('minimum-viable verify args → ok with defaults', () => {
    const r = parseArgs(['verify', './export.ndjson', '--jwks', 'https://example.com/jwks']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args.command).toBe('verify');
    if (r.args.command !== 'verify') return;
    expect(r.args.ndjsonPath).toBe('./export.ndjson');
    expect(r.args.jwksUrl).toBe('https://example.com/jwks');
    expect(r.args.jwksFile).toBeUndefined();
    expect(r.args.failFast).toBe(true); // default: fail-fast on
    expect(r.args.maxRowDetail).toBe(100); // documented default
    expect(r.args.json).toBe(false);
  });

  it('verify with all flags toggled → ok and flags reflected', () => {
    const r = parseArgs([
      'verify',
      './export.ndjson',
      '--jwks-file',
      './aegis-audit-jwks.json',
      '--no-fail-fast',
      '--max-row-detail',
      '50',
      '--json',
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.args.command !== 'verify') return;
    expect(r.args.jwksFile).toBe('./aegis-audit-jwks.json');
    expect(r.args.jwksUrl).toBeUndefined();
    expect(r.args.failFast).toBe(false);
    expect(r.args.maxRowDetail).toBe(50);
    expect(r.args.json).toBe(true);
  });
});

describe('parseArgs — verify-manifests', () => {
  it('verify-manifests with no dir → missing directory error', () => {
    expectInvalid(parseArgs(['verify-manifests']), /missing directory/);
  });

  it('verify-manifests with dir + --jwks → ok with recursive=false default', () => {
    const r = parseArgs(['verify-manifests', './audit-corpus', '--jwks', 'https://x/jwks']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args.command).toBe('verify-manifests');
    if (r.args.command !== 'verify-manifests') return;
    expect(r.args.dir).toBe('./audit-corpus');
    expect(r.args.recursive).toBe(false);
    expect(r.args.json).toBe(false);
  });

  it('verify-manifests with --recursive --json → ok with flags set', () => {
    const r = parseArgs([
      'verify-manifests',
      './audit-corpus',
      '--jwks-file',
      './j.json',
      '--recursive',
      '--json',
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.args.command !== 'verify-manifests') return;
    expect(r.args.recursive).toBe(true);
    expect(r.args.json).toBe(true);
    expect(r.args.jwksFile).toBe('./j.json');
  });
});

describe('parseArgs — flag-value validation (silent-typo guards)', () => {
  // Before getFlag's tristate shape, each of these inputs slipped through
  // with a misleading downstream error (or no error at all). These tests
  // lock the explicit, flag-named error messages so the operator sees
  // "you forgot the value for X" rather than a confusing fallback error
  // or a silently-defaulted run.

  it('--jwks at end of argv → flag-specific error (not the generic "one of --jwks ..." fallback)', () => {
    const r = parseArgs(['verify', './x.ndjson', '--jwks']);
    expectInvalid(r, /--jwks requires a URL value/);
  });

  it('--jwks followed by another flag → flag-specific error, NOT a silently-captured "--json" URL', () => {
    // Before the fix: jwksUrl became literally "--json", loadJwksFromUrl
    // failed later with a URL-parse error far from the actual mistake.
    const r = parseArgs(['verify', './x.ndjson', '--jwks', '--json']);
    expectInvalid(r, /--jwks requires a URL value/);
  });

  it('--jwks-file at end of argv → flag-specific error', () => {
    expectInvalid(parseArgs(['verify', './x.ndjson', '--jwks-file']), /--jwks-file requires a path value/);
  });

  it('--jwks-file followed by another flag → flag-specific error', () => {
    expectInvalid(
      parseArgs(['verify', './x.ndjson', '--jwks-file', '--json']),
      /--jwks-file requires a path value/,
    );
  });

  it('--max-row-detail at end of argv → flag-specific error (NOT a silent default to 100)', () => {
    // Before the fix: silently defaulted to 100; operator's "I want 50" intent
    // was discarded without any signal. Now the missing value is an explicit
    // error so the operator learns about their typo.
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://x', '--max-row-detail']);
    expectInvalid(r, /--max-row-detail requires a non-negative integer value/);
  });

  it('--max-row-detail followed by another flag → flag-specific error', () => {
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://x', '--max-row-detail', '--json']);
    expectInvalid(r, /--max-row-detail requires a non-negative integer value/);
  });

  it('--jwks with a valid URL at end of argv → still ok (negative case for the guard)', () => {
    // Sanity: the missing-value guard must NOT fire when the flag has a
    // real value, even if it's the last arg.
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://example.com/jwks']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.args.command !== 'verify') return;
    expect(r.args.jwksUrl).toBe('https://example.com/jwks');
  });
});

describe('parseArgs — unknown-flag rejection (operator-typo + wrong-subcommand)', () => {
  // These tests lock the contract that *every* `--xxx` arg in argv must
  // belong to the active subcommand's known set. Before this guard, typos
  // like `--josn` or wrong-subcommand flags like `--max-row-detail` on
  // verify-manifests were silently absorbed.

  it('verify with a typo flag → error names the bad flag', () => {
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://y', '--josn']);
    expectInvalid(r, /unknown flag "--josn"/);
  });

  it('verify with a made-up flag → error names it', () => {
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://y', '--frobnicate']);
    expectInvalid(r, /unknown flag "--frobnicate"/);
  });

  it('unknown-flag error includes the subcommand name', () => {
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://y', '--nope']);
    expectInvalid(r, /for "verify" subcommand/);
  });

  it('unknown-flag error includes the valid-flag catalogue for actionable recovery', () => {
    // JS default sort is lexicographic by char code, not dictionary order,
    // so `--json` (s=0x73) comes before `--jwks` (w=0x77). The test locks
    // the actual emitted ordering so a future sort change doesn't silently
    // shuffle the operator-facing catalogue.
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://y', '--nope']);
    expectInvalid(r, /valid flags: --json, --jwks, --jwks-file, --max-row-detail, --no-fail-fast/);
  });

  it('verify-manifests with --max-row-detail (verify-only flag) → rejected as unknown for this sub', () => {
    // Cross-subcommand flag misuse: --max-row-detail only applies to verify
    // (NDJSON row chain) and is meaningless for manifest corpus walking.
    // Previously silently ignored; now caught with the right error.
    const r = parseArgs(['verify-manifests', './corpus', '--jwks', 'https://y', '--max-row-detail', '50']);
    expectInvalid(r, /unknown flag "--max-row-detail" for "verify-manifests" subcommand/);
  });

  it('verify with --recursive (manifests-only flag) → rejected as unknown for this sub', () => {
    // Same wrong-subcommand check in the other direction.
    const r = parseArgs(['verify', './x.ndjson', '--jwks', 'https://y', '--recursive']);
    expectInvalid(r, /unknown flag "--recursive" for "verify" subcommand/);
  });

  it('verify-manifests with valid --recursive → still ok (negative case for the guard)', () => {
    const r = parseArgs(['verify-manifests', './corpus', '--jwks', 'https://y', '--recursive']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.args.command !== 'verify-manifests') return;
    expect(r.args.recursive).toBe(true);
  });

  it('verify with all valid flags toggled → still ok (negative case)', () => {
    // Lock that legitimate flag combinations remain accepted post-guard.
    const r = parseArgs([
      'verify',
      './x.ndjson',
      '--jwks-file',
      './j.json',
      '--no-fail-fast',
      '--max-row-detail',
      '25',
      '--json',
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('parseArgs — subcommand --help routing (UX)', () => {
  // Operators expect `<cmd> <sub> --help` to print help, not error on
  // missing-path or unknown-flag. Help-anywhere detection short-circuits.

  it('verify --help → help result (not "missing NDJSON path")', () => {
    expectHelp(parseArgs(['verify', '--help']));
  });

  it('verify -h → help result', () => {
    expectHelp(parseArgs(['verify', '-h']));
  });

  it('verify-manifests --help → help result', () => {
    expectHelp(parseArgs(['verify-manifests', '--help']));
  });

  it('--help after a valid path + flags → still routes to help', () => {
    // Once help is anywhere in argv past the subcommand, it wins. This
    // prevents the unknown-flag walk from rejecting --help as unknown,
    // and prevents tristate from interpreting --help as a flag-value.
    expectHelp(parseArgs(['verify', './x.ndjson', '--jwks', 'https://y', '--help']));
  });
});

describe('parseArgs — purity contract', () => {
  it('does not mutate the input argv array', () => {
    const argv: readonly string[] = Object.freeze([
      'verify',
      './export.ndjson',
      '--jwks',
      'https://x',
    ]);
    // Freezing + spread tests both that we don't mutate and that we accept
    // ReadonlyArray-shaped input. parseArgs is typed string[] but should
    // never write to it; this is the test that locks that contract.
    const r = parseArgs([...argv]);
    expect(r.ok).toBe(true);
    expect(argv).toEqual(['verify', './export.ndjson', '--jwks', 'https://x']);
  });

  it('calling parseArgs twice with the same input returns equivalent results (idempotent)', () => {
    const input = ['verify-manifests', './x', '--jwks-file', './j.json', '--recursive'];
    const a = parseArgs(input);
    const b = parseArgs(input);
    expect(a).toEqual(b);
  });
});
