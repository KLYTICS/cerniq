// CLI entry point for `@okoro/audit-evidence-bundle`.
//
// Usage:
//   OKORO_API_BASE=https://... OKORO_API_KEY=... \
//     pnpm --filter @okoro/audit-evidence-bundle start \
//       --principal-id <id> \
//       --from 2026-01-01 \
//       --to 2026-04-30 \
//       --output ./okoro-evidence-2026Q1.tar.gz
//
// Exit codes:
//   0  — bundle written, chain valid (or `--verify-only=skip` mode)
//   2  — bundle written, chain BROKEN (auditors must triage as SEV-1)
//   1  — fetch / I/O failure; partial bundle NOT written
//
// We deliberately exit 2 (not 1) on chain failure so CI pipelines can
// distinguish "tool crashed" from "tool succeeded but the evidence shows
// a tamper event".

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  fetchAllArtifacts,
  createWorkDir,
  type FetchAdapter,
} from './fetch-artifacts.js';
import {
  planBundleEntries,
  writeBundle,
} from './build-bundle.js';
import { runChainVerification, buildSkippedVerdict } from './verify-chain.js';
import type { BundleCliOptions, ChainVerificationFileShape } from './types.js';

const HELP = `okoro-audit-evidence-bundle

Build a SOC2-ready evidence tarball for an external auditor.

REQUIRED:
  --principal-id <id>     Tenant principal whose audit chain to bundle.
  --from <ISO date>       Inclusive start of the export window (e.g. 2026-01-01).
  --to   <ISO date>       Inclusive end   of the export window.
  --output <path>         Where to write the .tar.gz (parent dirs auto-created).

OPTIONAL:
  --agent-id <id>         Limit export to a single agent. Without this we
                          query /v1/agents/<principalId>/audit/export.ndjson
                          (gateway routes a principal-wide export there).
  --api-base <url>        Defaults to $OKORO_API_BASE.
  --api-key  <key>        Defaults to $OKORO_API_KEY.
  --verify-only           Skip chain verification (just bundle). Exit 0 always.
  --no-readme             Omit the auditor README.md from the bundle.
  --help                  Print this message.

The bundle is reproducible: rerunning with the same inputs and the same
audit chain produces SHA256SUMS that diff cleanly.
`;

interface ParsedFlags {
  showHelp: boolean;
  cli: Partial<BundleCliOptions>;
}

export function parseArgs(argv: readonly string[]): ParsedFlags {
  const cli: Partial<BundleCliOptions> = {
    verifyOnly: false,
    includeReadme: true,
  };
  let showHelp = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        showHelp = true;
        break;
      case '--principal-id':
        cli.principalId = argv[++i];
        break;
      case '--agent-id':
        cli.agentId = argv[++i];
        break;
      case '--from':
        cli.from = argv[++i];
        break;
      case '--to':
        cli.to = argv[++i];
        break;
      case '--output':
        cli.output = argv[++i];
        break;
      case '--api-base':
        cli.apiBase = argv[++i];
        break;
      case '--api-key':
        cli.apiKey = argv[++i];
        break;
      case '--verify-only':
        cli.verifyOnly = true;
        break;
      case '--no-readme':
        cli.includeReadme = false;
        break;
      case '--include-readme':
        cli.includeReadme = true;
        break;
      default:
        if (a !== undefined && a.startsWith('--')) {
          throw new Error(`unknown flag: ${a}`);
        }
    }
  }
  return { showHelp, cli };
}

export function resolveCliOptions(parsed: Partial<BundleCliOptions>): BundleCliOptions {
  const apiBase = parsed.apiBase ?? process.env['OKORO_API_BASE'];
  const apiKey = parsed.apiKey ?? process.env['OKORO_API_KEY'];

  const missing: string[] = [];
  if (!parsed.principalId) missing.push('--principal-id');
  if (!parsed.from) missing.push('--from');
  if (!parsed.to) missing.push('--to');
  if (!parsed.output) missing.push('--output');
  if (!apiBase) missing.push('--api-base / OKORO_API_BASE');
  if (!apiKey) missing.push('--api-key / OKORO_API_KEY');
  if (missing.length > 0) {
    throw new Error(`missing required arguments: ${missing.join(', ')}`);
  }

  return {
    principalId: parsed.principalId!,
    agentId: parsed.agentId,
    from: parsed.from!,
    to: parsed.to!,
    output: parsed.output!,
    apiBase: apiBase!,
    apiKey: apiKey!,
    verifyOnly: parsed.verifyOnly ?? false,
    includeReadme: parsed.includeReadme ?? true,
  };
}

const AUDITOR_README = `# OKORO Audit Evidence Bundle

This directory is the cryptographic-quality evidence package for an OKORO
audit chain. It is designed for external auditors (SOC2, ISO 27001, FINRA,
internal customer security review) and contains everything needed to
**independently verify** the integrity of an OKORO deployment's audit log
**without contacting OKORO**.

## What's in here

| File                          | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| \`audit-events.ndjson\`         | One signed audit event per line, in chain order.              |
| \`jwks.json\`                   | Public Ed25519 signing keys (JWKS format) — no private keys.  |
| \`okoro-configuration.json\`    | The deployment's well-known discovery doc.                    |
| \`retention-policy.json\`       | Retention windows (omitted if not yet published).             |
| \`security.txt\`                | RFC 9116 contact for vulnerability reports.                   |
| \`manifest.json\`               | Counts, time range, principal, generation timestamp, verdict. |
| \`chain-verification.json\`     | Pre-computed verdict from \`@okoro/audit-verifier\`.            |
| \`SHA256SUMS\`                  | One line per file: \`<sha256>  <filename>\`.                    |

## How to re-verify offline

You should not trust the pre-computed verdict in \`chain-verification.json\`
without re-running it yourself. That's the whole point of this package.

\`\`\`sh
# 1. Verify the bundle wasn't tampered with on its way to you.
sha256sum -c SHA256SUMS

# 2. Re-run the chain verifier against the raw NDJSON + JWKS.
npx @okoro/audit-verifier ./audit-events.ndjson --jwks ./jwks.json
\`\`\`

The verifier prints \`OK\` and exits 0 when every row's signature and
hash-chain link is valid. **Any other outcome is a SEV-1 finding.**

## What to do if verification fails

The OKORO audit chain is built to be tamper-evident: each row signs over
the previous row's signature, so any change to any historical event
invalidates every downstream signature. **A failed verification means one
of three things:**

1. **The bundle was corrupted in transit** — re-fetch it before reaching
   conclusions. \`sha256sum -c SHA256SUMS\` will catch this.
2. **The audit log was tampered with at rest** — escalate immediately to
   the deployment operator and OKORO Labs (\`security@okorolabs.io\`).
   This is a P0 security incident.
3. **The signing key was rotated mid-chain without a rotation event being
   recorded** — check \`signingKeys\` and \`rotationEvents\` in
   \`chain-verification.json\`. Lawful rotations record themselves; a kid
   change with no rotation event is suspicious.

## Why \`chain-verification.json\` is included

External auditors are expensive. The pre-computed verdict saves them ~30
minutes of "install Node, install the verifier, run a stream walk" work
on every audit. The file is **not** a substitute for re-running the
verifier — it's a sanity check the auditor can compare against their own
result. If the two disagree, treat as a SEV-1.

## Limitations and gaps

- The export endpoint is per-agent. When invoked with only \`--principal-id\`
  the CLI assumes the deployment routes \`/v1/agents/<principalId>/audit/...\`
  to "all agents owned by this principal"; some deployments restrict that
  to a single agent. Pass \`--agent-id\` explicitly if you see fewer rows
  than expected.
- \`retention-policy.json\` is best-effort: OKORO deployments that have not
  yet shipped \`/.well-known/retention-policy.json\` will produce a bundle
  with \`retention_policy_included: false\` in the manifest.

## Bundle reproducibility

Re-running the bundler with identical inputs against an identical audit
chain produces a byte-identical \`SHA256SUMS\` file (the tar mtime and the
manifest \`generated_at\` differ, but the per-file hashes do not). That's
the auditor's reproducibility check.
`;

export async function run(
  argv: readonly string[],
  options: { adapter?: FetchAdapter } = {},
): Promise<{ exitCode: number; verification: ChainVerificationFileShape }> {
  const parsed = parseArgs(argv);
  if (parsed.showHelp) {
    process.stdout.write(HELP);
    return { exitCode: 0, verification: buildSkippedVerdict() };
  }
  const cli = resolveCliOptions(parsed.cli);

  // Fetch first — large I/O, fail fast.
  const workDir = await createWorkDir();
  const fetched = await fetchAllArtifacts(cli, options.adapter, workDir);

  // Verify (or skip per --verify-only).
  let verification: ChainVerificationFileShape;
  if (cli.verifyOnly) {
    verification = buildSkippedVerdict();
  } else {
    verification = await runChainVerification({
      ndjsonPath: fetched.ndjsonPath,
      jwks: fetched.jwks,
    });
  }

  // Plan + write bundle.
  const bundleRoot = deriveBundleRoot(cli.output);
  const { entries } = await planBundleEntries({
    bundleRoot,
    fetched,
    verification,
    cli,
    readme: cli.includeReadme ? AUDITOR_README : null,
  });
  const outputAbs = resolve(cli.output);
  await mkdir(dirname(outputAbs), { recursive: true });
  await writeBundle({ outputPath: outputAbs, bundleRoot, entries });

  // Cleanup the temp work dir — we already streamed NDJSON into the tarball.
  await rm(workDir, { recursive: true, force: true });

  // Emit a one-line summary on stderr so CI logs see something.
  process.stderr.write(
    `okoro-audit-evidence-bundle: wrote ${outputAbs} ` +
      `(rows=${fetched.ndjsonRowCount}, redacted=${fetched.redactedRowCount}, ` +
      `verification=${verification.status})\n`,
  );

  const exitCode = verification.status === 'fail' ? 2 : 0;
  return { exitCode, verification };
}

/** Derive the in-tar directory name from the output path. e.g.
 *  `./okoro-evidence-2026Q1.tar.gz` → `okoro-evidence-2026Q1`. */
export function deriveBundleRoot(outputPath: string): string {
  const base = outputPath.split(/[/\\]/).pop() ?? 'okoro-evidence';
  return base.replace(/\.tar\.gz$|\.tgz$/i, '') || 'okoro-evidence';
}

// Direct invocation guard — only run when executed as a script, not when
// imported by tests.
const isMain = (() => {
  if (typeof process === 'undefined') return false;
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return arg1.endsWith('index.ts') || arg1.endsWith('index.js') || arg1.endsWith('index.mjs');
})();

if (isMain) {
  run(process.argv.slice(2)).then(
    (r) => {
      process.exit(r.exitCode);
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`okoro-audit-evidence-bundle: ${msg}\n`);
      process.exit(1);
    },
  );
}

// Suppress unused warning for the writeFile import that node:fs/promises
// strict-mode bundlers occasionally complain about — we use it transitively.
void writeFile;
