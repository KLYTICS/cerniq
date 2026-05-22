/**
 * Shared helpers for release-hygiene tooling.
 *
 * Both `generate-changelog.ts` and `publish-dry-run.ts` need to know:
 *  - which packages live in the workspace
 *  - which of those are publishable as `@okoro/*`
 *  - the path tokens that map an arbitrary text fragment to a package
 *
 * Keeping this in one place is what lets the changelog generator and the
 * publish gate stay in lockstep when a new SDK ships (e.g. `@okoro/cli`).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

export interface OkoroPackageManifest {
  /** Absolute path to the package directory. */
  readonly dir: string;
  /** Absolute path to the package.json file. */
  readonly manifestPath: string;
  /** Parsed package.json contents. */
  readonly raw: Record<string, unknown>;
  /** `name` from package.json. */
  readonly name: string;
  /** `version` from package.json. */
  readonly version: string;
  /** Whether `private: true` is set. */
  readonly private: boolean;
  /**
   * Path tokens (workspace-relative) that, if found inside a free-text
   * SESSION_HANDOFF entry, indicate the entry mutated this package. The
   * "primary" token is always the leading entry — it's also what we use
   * to build a fall-back per-package label when no other token matches.
   */
  readonly pathTokens: readonly string[];
}

export interface FindPackagesOptions {
  /**
   * Repo root. Defaults to walking up from `process.cwd()` until
   * `pnpm-workspace.yaml` is found.
   */
  readonly repoRoot?: string;
  /** Restrict to publishable `@okoro/*` only. Default: false. */
  readonly publishableOnly?: boolean;
}

/**
 * Walk up from `start` (default `process.cwd()`) until a directory with
 * `pnpm-workspace.yaml` is found, or root. Throws if not found.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let cur = path.resolve(start);
  // Defensive ceiling so we never spin if something is misconfigured.
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(
    `findRepoRoot: could not locate pnpm-workspace.yaml above ${start}`,
  );
}

/**
 * Enumerate every workspace package under `<repoRoot>/packages/*` plus
 * the API app — anything that might appear in release notes.
 *
 * Stable: results are sorted by `name` ascending so downstream output is
 * deterministic across machines and runs.
 */
export function findOkoroPackages(
  options: FindPackagesOptions = {},
): readonly OkoroPackageManifest[] {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const out: OkoroPackageManifest[] = [];

  const candidateRoots = [
    path.join(repoRoot, 'packages'),
    path.join(repoRoot, 'apps'),
    path.join(repoRoot, 'workers'),
  ];

  for (const root of candidateRoots) {
    if (!existsSync(root)) continue;
    const entries = readdirSync(root).sort();
    for (const entry of entries) {
      const dir = path.join(root, entry);
      let s;
      try {
        s = statSync(dir);
      } catch {
        continue;
      }
      if (!s.isDirectory()) continue;
      const manifestPath = path.join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
          string,
          unknown
        >;
      } catch (err) {
        throw new Error(
          `findOkoroPackages: failed to parse ${manifestPath}: ${(err as Error).message}`,
        );
      }
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!name) continue;
      const version = typeof raw.version === 'string' ? raw.version : '';
      const isPrivate = raw.private === true;

      // Workspace-relative path token, e.g. "packages/sdk-ts/".
      const rel = path.relative(repoRoot, dir).replace(/\\/g, '/') + '/';
      const tokens: string[] = [rel];

      // Some entries reference modules by name rather than path; add the
      // unscoped slug as a secondary token (e.g. "sdk-ts").
      tokens.push(entry);

      out.push({
        dir,
        manifestPath,
        raw,
        name,
        version,
        private: isPrivate,
        pathTokens: tokens,
      });
    }
  }

  // Stable sort by name.
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  if (options.publishableOnly) {
    return out.filter(
      (p) => !p.private && p.name.startsWith('@okoro/'),
    );
  }
  return out;
}

/**
 * SDK-package allowlist used by the changelog generator's default mode.
 * These are the packages that customers actually install. Adding a new
 * SDK? Update this list AND the publish-dry-run will pick it up
 * automatically via `findOkoroPackages({ publishableOnly: true })`.
 */
export const SDK_PACKAGE_NAMES: readonly string[] = [
  '@okoro/sdk',
  '@okoro/types',
  '@okoro/verifier-rp',
  // sdk-py lives in the workspace but isn't an npm package; it has its
  // own CHANGELOG written by the same generator under packages/sdk-py/.
  'okoro-py',
];

/**
 * Map an SDK alias used by `--package` to a real workspace name. Operators
 * shouldn't have to remember exact npm scopes when they want a single
 * package's changelog.
 */
export const PACKAGE_ALIASES: Readonly<Record<string, string>> = {
  'sdk-ts': '@okoro/sdk',
  '@okoro/sdk-ts': '@okoro/sdk',
  sdk: '@okoro/sdk',
  types: '@okoro/types',
  'verifier-rp': '@okoro/verifier-rp',
  'sdk-py': 'okoro-py',
  python: 'okoro-py',
};

/** Resolve a user-provided package alias to its canonical name. */
export function resolvePackageAlias(input: string): string {
  return PACKAGE_ALIASES[input] ?? input;
}

/**
 * For each provided package, scan `text` for any of its path tokens and
 * return the matched packages. Order preserves the input order so callers
 * can render packages in their canonical workspace order.
 */
export function packagesTouchedByText(
  packages: readonly OkoroPackageManifest[],
  text: string,
): readonly OkoroPackageManifest[] {
  const hit: OkoroPackageManifest[] = [];
  for (const pkg of packages) {
    for (const tok of pkg.pathTokens) {
      if (tok.length < 3) continue; // avoid 1-char false positives
      if (text.includes(tok)) {
        hit.push(pkg);
        break;
      }
    }
  }
  return hit;
}

/**
 * Special-case: the sdk-py package directory is `packages/sdk-py/` but
 * its publishable name is `okoro` on PyPI. We keep an internal canonical
 * name `okoro-py` so the same code path works for changelog buckets.
 */
export function pythonPackageManifest(
  packages: readonly OkoroPackageManifest[],
): OkoroPackageManifest | undefined {
  return packages.find((p) => p.dir.endsWith('/sdk-py'));
}

/** Semver regex matching `MAJOR.MINOR.PATCH` with optional pre-release/build. */
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isValidSemver(version: string): boolean {
  return SEMVER_RE.test(version);
}
