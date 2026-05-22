import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  parseFlags,
  parseNpmPackOutput,
  normalizeTarballPath,
  collectEntrypointPaths,
  checkPackage,
  summarize,
  renderHumanReport,
  findLeakedAbsolutePathsInMaps,
  FORBIDDEN_PATTERNS,
  run,
  type PackRunner,
  type PackageReport,
} from './publish-dry-run.js';
import {
  findOkoroPackages,
  type OkoroPackageManifest,
} from './lib/package-introspect.js';

// ──────────────────────────────────────────────────────────────────────
// Fake repo helper
// ──────────────────────────────────────────────────────────────────────

interface FakeRepo {
  root: string;
  pkgDir: (name: string) => string;
}

function makeFakeRepo(): FakeRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'okoro-pubdry-'));
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  mkdirSync(path.join(root, 'packages'), { recursive: true });
  return { root, pkgDir: (n) => path.join(root, 'packages', n) };
}

function writePkg(
  repo: FakeRepo,
  folder: string,
  manifest: Record<string, unknown>,
): OkoroPackageManifest {
  const dir = repo.pkgDir(folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  // Touch dist files referenced by entrypoints so source-map check is happy.
  return findOkoroPackages({ repoRoot: repo.root }).find((p) => p.dir === dir)!;
}

const goodManifest = (overrides: Record<string, unknown> = {}) => ({
  name: '@okoro/sdk',
  version: '1.2.3',
  description: 'OKORO SDK',
  license: 'MIT',
  main: 'dist/index.cjs',
  module: 'dist/index.mjs',
  types: 'dist/index.d.ts',
  exports: {
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.mjs',
      require: './dist/index.cjs',
    },
  },
  repository: { type: 'git', url: 'https://github.com/x/okoro.git' },
  engines: { node: '>=18' },
  keywords: ['okoro', 'sdk', 'agent'],
  ...overrides,
});

// Standard fake `npm pack` JSON output containing all required files.
const cleanPackOutput = JSON.stringify([
  {
    files: [
      { path: 'package/package.json' },
      { path: 'package/README.md' },
      { path: 'package/LICENSE' },
      { path: 'package/dist/index.cjs' },
      { path: 'package/dist/index.mjs' },
      { path: 'package/dist/index.d.ts' },
    ],
  },
]);

const stubRunner = (stdout: string): PackRunner => async () => ({
  stdout,
  stderr: '',
});

// ──────────────────────────────────────────────────────────────────────
// parseFlags
// ──────────────────────────────────────────────────────────────────────

describe('parseFlags', () => {
  it('defaults to all=true, strict=false, json=false', () => {
    expect(parseFlags([])).toEqual({ all: true, strict: false, json: false });
  });
  it('--package implies !all', () => {
    expect(parseFlags(['--package', '@okoro/sdk'])).toMatchObject({
      packageFilter: '@okoro/sdk',
      all: false,
    });
  });
  it('parses --strict and --json', () => {
    expect(parseFlags(['--strict', '--json'])).toMatchObject({
      strict: true,
      json: true,
    });
  });
  it('rejects unknown flags', () => {
    expect(() => parseFlags(['--bogus'])).toThrow(/Unknown flag/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseNpmPackOutput
// ──────────────────────────────────────────────────────────────────────

describe('parseNpmPackOutput', () => {
  it('parses npm 7+ JSON', () => {
    const out = parseNpmPackOutput(
      JSON.stringify([{ files: [{ path: 'package/README.md', size: 12 }] }]),
    );
    expect(out.files).toEqual([{ path: 'package/README.md', size: 12 }]);
  });
  it('falls back to text format', () => {
    const text = `\
npm notice Tarball Contents
npm notice 123B README.md
npm notice 4.5kB dist/index.cjs

npm notice Tarball Details
`;
    const out = parseNpmPackOutput(text);
    expect(out.files.map((f) => f.path)).toEqual(['README.md', 'dist/index.cjs']);
  });
  it('returns empty for unparseable input', () => {
    expect(parseNpmPackOutput('').files).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// pure helpers
// ──────────────────────────────────────────────────────────────────────

describe('normalizeTarballPath', () => {
  it('strips leading package/', () => {
    expect(normalizeTarballPath('package/dist/x.js')).toBe('dist/x.js');
  });
  it('leaves paths without prefix alone', () => {
    expect(normalizeTarballPath('dist/x.js')).toBe('dist/x.js');
  });
});

describe('collectEntrypointPaths', () => {
  it('flattens main/module/types/bin and exports', () => {
    expect(
      collectEntrypointPaths({
        main: './dist/a.cjs',
        module: './dist/a.mjs',
        types: './dist/a.d.ts',
        bin: { okoro: './bin/cli.js' },
        exports: {
          '.': { import: './dist/a.mjs', require: './dist/a.cjs' },
          './sub': './dist/sub.mjs',
        },
      }),
    ).toEqual(
      // sorted asc
      [
        './bin/cli.js',
        './dist/a.cjs',
        './dist/a.d.ts',
        './dist/a.mjs',
        './dist/sub.mjs',
      ],
    );
  });
  it('handles missing fields', () => {
    expect(collectEntrypointPaths({})).toEqual([]);
  });
});

describe('FORBIDDEN_PATTERNS', () => {
  it.each([
    ['node_modules/foo/index.js', 'no-node-modules'],
    ['.env', 'no-env'],
    ['src/.env.local', 'no-env'],
    ['src/foo.spec.ts', 'no-test-files'],
    ['src/foo.test.tsx', 'no-test-files'],
    ['coverage/lcov.info', 'no-coverage'],
    ['dist/.tsbuildinfo', 'no-tsbuildinfo'],
  ])('%s matches forbidden pattern %s', (file, id) => {
    const hit = FORBIDDEN_PATTERNS.find((p) => p.test(file));
    expect(hit?.id).toBe(id);
  });

  it('clean files match nothing', () => {
    for (const f of ['README.md', 'dist/index.cjs', 'package.json']) {
      expect(FORBIDDEN_PATTERNS.find((p) => p.test(f))).toBeUndefined();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// findLeakedAbsolutePathsInMaps
// ──────────────────────────────────────────────────────────────────────

describe('findLeakedAbsolutePathsInMaps', () => {
  it('flags maps containing /Users/ paths', () => {
    const repo = makeFakeRepo();
    const dir = repo.pkgDir('x');
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    writeFileSync(
      path.join(dir, 'dist', 'index.js.map'),
      JSON.stringify({ sources: ['/Users/secret/okoro/src/index.ts'] }),
    );
    writeFileSync(
      path.join(dir, 'dist', 'clean.js.map'),
      JSON.stringify({ sources: ['../src/index.ts'] }),
    );
    const leaks = findLeakedAbsolutePathsInMaps(dir, [
      'dist/index.js.map',
      'dist/clean.js.map',
    ]);
    expect(leaks).toEqual(['dist/index.js.map']);
  });
  it('returns [] when no maps in tarball', () => {
    expect(findLeakedAbsolutePathsInMaps('/nonexistent', ['README.md'])).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// summarize
// ──────────────────────────────────────────────────────────────────────

describe('summarize', () => {
  const r = (level: 'pass' | 'warn' | 'fail'): PackageReport => ({
    name: 'p',
    version: '1.0.0',
    dir: '/',
    checks: [{ id: 'x', level, message: 'm' }],
    tarballFiles: [],
  });
  it('counts levels and sets exitCode=0 on all pass', () => {
    expect(summarize([r('pass'), r('pass')], false)).toEqual({
      passed: 2,
      warned: 0,
      failed: 0,
      exitCode: 0,
    });
  });
  it('exitCode=1 on any fail', () => {
    expect(summarize([r('pass'), r('fail')], false).exitCode).toBe(1);
  });
  it('strict promotes warn → fail', () => {
    expect(summarize([r('warn')], true).exitCode).toBe(1);
    expect(summarize([r('warn')], false).exitCode).toBe(0);
  });
});

describe('renderHumanReport', () => {
  it('renders package + checks + summary line', () => {
    const out = renderHumanReport(
      [
        {
          name: '@okoro/sdk',
          version: '1.0.0',
          dir: '/x',
          checks: [
            { id: 'a', level: 'pass', message: 'ok' },
            { id: 'b', level: 'fail', message: 'bad' },
          ],
          tarballFiles: [],
        },
      ],
      { passed: 1, warned: 0, failed: 1 },
    );
    expect(out).toContain('@okoro/sdk@1.0.0');
    expect(out).toContain('✓ [a]');
    expect(out).toContain('✗ [b]');
    expect(out).toContain('1 pass · 0 warn · 1 fail');
  });
});

// ──────────────────────────────────────────────────────────────────────
// checkPackage — manifest checks
// ──────────────────────────────────────────────────────────────────────

describe('checkPackage manifest checks', () => {
  it('passes a clean manifest + clean pack output', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest());
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(cleanPackOutput),
    });
    const fails = report.checks.filter((c) => c.level === 'fail');
    expect(fails).toEqual([]);
  });

  it('fails on missing description', async () => {
    const repo = makeFakeRepo();
    const m = goodManifest();
    delete (m as Record<string, unknown>).description;
    const pkg = writePkg(repo, 'sdk-ts', m);
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(cleanPackOutput),
    });
    expect(report.checks.find((c) => c.id === 'manifest.description')?.level).toBe(
      'fail',
    );
  });

  it('fails on bad semver', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest({ version: 'v1.x' }));
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(cleanPackOutput),
    });
    expect(report.checks.find((c) => c.id === 'manifest.semver')?.level).toBe('fail');
  });

  it('fails when repository.url is unrelated', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(
      repo,
      'sdk-ts',
      goodManifest({ repository: { url: 'https://github.com/other/thing.git' } }),
    );
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(cleanPackOutput),
    });
    expect(report.checks.find((c) => c.id === 'manifest.repository')?.level).toBe(
      'fail',
    );
  });

  it('fails when keywords < 3', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest({ keywords: ['a', 'b'] }));
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(cleanPackOutput),
    });
    expect(report.checks.find((c) => c.id === 'manifest.keywords')?.level).toBe(
      'fail',
    );
  });

  it('fails on link:/file: deps', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(
      repo,
      'sdk-ts',
      goodManifest({ dependencies: { '@okoro/types': 'link:../types' } }),
    );
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(cleanPackOutput),
    });
    expect(report.checks.find((c) => c.id === 'manifest.deps-no-link-file')?.level).toBe(
      'fail',
    );
  });

  it('warns on workspace: deps', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(
      repo,
      'sdk-ts',
      goodManifest({ dependencies: { '@okoro/types': 'workspace:*' } }),
    );
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(cleanPackOutput),
    });
    expect(
      report.checks.find((c) => c.id === 'manifest.deps-workspace')?.level,
    ).toBe('warn');
  });
});

// ──────────────────────────────────────────────────────────────────────
// checkPackage — tarball checks
// ──────────────────────────────────────────────────────────────────────

describe('checkPackage tarball checks', () => {
  it('fails when tarball contains forbidden file', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest());
    const dirty = JSON.stringify([
      {
        files: [
          { path: 'package/package.json' },
          { path: 'package/README.md' },
          { path: 'package/LICENSE' },
          { path: 'package/dist/index.cjs' },
          { path: 'package/dist/index.mjs' },
          { path: 'package/dist/index.d.ts' },
          { path: 'package/src/foo.spec.ts' },
        ],
      },
    ]);
    const report = await checkPackage(pkg, { packRunner: stubRunner(dirty) });
    expect(
      report.checks.find((c) => c.id === 'forbid.no-test-files')?.level,
    ).toBe('fail');
  });

  it('fails when README missing', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest());
    const noReadme = JSON.stringify([
      {
        files: [
          { path: 'package/package.json' },
          { path: 'package/LICENSE' },
          { path: 'package/dist/index.cjs' },
          { path: 'package/dist/index.mjs' },
          { path: 'package/dist/index.d.ts' },
        ],
      },
    ]);
    const report = await checkPackage(pkg, { packRunner: stubRunner(noReadme) });
    expect(report.checks.find((c) => c.id === 'require.readme')?.level).toBe('fail');
  });

  it('warns (not fails) when LICENSE missing', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest());
    const noLicense = JSON.stringify([
      {
        files: [
          { path: 'package/package.json' },
          { path: 'package/README.md' },
          { path: 'package/dist/index.cjs' },
          { path: 'package/dist/index.mjs' },
          { path: 'package/dist/index.d.ts' },
        ],
      },
    ]);
    const report = await checkPackage(pkg, { packRunner: stubRunner(noLicense) });
    expect(report.checks.find((c) => c.id === 'require.license')?.level).toBe('warn');
  });

  it('fails when declared entrypoint is missing from tarball', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest());
    const missingEntry = JSON.stringify([
      {
        files: [
          { path: 'package/package.json' },
          { path: 'package/README.md' },
          { path: 'package/LICENSE' },
          { path: 'package/dist/index.mjs' },
          { path: 'package/dist/index.d.ts' },
          // dist/index.cjs missing
        ],
      },
    ]);
    const report = await checkPackage(pkg, {
      packRunner: stubRunner(missingEntry),
    });
    expect(
      report.checks.find((c) => c.id === 'require.entry.dist/index.cjs')?.level,
    ).toBe('fail');
  });

  it('fails when npm pack runner throws', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest());
    const report = await checkPackage(pkg, {
      packRunner: async () => {
        throw new Error('npm not found');
      },
    });
    expect(report.checks.find((c) => c.id === 'pack.run')?.level).toBe('fail');
  });

  it('fails on empty pack output', async () => {
    const repo = makeFakeRepo();
    const pkg = writePkg(repo, 'sdk-ts', goodManifest());
    const report = await checkPackage(pkg, {
      packRunner: stubRunner('[{"files":[]}]'),
    });
    expect(report.checks.find((c) => c.id === 'pack.empty')?.level).toBe('fail');
  });
});

// ──────────────────────────────────────────────────────────────────────
// run() integration
// ──────────────────────────────────────────────────────────────────────

describe('run()', () => {
  it('exits 0 when all packages clean', async () => {
    const repo = makeFakeRepo();
    writePkg(repo, 'sdk-ts', goodManifest());
    writePkg(repo, 'types', goodManifest({ name: '@okoro/types' }));
    const { exitCode, result } = await run(
      { all: true, strict: false, json: false, repoRoot: repo.root },
      { packRunner: stubRunner(cleanPackOutput), log: () => undefined },
    );
    expect(result.reports).toHaveLength(2);
    expect(exitCode).toBe(0);
  });

  it('exits 1 when any check fails', async () => {
    const repo = makeFakeRepo();
    writePkg(repo, 'sdk-ts', goodManifest({ keywords: [] }));
    const { exitCode } = await run(
      { all: true, strict: false, json: false, repoRoot: repo.root },
      { packRunner: stubRunner(cleanPackOutput), log: () => undefined },
    );
    expect(exitCode).toBe(1);
  });

  it('exits 2 when --package matches nothing', async () => {
    const repo = makeFakeRepo();
    writePkg(repo, 'sdk-ts', goodManifest());
    const { exitCode } = await run(
      {
        all: false,
        strict: false,
        json: false,
        packageFilter: '@okoro/nope',
        repoRoot: repo.root,
      },
      { packRunner: stubRunner(cleanPackOutput), log: () => undefined },
    );
    expect(exitCode).toBe(2);
  });

  it('--json emits parseable JSON', async () => {
    const repo = makeFakeRepo();
    writePkg(repo, 'sdk-ts', goodManifest());
    let captured = '';
    await run(
      { all: true, strict: false, json: true, repoRoot: repo.root },
      {
        packRunner: stubRunner(cleanPackOutput),
        log: (s) => (captured += s),
      },
    );
    const parsed = JSON.parse(captured);
    expect(parsed.reports[0].name).toBe('@okoro/sdk');
    expect(typeof parsed.exitCode).toBe('number');
  });

  it('--strict promotes warnings to failures', async () => {
    const repo = makeFakeRepo();
    writePkg(
      repo,
      'sdk-ts',
      goodManifest({ dependencies: { '@okoro/types': 'workspace:*' } }),
    );
    const lax = await run(
      { all: true, strict: false, json: false, repoRoot: repo.root },
      { packRunner: stubRunner(cleanPackOutput), log: () => undefined },
    );
    const strict = await run(
      { all: true, strict: true, json: false, repoRoot: repo.root },
      { packRunner: stubRunner(cleanPackOutput), log: () => undefined },
    );
    expect(lax.exitCode).toBe(0);
    expect(strict.exitCode).toBe(1);
  });
});
