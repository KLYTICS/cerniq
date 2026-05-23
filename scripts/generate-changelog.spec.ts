import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  parseFlags,
  parseSessionHandoff,
  filterEntriesSince,
  bucketEntriesByPackage,
  bucketCommitsByPackage,
  readGitCommits,
  renderChangelog,
  makeDiffPreview,
  run,
  type GitRunner,
  type SessionEntry,
} from './generate-changelog.js';
import { findCerniqPackages, CerniqPackageManifest } from './lib/package-introspect.js';

// ──────────────────────────────────────────────────────────────────────
// Helpers: build a fake repo on disk so package discovery is real.
// ──────────────────────────────────────────────────────────────────────

interface FakeRepo {
  root: string;
  pkgDir: (name: string) => string;
}

function makeFakeRepo(): FakeRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'cerniq-changelog-'));
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  mkdirSync(path.join(root, 'packages'), { recursive: true });
  mkdirSync(path.join(root, 'docs'), { recursive: true });

  const mkPkg = (folder: string, manifest: Record<string, unknown>): string => {
    const dir = path.join(root, 'packages', folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
    return dir;
  };

  mkPkg('sdk-ts', {
    name: '@cerniq/sdk',
    version: '0.1.0',
    description: 'CERNIQ SDK',
    license: 'MIT',
    main: 'dist/index.cjs',
    repository: { type: 'git', url: 'https://github.com/x/cerniq.git' },
    engines: { node: '>=18' },
    keywords: ['cerniq', 'sdk', 'agent'],
  });
  mkPkg('types', {
    name: '@cerniq/types',
    version: '0.1.0',
    description: 'CERNIQ types',
    license: 'MIT',
  });
  mkPkg('verifier-rp', {
    name: '@cerniq/verifier-rp',
    version: '0.1.0',
    description: 'verifier',
    license: 'MIT',
  });
  mkPkg('sdk-py', {
    // sdk-py has no real npm package.json; mock one for discovery.
    name: 'cerniq-py',
    version: '0.1.0',
    description: 'python sdk',
    license: 'MIT',
    private: true,
  });

  return {
    root,
    pkgDir: (n: string) => path.join(root, 'packages', n),
  };
}

// ──────────────────────────────────────────────────────────────────────
// parseFlags
// ──────────────────────────────────────────────────────────────────────

describe('parseFlags', () => {
  it('returns dryRun=false by default', () => {
    expect(parseFlags([])).toEqual({ dryRun: false });
  });
  it('parses --since', () => {
    expect(parseFlags(['--since', '2026-04-01'])).toMatchObject({
      since: '2026-04-01',
    });
  });
  it('rejects malformed --since', () => {
    expect(() => parseFlags(['--since', 'yesterday'])).toThrow(/YYYY-MM-DD/);
  });
  it('parses --package, --dry-run, --out', () => {
    expect(parseFlags(['--package', 'sdk-ts', '--dry-run', '--out', '/tmp/x.md'])).toMatchObject({
      packageFilter: 'sdk-ts',
      dryRun: true,
      out: '/tmp/x.md',
    });
  });
  it('rejects unknown flags', () => {
    expect(() => parseFlags(['--bogus'])).toThrow(/Unknown flag/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseSessionHandoff
// ──────────────────────────────────────────────────────────────────────

describe('parseSessionHandoff', () => {
  it('returns [] for empty input', () => {
    expect(parseSessionHandoff('')).toEqual([]);
  });

  it('extracts heading + bullets', () => {
    const text = `\
# CERNIQ — Session handoff log

## 2026-05-05 (Round 15) · claim=foo

- shipped throttling
- shipped rotation in packages/sdk-ts/

## 2026-04-30 (Round 14)

* prior work
1. numbered bullet
`;
    const out = parseSessionHandoff(text);
    expect(out).toHaveLength(2);
    expect(out[0]?.date).toBe('2026-05-05');
    expect(out[0]?.bullets).toContain('shipped throttling');
    expect(out[0]?.bullets).toContain('shipped rotation in packages/sdk-ts/');
    expect(out[1]?.bullets).toContain('prior work');
    expect(out[1]?.bullets).toContain('numbered bullet');
  });

  it('skips text before first heading', () => {
    const text = 'preamble line\nmore preamble\n\n## 2026-01-01\n- a\n';
    const out = parseSessionHandoff(text);
    expect(out).toHaveLength(1);
    expect(out[0]?.bullets).toEqual(['a']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// filterEntriesSince
// ──────────────────────────────────────────────────────────────────────

describe('filterEntriesSince', () => {
  const entries: SessionEntry[] = [
    { date: '2026-05-01', heading: 'h1', body: '', bullets: [] },
    { date: '2026-04-01', heading: 'h2', body: '', bullets: [] },
    { date: '2026-03-01', heading: 'h3', body: '', bullets: [] },
  ];
  it('returns all when since is undefined', () => {
    expect(filterEntriesSince(entries, undefined)).toHaveLength(3);
  });
  it('filters strictly by date string compare', () => {
    expect(filterEntriesSince(entries, '2026-04-01').map((e) => e.date)).toEqual([
      '2026-05-01',
      '2026-04-01',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// bucketEntriesByPackage
// ──────────────────────────────────────────────────────────────────────

describe('bucketEntriesByPackage', () => {
  it('matches entries by path token', () => {
    const repo = makeFakeRepo();
    const packages = findCerniqPackages({ repoRoot: repo.root });
    const entries: SessionEntry[] = [
      {
        date: '2026-05-05',
        heading: 'sdk shipped',
        body: 'modified packages/sdk-ts/src/index.ts',
        bullets: ['fixed sdk bug'],
      },
      {
        date: '2026-05-04',
        heading: 'unrelated work',
        body: 'modified apps/api/src/foo.ts',
        bullets: ['api change'],
      },
      {
        date: '2026-05-03',
        heading: 'types update',
        body: 'edits to packages/types/src/schemas.ts',
        bullets: ['added schema'],
      },
    ];
    const buckets = bucketEntriesByPackage(entries, packages);
    const names = buckets.map((b) => b.pkg.name);
    expect(names).toContain('@cerniq/sdk');
    expect(names).toContain('@cerniq/types');
    // verifier-rp had no matches → no bucket
    expect(names).not.toContain('@cerniq/verifier-rp');
    const sdkBucket = buckets.find((b) => b.pkg.name === '@cerniq/sdk');
    expect(sdkBucket?.entries).toHaveLength(1);
    expect(sdkBucket?.entries[0]?.heading).toBe('sdk shipped');
  });

  it('returns [] when no entries touch any package', () => {
    const repo = makeFakeRepo();
    const packages = findCerniqPackages({ repoRoot: repo.root });
    const entries: SessionEntry[] = [
      { date: '2026-05-05', heading: 'docs only', body: 'docs/foo.md', bullets: [] },
    ];
    expect(bucketEntriesByPackage(entries, packages)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// renderChangelog determinism
// ──────────────────────────────────────────────────────────────────────

describe('renderChangelog', () => {
  const repo = makeFakeRepo();
  const packages = findCerniqPackages({ repoRoot: repo.root });
  const sdk = packages.find((p) => p.name === '@cerniq/sdk') as CerniqPackageManifest;

  it('emits Keep-A-Changelog header + dated sections', () => {
    const out = renderChangelog({
      pkg: sdk,
      entries: [
        { date: '2026-05-05', heading: 'A', body: 'b', bullets: ['x', 'y'] },
        { date: '2026-04-01', heading: 'B', body: 'b', bullets: ['z'] },
      ],
    });
    expect(out).toContain('# Changelog');
    expect(out).toContain('## [unreleased]');
    expect(out).toContain('### 2026-05-05');
    expect(out).toContain('### 2026-04-01');
    // date desc
    expect(out.indexOf('### 2026-05-05')).toBeLessThan(out.indexOf('### 2026-04-01'));
  });

  it('is deterministic — same input → same output (twice)', () => {
    const bucket = {
      pkg: sdk,
      entries: [
        { date: '2026-05-05', heading: 'B', body: 'x', bullets: ['second'] },
        { date: '2026-05-05', heading: 'A', body: 'x', bullets: ['first'] },
      ],
    };
    const a = renderChangelog(bucket);
    const b = renderChangelog(bucket);
    expect(a).toBe(b);
    // Within a date, headings sort asc so A is before B.
    expect(a.indexOf('**A**')).toBeLessThan(a.indexOf('**B**'));
  });
});

// ──────────────────────────────────────────────────────────────────────
// readGitCommits parses --name-only output
// ──────────────────────────────────────────────────────────────────────

describe('readGitCommits + bucketCommitsByPackage', () => {
  it('parses git log blocks and buckets by package', () => {
    const fake: GitRunner = () =>
      [
        'abc123\t2026-05-05\tfix: sdk thing',
        'packages/sdk-ts/src/x.ts',
        'packages/sdk-ts/src/y.ts',
        '',
        'def456\t2026-05-04\tfix: api thing',
        'apps/api/src/foo.ts',
      ].join('\n');

    const commits = readGitCommits(fake, '2026-04-01');
    expect(commits).toHaveLength(2);
    expect(commits[0]?.subject).toBe('fix: sdk thing');
    expect(commits[0]?.files).toEqual(['packages/sdk-ts/src/x.ts', 'packages/sdk-ts/src/y.ts']);

    const repo = makeFakeRepo();
    const packages = findCerniqPackages({ repoRoot: repo.root });
    const buckets = bucketCommitsByPackage(commits, packages);
    expect(buckets.find((b) => b.pkg.name === '@cerniq/sdk')?.entries).toHaveLength(1);
  });

  it('returns [] when git fails (no repo)', () => {
    const fake: GitRunner = () => {
      throw new Error('not a git repo');
    };
    expect(readGitCommits(fake, undefined)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// makeDiffPreview branches
// ──────────────────────────────────────────────────────────────────────

describe('makeDiffPreview', () => {
  it('reports new file', () => {
    expect(makeDiffPreview('/p/CHANGELOG.md', 'a\nb', null)).toMatch(/new file/);
  });
  it('reports no change when identical', () => {
    expect(makeDiffPreview('/p/CHANGELOG.md', 'x', 'x')).toMatch(/no change/);
  });
  it('reports update when different', () => {
    expect(makeDiffPreview('/p/CHANGELOG.md', 'xy', 'x')).toMatch(/would update/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// run() — end-to-end with on-disk fake repo
// ──────────────────────────────────────────────────────────────────────

describe('run()', () => {
  it('writes per-package CHANGELOG.md based on SESSION_HANDOFF entries', () => {
    const repo = makeFakeRepo();
    const handoff = `\
# log

## 2026-05-05 (Round X)

- updated packages/sdk-ts/src/index.ts
- updated packages/types/src/schemas.ts
`;
    writeFileSync(path.join(repo.root, 'docs', 'SESSION_HANDOFF.md'), handoff);

    const result = run({ dryRun: false, repoRoot: repo.root }, { log: () => undefined });

    expect(result.usedFallback).toBe(false);
    expect(result.written.length).toBeGreaterThanOrEqual(2);
    const sdkChangelog = path.join(repo.pkgDir('sdk-ts'), 'CHANGELOG.md');
    const typesChangelog = path.join(repo.pkgDir('types'), 'CHANGELOG.md');
    expect(existsSync(sdkChangelog)).toBe(true);
    expect(existsSync(typesChangelog)).toBe(true);
    expect(readFileSync(sdkChangelog, 'utf-8')).toContain('## [unreleased]');
    // verifier-rp not touched → no file
    expect(existsSync(path.join(repo.pkgDir('verifier-rp'), 'CHANGELOG.md'))).toBe(false);
  });

  it('falls back to git when SESSION_HANDOFF yields no matches', () => {
    const repo = makeFakeRepo();
    writeFileSync(path.join(repo.root, 'docs', 'SESSION_HANDOFF.md'), '');
    const fakeGit: GitRunner = () =>
      ['hash1\t2026-05-05\tfix: x', 'packages/sdk-ts/src/index.ts'].join('\n');
    const result = run(
      { dryRun: true, repoRoot: repo.root },
      { gitRunner: fakeGit, log: () => undefined },
    );
    expect(result.usedFallback).toBe(true);
    expect(result.buckets.find((b) => b.pkg.name === '@cerniq/sdk')).toBeDefined();
  });

  it('--dry-run does not write files', () => {
    const repo = makeFakeRepo();
    writeFileSync(
      path.join(repo.root, 'docs', 'SESSION_HANDOFF.md'),
      '## 2026-05-05\n- packages/sdk-ts/x changed\n',
    );
    let logged = '';
    const result = run({ dryRun: true, repoRoot: repo.root }, { log: (s) => (logged += s) });
    expect(result.written).toEqual([]);
    expect(logged).toContain('packages/sdk-ts');
    expect(existsSync(path.join(repo.pkgDir('sdk-ts'), 'CHANGELOG.md'))).toBe(false);
  });

  it('--package filters to one bucket', () => {
    const repo = makeFakeRepo();
    writeFileSync(
      path.join(repo.root, 'docs', 'SESSION_HANDOFF.md'),
      '## 2026-05-05\n- packages/sdk-ts/x and packages/types/y\n',
    );
    const result = run(
      { dryRun: true, packageFilter: 'sdk-ts', repoRoot: repo.root },
      { log: () => undefined },
    );
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.pkg.name).toBe('@cerniq/sdk');
  });

  it('--package with unknown alias throws', () => {
    const repo = makeFakeRepo();
    writeFileSync(path.join(repo.root, 'docs', 'SESSION_HANDOFF.md'), '');
    expect(() =>
      run(
        { dryRun: true, packageFilter: 'no-such-pkg', repoRoot: repo.root },
        { log: () => undefined },
      ),
    ).toThrow(/no SDK package matches/);
  });
});
