#!/usr/bin/env tsx
/**
 * publish-dry-run.ts — pre-flight gate for `npm publish`.
 *
 * Runs `npm pack --dry-run --json` for every public `@okoro/*` package
 * and asserts:
 *   - the tarball excludes test/dev/secret artefacts
 *   - the tarball includes README, LICENSE, and the entrypoints declared
 *     in package.json (`main` / `module` / `exports`)
 *   - package.json has the metadata npm/PyPI consumers expect
 *   - no `link:` / `file:` deps that would break for downstream consumers
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks fail
 *   2  setup error (missing npm, malformed package.json, etc.)
 *
 * No real publish happens. Tests stub the executor.
 */

import { execFile, ExecFileOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import {
  OkoroPackageManifest,
  findOkoroPackages,
  findRepoRoot,
  isValidSemver,
} from './lib/package-introspect.js';

const execFileAsync = promisify(execFile);

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type CheckLevel = 'pass' | 'warn' | 'fail';

export interface Check {
  readonly id: string;
  readonly level: CheckLevel;
  readonly message: string;
}

export interface PackageReport {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  readonly checks: readonly Check[];
  /** Files reported by `npm pack --dry-run`. */
  readonly tarballFiles: readonly string[];
}

export interface PublishDryRunResult {
  readonly reports: readonly PackageReport[];
  readonly summary: {
    readonly passed: number;
    readonly warned: number;
    readonly failed: number;
  };
}

export interface NpmPackEntry {
  readonly path: string;
  readonly size?: number;
}

export interface NpmPackOutput {
  readonly files: readonly NpmPackEntry[];
}

/** Adapter so tests can stub the npm pack invocation. */
export type PackRunner = (
  cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

export interface CliFlags {
  readonly packageFilter?: string;
  readonly all: boolean;
  readonly strict: boolean;
  readonly json: boolean;
  readonly repoRoot?: string;
}

// ──────────────────────────────────────────────────────────────────────
// CLI parsing
// ──────────────────────────────────────────────────────────────────────

const USAGE = `\
publish-dry-run — verify every public @okoro/* package is publish-clean.

Usage:
  pnpm publish:dry-run [--all] [--package <name>] [--strict] [--json]

Flags:
  --all              Run against every public @okoro/* package (default)
  --package <name>   Restrict to one package by name
  --strict           Treat warnings as failures
  --json             Emit machine-readable JSON to stdout
`;

export function parseFlags(argv: readonly string[]): CliFlags {
  const flags: {
    packageFilter?: string;
    all: boolean;
    strict: boolean;
    json: boolean;
    repoRoot?: string;
  } = { all: true, strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') {
      flags.packageFilter = argv[++i];
      flags.all = false;
    } else if (a === '--all') flags.all = true;
    else if (a === '--strict') flags.strict = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--repo-root') flags.repoRoot = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a !== undefined && a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  return flags;
}

// ──────────────────────────────────────────────────────────────────────
// Pack output parsing
// ──────────────────────────────────────────────────────────────────────

/**
 * Parse `npm pack --dry-run --json` output. npm 7+ emits a JSON array of
 * objects with a `files` field. If JSON parsing fails or produces no file
 * list, we fall back to scraping `Tarball Contents` lines from text.
 */
export function parseNpmPackOutput(stdout: string): NpmPackOutput {
  const trimmed = stdout.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const first = arr[0];
      if (
        first &&
        typeof first === 'object' &&
        'files' in (first as Record<string, unknown>)
      ) {
        const files = (first as { files: unknown }).files;
        if (Array.isArray(files)) {
          const out: NpmPackEntry[] = [];
          for (const f of files) {
            if (
              f &&
              typeof f === 'object' &&
              'path' in (f as Record<string, unknown>)
            ) {
              const obj = f as { path: unknown; size?: unknown };
              if (typeof obj.path === 'string') {
                out.push({
                  path: obj.path,
                  size:
                    typeof obj.size === 'number' ? obj.size : undefined,
                });
              }
            }
          }
          return { files: out };
        }
      }
    } catch {
      // fall through to text parsing
    }
  }
  // Text fallback: lines that look like file paths after a "Tarball Contents"
  // header. npm prefixes every output line with `npm notice ` — strip that
  // before parsing so we work whether or not the caller filtered it.
  const lines = stdout.split(/\r?\n/);
  const files: NpmPackEntry[] = [];
  let inTarball = false;
  for (const raw of lines) {
    const line = raw.replace(/^npm notice\s?/i, '').trim();
    if (/Tarball Contents/i.test(line)) {
      inTarball = true;
      continue;
    }
    if (!inTarball) continue;
    if (line === '' || /^Tarball Details/i.test(line)) {
      inTarball = false;
      continue;
    }
    // Match "<size><unit?> <path>", e.g. "123B README.md" or "4.5kB dist/x.cjs".
    const m = /^(?:[\d.]+\s*[kKMGTP]?i?B?)\s+(.+)$/.exec(line);
    if (m && m[1]) {
      files.push({ path: m[1].trim() });
    }
  }
  return { files };
}

// ──────────────────────────────────────────────────────────────────────
// Default pack runner
// ──────────────────────────────────────────────────────────────────────

export function defaultPackRunner(): PackRunner {
  return async (cwd: string) => {
    const opts: ExecFileOptions = {
      cwd,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    };
    const { stdout, stderr } = await execFileAsync(
      'npm',
      ['pack', '--dry-run', '--json'],
      opts,
    );
    return {
      stdout: typeof stdout === 'string' ? stdout : stdout.toString(),
      stderr: typeof stderr === 'string' ? stderr : stderr.toString(),
    };
  };
}

// ──────────────────────────────────────────────────────────────────────
// Forbidden / required patterns
// ──────────────────────────────────────────────────────────────────────

/**
 * Patterns that MUST NOT appear in the published tarball. Each pattern
 * is tested as a substring or extension match against the file path
 * inside the tarball (the `package/` prefix npm adds is stripped first).
 */
export const FORBIDDEN_PATTERNS: ReadonlyArray<{
  id: string;
  test: (p: string) => boolean;
  message: string;
}> = [
  {
    id: 'no-node-modules',
    test: (p) => p.startsWith('node_modules/') || p.includes('/node_modules/'),
    message: 'tarball must not contain node_modules/',
  },
  {
    id: 'no-env',
    test: (p) => /(^|\/)\.env(\.|$)/.test(p) || p.endsWith('/.env'),
    message: 'tarball must not contain .env files',
  },
  {
    id: 'no-test-files',
    test: (p) => /\.(spec|test)\.(t|j)sx?$/.test(p),
    message: 'tarball must not contain test files (*.spec.ts, *.test.ts, etc.)',
  },
  {
    id: 'no-coverage',
    test: (p) => p.startsWith('coverage/') || p.includes('/coverage/'),
    message: 'tarball must not contain coverage/',
  },
  {
    id: 'no-tsbuildinfo',
    test: (p) => p.endsWith('.tsbuildinfo'),
    message: 'tarball must not contain .tsbuildinfo files',
  },
];

/**
 * Strip leading `package/` that npm prepends to tarball paths.
 */
export function normalizeTarballPath(p: string): string {
  return p.replace(/^package\//, '');
}

// ──────────────────────────────────────────────────────────────────────
// Source-map check
// ──────────────────────────────────────────────────────────────────────

/**
 * Read every .map file in the package directory and look for absolute
 * filesystem paths that would leak the publisher's machine layout. We
 * tolerate `sources` entries that are workspace-relative (`../../packages/...`
 * is fine; `/Users/money/...` is not).
 */
export function findLeakedAbsolutePathsInMaps(
  pkgDir: string,
  files: readonly string[],
): readonly string[] {
  const leaks: string[] = [];
  const mapFiles = files.filter((f) => f.endsWith('.map'));
  for (const mapRel of mapFiles) {
    const full = path.join(pkgDir, mapRel);
    if (!existsSync(full)) continue;
    let raw: string;
    try {
      raw = readFileSync(full, 'utf-8');
    } catch {
      continue;
    }
    // Cheap scan: look for `/Users/`, `/home/`, or Windows-style `C:\`.
    if (/"\/Users\//.test(raw) || /"\/home\//.test(raw) || /"[A-Z]:\\\\/.test(raw)) {
      leaks.push(mapRel);
    }
  }
  return leaks;
}

// ──────────────────────────────────────────────────────────────────────
// Per-package check pipeline
// ──────────────────────────────────────────────────────────────────────

export interface CheckPackageDeps {
  readonly packRunner: PackRunner;
  readonly readFile?: (p: string) => string;
}

export async function checkPackage(
  pkg: OkoroPackageManifest,
  deps: CheckPackageDeps,
): Promise<PackageReport> {
  const checks: Check[] = [];
  let tarballFiles: string[] = [];

  // ───── manifest checks (synchronous, always run) ─────
  const m = pkg.raw;
  const required: ReadonlyArray<keyof typeof m> = [
    'name',
    'version',
    'description',
    'license',
  ];
  for (const k of required) {
    if (!m[k as string] || typeof m[k as string] !== 'string') {
      checks.push({
        id: `manifest.${String(k)}`,
        level: 'fail',
        message: `package.json is missing or has non-string "${String(k)}"`,
      });
    } else {
      checks.push({
        id: `manifest.${String(k)}`,
        level: 'pass',
        message: `${String(k)} = ${String(m[k as string])}`,
      });
    }
  }

  // semver
  if (typeof m.version === 'string' && isValidSemver(m.version)) {
    checks.push({
      id: 'manifest.semver',
      level: 'pass',
      message: `version ${m.version} is valid semver`,
    });
  } else {
    checks.push({
      id: 'manifest.semver',
      level: 'fail',
      message: `version "${String(m.version)}" is not a valid semver`,
    });
  }

  // repository.url
  const repo = m.repository;
  let repoUrl = '';
  if (typeof repo === 'string') repoUrl = repo;
  else if (repo && typeof repo === 'object' && 'url' in repo) {
    const r = (repo as { url?: unknown }).url;
    if (typeof r === 'string') repoUrl = r;
  }
  if (/okoro/i.test(repoUrl)) {
    checks.push({
      id: 'manifest.repository',
      level: 'pass',
      message: `repository.url = ${repoUrl}`,
    });
  } else {
    checks.push({
      id: 'manifest.repository',
      level: 'fail',
      message: `repository.url missing or doesn't reference an okoro repo (got: ${repoUrl || '<unset>'})`,
    });
  }

  // engines.node
  const engines = m.engines;
  if (
    engines &&
    typeof engines === 'object' &&
    typeof (engines as { node?: unknown }).node === 'string'
  ) {
    checks.push({
      id: 'manifest.engines',
      level: 'pass',
      message: `engines.node = ${(engines as { node: string }).node}`,
    });
  } else {
    checks.push({
      id: 'manifest.engines',
      level: 'fail',
      message: 'engines.node must be set',
    });
  }

  // keywords ≥ 3
  const kws = m.keywords;
  if (Array.isArray(kws) && kws.length >= 3) {
    checks.push({
      id: 'manifest.keywords',
      level: 'pass',
      message: `${kws.length} keywords`,
    });
  } else {
    checks.push({
      id: 'manifest.keywords',
      level: 'fail',
      message: `keywords must be an array of ≥3 entries (got ${
        Array.isArray(kws) ? kws.length : 'none'
      })`,
    });
  }

  // no link:/file: deps
  const depBuckets: ReadonlyArray<string> = [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ];
  const badDeps: string[] = [];
  for (const bucket of depBuckets) {
    const obj = m[bucket];
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v !== 'string') continue;
        if (v.startsWith('link:') || v.startsWith('file:')) {
          badDeps.push(`${bucket}.${k}=${v}`);
        }
      }
    }
  }
  if (badDeps.length === 0) {
    checks.push({
      id: 'manifest.deps-no-link-file',
      level: 'pass',
      message: 'no link:/file: deps',
    });
  } else {
    checks.push({
      id: 'manifest.deps-no-link-file',
      level: 'fail',
      message: `link:/file: deps will break on publish: ${badDeps.join(', ')}`,
    });
  }

  // workspace:* in dependencies (warn only — pnpm publish rewrites these)
  const workspaceDeps: string[] = [];
  for (const bucket of ['dependencies', 'peerDependencies'] as const) {
    const obj = m[bucket];
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'string' && v.startsWith('workspace:')) {
          workspaceDeps.push(`${bucket}.${k}`);
        }
      }
    }
  }
  if (workspaceDeps.length > 0) {
    checks.push({
      id: 'manifest.deps-workspace',
      level: 'warn',
      message:
        `workspace: protocol present in ${workspaceDeps.length} dep(s); ` +
        `pnpm publish rewrites these — confirm with --dry-run actual: ${workspaceDeps.join(', ')}`,
    });
  }

  // ───── npm pack ─────
  let packStdout = '';
  try {
    const r = await deps.packRunner(pkg.dir);
    packStdout = r.stdout;
  } catch (err) {
    checks.push({
      id: 'pack.run',
      level: 'fail',
      message: `npm pack failed: ${(err as Error).message}`,
    });
    return {
      name: pkg.name,
      version: typeof m.version === 'string' ? m.version : '',
      dir: pkg.dir,
      checks,
      tarballFiles: [],
    };
  }

  const parsed = parseNpmPackOutput(packStdout);
  tarballFiles = parsed.files.map((f) => normalizeTarballPath(f.path));

  if (tarballFiles.length === 0) {
    checks.push({
      id: 'pack.empty',
      level: 'fail',
      message: 'npm pack produced no file list (build output missing? run `pnpm -r build` first)',
    });
  } else {
    checks.push({
      id: 'pack.run',
      level: 'pass',
      message: `npm pack produced ${tarballFiles.length} files`,
    });
  }

  // forbidden
  for (const pat of FORBIDDEN_PATTERNS) {
    const hits = tarballFiles.filter(pat.test);
    if (hits.length === 0) {
      checks.push({
        id: `forbid.${pat.id}`,
        level: 'pass',
        message: pat.message + ' — clean',
      });
    } else {
      checks.push({
        id: `forbid.${pat.id}`,
        level: 'fail',
        message: `${pat.message} — found ${hits.length}: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? '...' : ''}`,
      });
    }
  }

  // required: README.md (must), LICENSE (must — flag as warn if missing
  // because some packages document the gap explicitly), package.json
  const lower = tarballFiles.map((f) => f.toLowerCase());
  const hasReadme = lower.some((f) => f === 'readme.md');
  const hasLicense = lower.some((f) => f === 'license' || f === 'license.md');
  const hasManifest = lower.includes('package.json');
  checks.push({
    id: 'require.readme',
    level: hasReadme ? 'pass' : 'fail',
    message: hasReadme ? 'README.md present' : 'README.md missing from tarball',
  });
  checks.push({
    id: 'require.license',
    level: hasLicense ? 'pass' : 'warn',
    message: hasLicense
      ? 'LICENSE present'
      : 'LICENSE missing from tarball (document gap if intentional)',
  });
  checks.push({
    id: 'require.manifest',
    level: hasManifest ? 'pass' : 'fail',
    message: hasManifest
      ? 'package.json present'
      : 'package.json missing from tarball',
  });

  // entrypoint files (main, module, types, exports.*)
  const entryRefs = collectEntrypointPaths(m);
  for (const ref of entryRefs) {
    const norm = ref.replace(/^\.\//, '');
    const inTar = tarballFiles.includes(norm);
    checks.push({
      id: `require.entry.${norm}`,
      level: inTar ? 'pass' : 'fail',
      message: inTar
        ? `entrypoint ${norm} present`
        : `entrypoint ${norm} declared in package.json but missing from tarball`,
    });
  }

  // source-map leak scan
  const leaks = findLeakedAbsolutePathsInMaps(pkg.dir, tarballFiles);
  if (leaks.length === 0) {
    checks.push({
      id: 'maps.no-absolute-paths',
      level: 'pass',
      message: 'no source maps leak absolute filesystem paths',
    });
  } else {
    checks.push({
      id: 'maps.no-absolute-paths',
      level: 'warn',
      message: `${leaks.length} source map(s) contain absolute paths: ${leaks.slice(0, 3).join(', ')}`,
    });
  }

  return {
    name: pkg.name,
    version: typeof m.version === 'string' ? m.version : '',
    dir: pkg.dir,
    checks,
    tarballFiles,
  };
}

/**
 * Pull every string-valued path out of `main`, `module`, `types`,
 * `bin`, and `exports`. We ignore conditional/sub-paths that don't
 * resolve to a literal string (e.g. nested condition objects are walked
 * recursively).
 */
export function collectEntrypointPaths(
  manifest: Readonly<Record<string, unknown>>,
): readonly string[] {
  const out = new Set<string>();
  const flat = ['main', 'module', 'types'] as const;
  for (const k of flat) {
    const v = manifest[k];
    if (typeof v === 'string') out.add(v);
  }
  const bin = manifest.bin;
  if (typeof bin === 'string') out.add(bin);
  else if (bin && typeof bin === 'object') {
    for (const v of Object.values(bin as Record<string, unknown>)) {
      if (typeof v === 'string') out.add(v);
    }
  }
  const exp = manifest.exports;
  walkExports(exp, out);
  return Array.from(out).sort();
}

function walkExports(node: unknown, out: Set<string>): void {
  if (typeof node === 'string') {
    out.add(node);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      walkExports(v, out);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Aggregation & reporting
// ──────────────────────────────────────────────────────────────────────

export function summarize(
  reports: readonly PackageReport[],
  strict: boolean,
): { passed: number; warned: number; failed: number; exitCode: 0 | 1 } {
  let passed = 0;
  let warned = 0;
  let failed = 0;
  for (const r of reports) {
    for (const c of r.checks) {
      if (c.level === 'pass') passed++;
      else if (c.level === 'warn') warned++;
      else failed++;
    }
  }
  const exitCode: 0 | 1 = failed > 0 || (strict && warned > 0) ? 1 : 0;
  return { passed, warned, failed, exitCode };
}

export function renderHumanReport(
  reports: readonly PackageReport[],
  totals: { passed: number; warned: number; failed: number },
): string {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push('');
    lines.push(`■ ${r.name}@${r.version}  (${r.dir})`);
    for (const c of r.checks) {
      const icon = c.level === 'pass' ? '✓' : c.level === 'warn' ? '!' : '✗';
      lines.push(`  ${icon} [${c.id}] ${c.message}`);
    }
  }
  lines.push('');
  lines.push(
    `summary: ${totals.passed} pass · ${totals.warned} warn · ${totals.failed} fail`,
  );
  return lines.join('\n') + '\n';
}

// ──────────────────────────────────────────────────────────────────────
// Main runner
// ──────────────────────────────────────────────────────────────────────

export interface RunDeps {
  readonly packRunner: PackRunner;
  readonly log: (s: string) => void;
}

export async function run(
  flags: CliFlags,
  depsIn: Partial<RunDeps> = {},
): Promise<{ result: PublishDryRunResult; exitCode: 0 | 1 | 2 }> {
  let repoRoot: string;
  try {
    repoRoot = flags.repoRoot ?? findRepoRoot();
  } catch (err) {
    return {
      result: {
        reports: [],
        summary: { passed: 0, warned: 0, failed: 0 },
      },
      exitCode: 2,
    };
  }

  const deps: RunDeps = {
    packRunner: depsIn.packRunner ?? defaultPackRunner(),
    log: depsIn.log ?? ((s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`)),
  };

  let packages = findOkoroPackages({ repoRoot, publishableOnly: true });
  if (flags.packageFilter) {
    packages = packages.filter((p) => p.name === flags.packageFilter);
    if (packages.length === 0) {
      deps.log(`no public package matches --package=${flags.packageFilter}`);
      return {
        result: {
          reports: [],
          summary: { passed: 0, warned: 0, failed: 0 },
        },
        exitCode: 2,
      };
    }
  }

  const reports: PackageReport[] = [];
  for (const pkg of packages) {
    const report = await checkPackage(pkg, { packRunner: deps.packRunner });
    reports.push(report);
  }

  const totals = summarize(reports, flags.strict);

  if (flags.json) {
    deps.log(
      JSON.stringify(
        {
          reports,
          summary: {
            passed: totals.passed,
            warned: totals.warned,
            failed: totals.failed,
          },
          exitCode: totals.exitCode,
        },
        null,
        2,
      ),
    );
  } else {
    deps.log(renderHumanReport(reports, totals));
  }

  return {
    result: {
      reports,
      summary: {
        passed: totals.passed,
        warned: totals.warned,
        failed: totals.failed,
      },
    },
    exitCode: totals.exitCode,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Entrypoint
// ──────────────────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return argv1.endsWith('publish-dry-run.ts') ||
      argv1.endsWith('publish-dry-run.js');
  } catch {
    return false;
  }
})();

if (isMain) {
  (async (): Promise<void> => {
    try {
      const flags = parseFlags(process.argv.slice(2));
      const { exitCode } = await run(flags);
      process.exit(exitCode);
    } catch (err) {
      process.stderr.write(`publish-dry-run: ${(err as Error).message}\n`);
      process.exit(2);
    }
  })();
}
