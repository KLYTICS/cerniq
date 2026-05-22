// Tests for the artifact fetcher. We mock the global fetch with a small
// adapter so we can:
//   1. Drive happy-path: NDJSON + 4 well-known docs all 200.
//   2. Verify NDJSON streaming counts rows + redactions correctly.
//   3. Verify retention-policy 404 is tolerated as a gap, not an error.
//   4. Verify SHA256 of the streamed NDJSON matches the canonical hash.
//   5. Verify a 5xx on a required endpoint surfaces the error (no silent fail).

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchAllArtifacts } from '../fetch-artifacts.js';
import type { BundleCliOptions } from '../types.js';

interface MockRoute {
  match: (url: string) => boolean;
  respond: () => Response;
}

function bodyToStream(body: Uint8Array | string): ReadableStream<Uint8Array> {
  const bytes =
    typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return new ReadableStream<Uint8Array>({
    start(ctl) {
      // Chunk the bytes into a few pieces so the streaming path exercises
      // the "split a row across chunk boundaries" code path.
      const mid = Math.floor(bytes.byteLength / 2);
      ctl.enqueue(bytes.subarray(0, mid));
      ctl.enqueue(bytes.subarray(mid));
      ctl.close();
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ndjsonResponse(body: string): Response {
  return new Response(bodyToStream(body), {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

function buildAdapter(routes: MockRoute[]): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url;
    calls.push(url);
    for (const r of routes) {
      if (r.match(url)) return r.respond();
    }
    return new Response(`no mock for ${url}`, { status: 599 });
  };
  return { fetch: fakeFetch, calls };
}

const NDJSON =
  '{"eventId":"e1","payload":{"actionHash":null}}\n' +
  '{"eventId":"e2","payload":{"actionHash":"abc"}}\n' +
  '{"eventId":"e3","payload":{"actionHash":null}}\n' +
  '{"eventId":"e4","payload":{"actionHash":"xyz"}}\n';

const cli: BundleCliOptions = {
  principalId: 'prc_test',
  agentId: 'agt_test',
  from: '2026-01-01',
  to: '2026-04-30',
  output: '/tmp/x.tar.gz',
  apiBase: 'https://okoro.test',
  apiKey: 'sk_test',
  verifyOnly: false,
  includeReadme: true,
};

describe('fetchAllArtifacts', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'okoro-fetch-test-'));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('streams NDJSON, counts rows + redactions, and fetches 4 well-known docs', async () => {
    const adapter = buildAdapter([
      {
        match: (u) => u.includes('/audit/export.ndjson'),
        respond: () => ndjsonResponse(NDJSON),
      },
      {
        match: (u) => u.endsWith('/audit-signing-key'),
        respond: () =>
          jsonResponse({
            keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'k1', x: 'AAAA', use: 'sig' }],
          }),
      },
      {
        match: (u) => u.endsWith('/okoro-configuration'),
        respond: () => jsonResponse({ issuer: 'https://okoro.test' }),
      },
      {
        match: (u) => u.endsWith('/retention-policy.json'),
        respond: () => new Response('not found', { status: 404 }),
      },
      {
        match: (u) => u.endsWith('/security.txt'),
        respond: () => new Response('Contact: security@okoro.test\n', { status: 200 }),
      },
    ]);

    const result = await fetchAllArtifacts(cli, adapter, workDir);

    expect(result.ndjsonRowCount).toBe(4);
    expect(result.redactedRowCount).toBe(2);
    expect(result.retentionPolicyAvailable).toBe(false);
    expect(result.retentionPolicy).toBeNull();
    expect(result.securityTxt).toContain('security@okoro.test');

    // SHA256 must equal the canonical hash of the body bytes.
    const expectedSha = createHash('sha256').update(NDJSON).digest('hex');
    expect(result.ndjsonSha256).toBe(expectedSha);

    const onDisk = await readFile(result.ndjsonPath, 'utf8');
    expect(onDisk).toBe(NDJSON);

    // The export URL must use the agent-id when one is supplied.
    expect(adapter.calls.some((u) => u.includes('/agents/agt_test/audit/export.ndjson'))).toBe(true);
    // And must include the from/to query params.
    expect(adapter.calls.some((u) => u.includes('from=2026-01-01') && u.includes('to=2026-04-30'))).toBe(true);
  });

  it('surfaces a 5xx on a required endpoint (no silent failure)', async () => {
    const adapter = buildAdapter([
      {
        match: (u) => u.includes('/audit/export.ndjson'),
        respond: () => ndjsonResponse(NDJSON),
      },
      {
        match: (u) => u.endsWith('/audit-signing-key'),
        respond: () => new Response('boom', { status: 503 }),
      },
      {
        match: (u) => u.endsWith('/okoro-configuration'),
        respond: () => jsonResponse({}),
      },
      {
        match: (u) => u.endsWith('/retention-policy.json'),
        respond: () => new Response('', { status: 404 }),
      },
      {
        match: (u) => u.endsWith('/security.txt'),
        respond: () => new Response('', { status: 200 }),
      },
    ]);

    await expect(fetchAllArtifacts(cli, adapter, workDir)).rejects.toThrow(
      /audit-signing-key.*HTTP 503/,
    );
  });

  it('counts a final row that lacks a trailing newline', async () => {
    const ragged =
      '{"eventId":"e1","payload":{"actionHash":"a"}}\n' +
      '{"eventId":"e2","payload":{"actionHash":null}}'; // no trailing \n
    const adapter = buildAdapter([
      {
        match: (u) => u.includes('/audit/export.ndjson'),
        respond: () => ndjsonResponse(ragged),
      },
      {
        match: (u) => u.endsWith('/audit-signing-key'),
        respond: () => jsonResponse({ keys: [] }),
      },
      {
        match: (u) => u.endsWith('/okoro-configuration'),
        respond: () => jsonResponse({}),
      },
      {
        match: (u) => u.endsWith('/retention-policy.json'),
        respond: () => new Response('', { status: 404 }),
      },
      {
        match: (u) => u.endsWith('/security.txt'),
        respond: () => new Response('', { status: 200 }),
      },
    ]);
    const r = await fetchAllArtifacts(cli, adapter, workDir);
    expect(r.ndjsonRowCount).toBe(2);
    expect(r.redactedRowCount).toBe(1);
  });
});
