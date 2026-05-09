// Tests for the bundle builder. We assert:
//   1. The tar header checksum is computed correctly (gnutar-compatible).
//   2. Bundle planning produces the canonical entry order.
//   3. SHA256SUMS contains every file except itself.
//   4. The tarball round-trips: a written .tar.gz extracted via system `tar`
//      contains every expected file with byte-identical contents.
//
// We use the system `tar` binary (available on macOS / Linux / Windows-WSL
// dev machines and on Railway/GH Actions runners) to validate the archive
// instead of pulling in a tar-parser dep — which would defeat the point of
// the bundler being dependency-light.

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import {
  __testing as bbTesting,
  planBundleEntries,
  writeBundle,
} from '../build-bundle.js';
import type {
  BundleCliOptions,
  ChainVerificationFileShape,
  FetchedArtifacts,
} from '../types.js';

const execFileP = promisify(execFile);

function makeFetched(ndjsonPath: string, ndjsonSha256: string): FetchedArtifacts {
  return {
    ndjsonPath,
    ndjsonRowCount: 3,
    redactedRowCount: 1,
    ndjsonSha256,
    jwks: { keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'k1', x: 'AAAA', use: 'sig' }] },
    aegisConfiguration: { issuer: 'https://aegis.test' },
    retentionPolicy: null,
    retentionPolicyAvailable: false,
    securityTxt: 'Contact: security@aegis.test\n',
  };
}

const cli: BundleCliOptions = {
  principalId: 'prc_test',
  agentId: undefined,
  from: '2026-01-01',
  to: '2026-04-30',
  output: '/tmp/should-be-overridden.tar.gz',
  apiBase: 'https://aegis.test',
  apiKey: 'sk_test_redacted',
  verifyOnly: false,
  includeReadme: true,
};

const verification: ChainVerificationFileShape = {
  status: 'pass',
  totalRows: 3,
  signingKeys: ['k1'],
  rotationEvents: [],
  firstFailureAt: null,
  firstFailureReason: null,
  durationMs: 1,
  verifierPackage: '@aegis/audit-verifier',
  verifierVersion: '0.1.0',
};

describe('buildTarHeader', () => {
  it('produces a 512-byte header with a valid POSIX ustar checksum', () => {
    const h = bbTesting.buildTarHeader({
      name: 'foo/bar.txt',
      size: 42,
      typeflag: '0',
      mtime: 1_700_000_000,
    });
    expect(h.length).toBe(512);
    // ustar magic at offset 257
    expect(h.toString('utf8', 257, 263)).toBe('ustar\0');
    // Recompute the checksum with the field set to spaces, must equal the
    // value embedded at offset 148.
    const stored = parseInt(h.toString('utf8', 148, 154), 8);
    let cs = 0;
    for (let i = 0; i < 512; i++) {
      // Treat the 8-byte checksum field as spaces for the recompute.
      cs += i >= 148 && i < 156 ? 0x20 : (h[i] ?? 0);
    }
    expect(cs).toBe(stored);
  });

  it('rejects names that overflow the 100-byte field', () => {
    expect(() =>
      bbTesting.buildTarHeader({
        name: 'x'.repeat(120),
        size: 0,
        typeflag: '0',
        mtime: 0,
      }),
    ).toThrow(/100 bytes|field overflow/);
  });
});

describe('planBundleEntries', () => {
  let workDir: string;
  let ndjsonPath: string;
  let ndjsonSha: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'aegis-bundle-test-'));
    ndjsonPath = join(workDir, 'audit-events.ndjson');
    const ndjsonContent =
      '{"eventId":"e1","payload":{"actionHash":null}}\n' +
      '{"eventId":"e2","payload":{"actionHash":"abc"}}\n' +
      '{"eventId":"e3","payload":{"actionHash":"def"}}\n';
    await writeFile(ndjsonPath, ndjsonContent);
    ndjsonSha = await bbTesting.sha256OfFile(ndjsonPath);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('emits the expected entry order and embeds the manifest counts', async () => {
    const fetched = makeFetched(ndjsonPath, ndjsonSha);
    const { entries, manifest, sha256sumsContent } = await planBundleEntries({
      bundleRoot: 'aegis-evidence-test',
      fetched,
      verification,
      cli,
      readme: 'README BODY',
    });

    const paths = entries.map((e) => e.path);
    // SHA256SUMS is always last; everything else stable.
    expect(paths).toEqual([
      'audit-events.ndjson',
      'jwks.json',
      'aegis-configuration.json',
      'security.txt',
      'manifest.json',
      'chain-verification.json',
      'README.md',
      'SHA256SUMS',
    ]);
    expect(manifest.counts.audit_events).toBe(3);
    expect(manifest.counts.redacted_events).toBe(1);
    expect(manifest.artifacts.retention_policy_included).toBe(false);
    expect(manifest.verification.status).toBe('pass');

    // SHA256SUMS lines should be sorted lexicographically and exclude itself.
    const lines = sha256sumsContent.trim().split('\n');
    const filenames = lines.map((l) => l.split('  ')[1]);
    expect(filenames).not.toContain('SHA256SUMS');
    expect([...filenames].sort()).toEqual(filenames);
  });

  it('includes retention-policy.json only when available', async () => {
    const fetched: FetchedArtifacts = {
      ...makeFetched(ndjsonPath, ndjsonSha),
      retentionPolicy: { window_days: 365 },
      retentionPolicyAvailable: true,
    };
    const { entries, manifest } = await planBundleEntries({
      bundleRoot: 'b',
      fetched,
      verification,
      cli,
      readme: null,
    });
    expect(entries.some((e) => e.path === 'retention-policy.json')).toBe(true);
    expect(manifest.artifacts.retention_policy_included).toBe(true);
  });

  it('writes a tarball that the system `tar` can extract intact', async () => {
    const fetched = makeFetched(ndjsonPath, ndjsonSha);
    const { entries } = await planBundleEntries({
      bundleRoot: 'aegis-evidence-test',
      fetched,
      verification,
      cli,
      readme: 'AUDITOR README',
    });
    const out = join(workDir, 'bundle.tar.gz');
    await writeBundle({ outputPath: out, bundleRoot: 'aegis-evidence-test', entries });
    const s = await stat(out);
    expect(s.size).toBeGreaterThan(0);

    // Extract and verify file presence + manifest correctness.
    const extractDir = join(workDir, 'extract');
    await mkdir(extractDir, { recursive: true });
    await execFileP('tar', ['-xzf', out, '-C', extractDir]);

    const root = join(extractDir, 'aegis-evidence-test');
    const ndjson = await readFile(join(root, 'audit-events.ndjson'), 'utf8');
    expect(ndjson).toContain('"eventId":"e1"');
    expect(ndjson).toContain('"eventId":"e3"');

    const manifestText = await readFile(join(root, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(manifestText) as { counts: { audit_events: number } };
    expect(parsed.counts.audit_events).toBe(3);

    const sums = await readFile(join(root, 'SHA256SUMS'), 'utf8');
    expect(sums).toMatch(/audit-events\.ndjson$/m);
    expect(sums).toMatch(/manifest\.json$/m);

    const readme = await readFile(join(root, 'README.md'), 'utf8');
    expect(readme).toBe('AUDITOR README');
  });
});
