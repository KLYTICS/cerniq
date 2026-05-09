#!/usr/bin/env tsx
/**
 * generate-changelog.ts — assemble per-package CHANGELOG.md entries from
 * the canonical session log (`docs/SESSION_HANDOFF.md`).
 *
 * Why this exists
 * ───────────────
 * Releases are not commits. AEGIS sessions land work in batches, and the
 * canonical record of "what shipped" is `docs/SESSION_HANDOFF.md`. This
 * script lifts that prose into Keep-A-Changelog-formatted CHANGELOG.md
 * files inside each publishable package, bucketed by which package the
 * entry actually touched (path-token scan).
 *
 * Determinism
 * ───────────
 * Same SESSION_HANDOFF + same git state ⇒ identical output. We sort
 * sections by date desc, then by header text asc, and write entries in
 * the same order they appear in the source.
 *
 * Fallback to git
 * ───────────────
 * If SESSION_HANDOFF parsing yields zero matching entries for a package,
 * we fall back to `git log --since=<date> --pretty=...` and bucket commit
 * subjects by paths the commit touched.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  AegisPackageManifest,
  findAegisPackages,
  findRepoRoot,
  packagesTouchedByText,
  pythonPackageManifest,
  resolvePackageAlias,
  SDK_PACKAGE_NAMES,
} from './lib/package-introspect.js';

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

export interface CliFlags {
  readonly since?: string; // YYYY-MM-DD
  readonly packageFilter?: string; // alias or canonical name
  readonly dryRun: boolean;
  readonly out?: string; // override target path
  readonly handoffPath?: string; // override input
  readonly repoRoot?: string;
}

export interface SessionEntry {
  /** ISO date YYYY-MM-DD parsed from the heading. */
  readonly date: string;
  /** The full heading line, minus the leading `## `. */
  readonly heading: string;
  /** Concatenated body text (used for path-token matching). */
  readonly body: string;
  /** Bullet lines parsed out of the body, ready for Keep-A-Changelog. */
  readonly bullets: readonly string[];
}

export interface PackageBucket {
  readonly pkg: AegisPackageManifest;
  readonly entries: readonly SessionEntry[];
}

// ──────────────────────────────────────────────────────────────────────
// CLI parsing (no external deps)
// ──────────────────────────────────────────────────────────────────────

export function parseFlags(argv: readonly string[]): CliFlags {
  const flags: {
    since?: string;
    packageFilter?: string;
    dryRun: boolean;
    out?: string;
    handoffPath?: string;
    repoRoot?: string;
  } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') flags.since = argv[++i];
    else if (a === '--package') flags.packageFilter = argv[++i];
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--out') flags.out = argv[++i];
    else if (a === '--handoff') flags.handoffPath = argv[++i];
    else if (a === '--repo-root') flags.repoRoot = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a !== undefined && a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (flags.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(flags.since)) {
    throw new Error(`--since must be YYYY-MM-DD, got: ${flags.since}`);
  }
  return flags;
}

const USAGE = `\
generate-changelog — bucket SESSION_HANDOFF entries into per-package CHANGELOG files.

Usage:
  pnpm gen:changelog [--since YYYY-MM-DD] [--package <name>] [--dry-run] [--out <path>]

Flags:
  --since <date>     Only include entries dated on or after this date
  --package <name>   Only generate for one package (alias OK: sdk-ts, types, verifier-rp, sdk-py)
  --dry-run          Print proposed diff to stdout, don't write files
  --out <path>       Override output path (only valid with --package)
  --handoff <path>   Override SESSION_HANDOFF.md path (testing)
  --repo-root <path> Override repo root detection (testing)
`;

// ──────────────────────────────────────────────────────────────────────
// SESSION_HANDOFF parsing
// ──────────────────────────────────────────────────────────────────────

const SESSION_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\b\s*(.*)$/;

/**
 * Parse SESSION_HANDOFF.md into entries. Each `## YYYY-MM-DD ...` heading
 * starts a new entry; the body runs until the next `## ` heading. Bullets
 * (lines starting with `-`, `*`, or numbered) are extracted verbatim.
 */
export function parseSessionHandoff(text: string): readonly SessionEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: SessionEntry[] = [];
  let cur: {
    date: string;
    heading: string;
    bodyLines: string[];
    bullets: string[];
  } | null = null;

  const flush = (): void => {
    if (cur) {
      entries.push({
        date: cur.date,
        heading: cur.heading,
        body: cur.bodyLines.join('\n'),
        bullets: cur.bullets.slice(),
      });
    }
  };

  for (const line of lines) {
    const m = SESSION_HEADING_RE.exec(line);
    if (m) {
      flush();
      cur = {
        date: m[1] ?? '',
        heading: (m[2] ?? '').trim() || (m[1] ?? ''),
        bodyLines: [],
        bullets: [],
      };
      continue;
    }
    if (!cur) continue;
    cur.bodyLines.push(line);
    // Capture bullet content (strip leading `-`, `*`, or `1.` markers).
    const bm = /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line);
    if (bm && bm[1]) {
      cur.bullets.push(bm[1]);
    }
  }
  flush();
  return entries;
}

/**
 * Filter entries to those on or after `since`. If `since` is undefined,
 * returns input unchanged.
 */
export function filterEntriesSince(
  entries: readonly SessionEntry[],
  since: string | undefined,
): readonly SessionEntry[] {
  if (!since) return entries;
  return entries.filter((e) => e.date >= since);
}

// ──────────────────────────────────────────────────────────────────────
// Bucketing
// ──────────────────────────────────────────────────────────────────────

export function bucketEntriesByPackage(
  entries: readonly SessionEntry[],
  packages: readonly AegisPackageManifest[],
): readonly PackageBucket[] {
  // Map name → entries (preserve order).
  const byName = new Map<string, SessionEntry[]>();
  for (const pkg of packages) byName.set(pkg.name, []);

  for (const entry of entries) {
    const haystack = `${entry.heading}\n${entry.body}`;
    const touched = packagesTouchedByText(packages, haystack);
    for (const pkg of touched) {
      const arr = byName.get(pkg.name);
      if (arr) arr.push(entry);
    }
  }

  return packages
    .map((pkg) => ({ pkg, entries: byName.get(pkg.name) ?? [] }))
    .filter((b) => b.entries.length > 0);
}

// ──────────────────────────────────────────────────────────────────────
// Git fallback
// ──────────────────────────────────────────────────────────────────────

export interface GitCommit {
  readonly hash: string;
  readonly date: string; // YYYY-MM-DD
  readonly subject: string;
  readonly files: readonly string[];
}

export type GitRunner = (args: readonly string[]) => string;

export function defaultGitRunner(repoRoot: string): GitRunner {
  return (args) =>
    execFileSync('git', args.slice(), {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/**
 * Read commits since `since` (or all of HEAD's history if undefined). We
 * use a `--name-only` listing so we can map each commit to packages.
 */
export function readGitCommits(
  runner: GitRunner,
  since: string | undefined,
): readonly GitCommit[] {
  const args = [
    'log',
    '--no-merges',
    '--date=short',
    "--pretty=format:%H%x09%cd%x09%s",
    '--name-only',
  ];
  if (since) args.push(`--since=${since}`);
  let out: string;
  try {
    out = runner(args);
  } catch {
    return [];
  }
  const commits: GitCommit[] = [];
  const blocks = out.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const headerParts = (lines[0] ?? '').split('\t');
    if (headerParts.length < 3) continue;
    const hash = headerParts[0] ?? '';
    const date = headerParts[1] ?? '';
    const subject = headerParts.slice(2).join('\t');
    const files = lines.slice(1);
    commits.push({ hash, date, subject, files });
  }
  return commits;
}

export function bucketCommitsByPackage(
  commits: readonly GitCommit[],
  packages: readonly AegisPackageManifest[],
): readonly PackageBucket[] {
  const byName = new Map<string, SessionEntry[]>();
  for (const pkg of packages) byName.set(pkg.name, []);

  for (const c of commits) {
    const text = c.files.join('\n');
    const touched = packagesTouchedByText(packages, text);
    for (const pkg of touched) {
      const arr = byName.get(pkg.name);
      if (!arr) continue;
      arr.push({
        date: c.date,
        heading: `${c.date} · ${c.hash.slice(0, 8)}`,
        body: c.subject,
        bullets: [c.subject],
      });
    }
  }
  return packages
    .map((pkg) => ({ pkg, entries: byName.get(pkg.name) ?? [] }))
    .filter((b) => b.entries.length > 0);
}

// ──────────────────────────────────────────────────────────────────────
// Render
// ──────────────────────────────────────────────────────────────────────

/**
 * Render Keep-A-Changelog markdown for a single package bucket. Output
 * is deterministic: `## [unreleased]` on top, then dated sections in
 * date-desc order, with bullets preserved in source order.
 */
export function renderChangelog(bucket: PackageBucket): string {
  const lines: string[] = [];
  lines.push('# Changelog');
  lines.push('');
  lines.push(
    'All notable changes to this package are documented here. The format follows',
  );
  lines.push(
    '[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package adheres to',
  );
  lines.push('[Semantic Versioning](https://semver.org/).');
  lines.push('');
  lines.push('## [unreleased]');
  lines.push('');

  // Group by date, preserving date-desc order.
  const byDate = new Map<string, SessionEntry[]>();
  for (const e of bucket.entries) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }
  const dates = Array.from(byDate.keys()).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );

  for (const date of dates) {
    const dateEntries = byDate.get(date) ?? [];
    // Stable sub-order: by heading asc.
    const sorted = dateEntries
      .slice()
      .sort((a, b) =>
        a.heading < b.heading ? -1 : a.heading > b.heading ? 1 : 0,
      );
    lines.push(`### ${date}`);
    lines.push('');
    for (const entry of sorted) {
      lines.push(`- **${entry.heading}**`);
      const bullets = entry.bullets.length > 0 ? entry.bullets : [entry.body.split('\n')[0] ?? ''];
      for (const b of bullets) {
        if (!b.trim()) continue;
        lines.push(`  - ${b}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ──────────────────────────────────────────────────────────────────────
// Diff helper for --dry-run
// ──────────────────────────────────────────────────────────────────────

export function makeDiffPreview(
  filePath: string,
  proposed: string,
  existing: string | null,
): string {
  if (existing === null) {
    return `--- ${filePath} (new file, ${proposed.split('\n').length} lines)\n${proposed}`;
  }
  if (existing === proposed) {
    return `=== ${filePath} (no change)\n`;
  }
  return `--- ${filePath} (would update, was ${existing.length}b → ${proposed.length}b)\n${proposed}`;
}

// ──────────────────────────────────────────────────────────────────────
// Main runner (testable shape)
// ──────────────────────────────────────────────────────────────────────

export interface RunDeps {
  readFile: (p: string) => string | null;
  writeFile: (p: string, content: string) => void;
  gitRunner: GitRunner;
  log: (s: string) => void;
}

export function defaultRunDeps(repoRoot: string): RunDeps {
  return {
    readFile: (p) => (existsSync(p) ? readFileSync(p, 'utf-8') : null),
    writeFile: (p, c) => writeFileSync(p, c, 'utf-8'),
    gitRunner: defaultGitRunner(repoRoot),
    log: (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`),
  };
}

export interface RunResult {
  readonly buckets: readonly PackageBucket[];
  readonly written: readonly { path: string; bytes: number; created: boolean }[];
  readonly usedFallback: boolean;
}

export function run(flags: CliFlags, depsIn?: Partial<RunDeps>): RunResult {
  const repoRoot = flags.repoRoot ?? findRepoRoot();
  const deps: RunDeps = { ...defaultRunDeps(repoRoot), ...depsIn };

  // 1. Discover packages — only the ones we actually publish.
  const allPackages = findAegisPackages({ repoRoot });
  const sdkAllowlist = new Set(SDK_PACKAGE_NAMES);
  let packages = allPackages.filter((p) => sdkAllowlist.has(p.name));
  // Always include sdk-py (its npm name is `aegis-py` synthetic).
  const py = pythonPackageManifest(allPackages);
  if (py && !packages.includes(py)) packages = [...packages, py];

  if (flags.packageFilter) {
    const target = resolvePackageAlias(flags.packageFilter);
    const candidates = packages.filter(
      (p) =>
        p.name === target ||
        p.dir.endsWith(`/${flags.packageFilter}`) ||
        (target === 'aegis-py' && p.dir.endsWith('/sdk-py')),
    );
    if (candidates.length === 0) {
      throw new Error(
        `--package: no SDK package matches "${flags.packageFilter}". ` +
          `Known: ${packages.map((p) => p.name).join(', ')}`,
      );
    }
    packages = candidates;
  }

  // 2. Parse SESSION_HANDOFF.md.
  const handoffPath =
    flags.handoffPath ?? path.join(repoRoot, 'docs', 'SESSION_HANDOFF.md');
  const handoffText = deps.readFile(handoffPath) ?? '';
  const allEntries = parseSessionHandoff(handoffText);
  const filtered = filterEntriesSince(allEntries, flags.since);

  // 3. Bucket. If empty, fall back to git.
  let buckets = bucketEntriesByPackage(filtered, packages);
  let usedFallback = false;
  if (buckets.length === 0) {
    const commits = readGitCommits(deps.gitRunner, flags.since);
    buckets = bucketCommitsByPackage(commits, packages);
    usedFallback = true;
  }

  // 4. Write or preview.
  const written: { path: string; bytes: number; created: boolean }[] = [];
  for (const bucket of buckets) {
    const content = renderChangelog(bucket);
    const targetPath =
      flags.out ?? path.join(bucket.pkg.dir, 'CHANGELOG.md');
    const existing = deps.readFile(targetPath);
    if (flags.dryRun) {
      deps.log(makeDiffPreview(targetPath, content, existing));
    } else {
      deps.writeFile(targetPath, content);
      written.push({
        path: targetPath,
        bytes: content.length,
        created: existing === null,
      });
      deps.log(
        `wrote ${path.relative(repoRoot, targetPath)} (${content.length}b, ${
          existing === null ? 'new' : 'updated'
        }, ${bucket.entries.length} entries)`,
      );
    }
  }

  if (buckets.length === 0) {
    deps.log(
      `no changelog entries found${flags.since ? ` since ${flags.since}` : ''}`,
    );
  }

  return { buckets, written, usedFallback };
}

// ──────────────────────────────────────────────────────────────────────
// Entrypoint
// ──────────────────────────────────────────────────────────────────────

const isMain = (() => {
  // Robust ESM main detection without import.meta.url string parsing.
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return argv1.endsWith('generate-changelog.ts') ||
      argv1.endsWith('generate-changelog.js');
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    const flags = parseFlags(process.argv.slice(2));
    run(flags);
  } catch (err) {
    process.stderr.write(`generate-changelog: ${(err as Error).message}\n`);
    process.exit(2);
  }
}
