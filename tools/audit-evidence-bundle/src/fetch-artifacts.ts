// Fetches everything an external auditor needs from a live CERNIQ deployment.
//
// Design notes:
//   - NDJSON is streamed straight to disk through a SHA256 hasher. We never
//     buffer the full export in memory; row counting and redaction counting
//     happen on the streaming side so we don't reread the file later.
//   - Well-known documents are tiny (<10KB each); buffering is fine.
//   - retention-policy.json is best-effort: Lane B will ship it, but until
//     the endpoint exists we tolerate a 404 and surface the gap in the
//     manifest rather than failing the whole bundle.
//   - All HTTP errors include the response body (truncated) in the thrown
//     message — silent failures are an architecture invariant violation.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { BundleCliOptions, FetchedArtifacts } from './types.js';

const FETCH_TIMEOUT_MS = 600_000; // 10 minutes — large 100k-row exports are slow
const MAX_ERROR_BODY = 2_000;

export interface FetchAdapter {
  fetch: typeof fetch;
}

const defaultAdapter: FetchAdapter = { fetch: globalThis.fetch.bind(globalThis) };

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}…` : text;
  } catch {
    return '<unreadable response body>';
  }
}

async function fetchJson(url: string, apiKey: string, adapter: FetchAdapter): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await adapter.fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'cerniq-audit-evidence-bundle/0.1.0',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new Error(`fetch ${url} failed: HTTP ${res.status} — ${body}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, apiKey: string, adapter: FetchAdapter): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await adapter.fetch(url, {
      headers: {
        Accept: 'text/plain, */*;q=0.5',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'cerniq-audit-evidence-bundle/0.1.0',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new Error(`fetch ${url} failed: HTTP ${res.status} — ${body}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

interface OptionalJsonResult {
  available: boolean;
  body: unknown | null;
}

async function fetchOptionalJson(
  url: string,
  apiKey: string,
  adapter: FetchAdapter,
): Promise<OptionalJsonResult> {
  try {
    const res = await adapter.fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'cerniq-audit-evidence-bundle/0.1.0',
      },
    });
    if (res.status === 404 || res.status === 410) {
      // Tolerated gap — Lane B will ship this; not a fatal error.
      return { available: false, body: null };
    }
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new Error(`fetch ${url} failed: HTTP ${res.status} — ${body}`);
    }
    return { available: true, body: (await res.json()) as unknown };
  } catch (err) {
    // Network errors for an optional resource: surface the gap rather than
    // pretending the file existed. Auditors will see retention_policy_included=false.
    if (err instanceof Error && err.message.startsWith('fetch ')) throw err;
    return { available: false, body: null };
  }
}

interface StreamNdjsonResult {
  ndjsonPath: string;
  rowCount: number;
  redactedCount: number;
  sha256: string;
}

/** Streams the NDJSON export to a temp file, computing SHA256 and counting
 *  rows / redactions in-stream. Constant memory regardless of export size. */
export async function streamNdjsonExport(
  url: string,
  apiKey: string,
  adapter: FetchAdapter,
  workDir: string,
): Promise<StreamNdjsonResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await adapter.fetch(url, {
      headers: {
        Accept: 'application/x-ndjson',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'cerniq-audit-evidence-bundle/0.1.0',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new Error(`fetch ${url} failed: HTTP ${res.status} — ${body}`);
    }
    if (!res.body) {
      throw new Error(`fetch ${url} returned no response body`);
    }

    const ndjsonPath = join(workDir, 'audit-events.ndjson');
    const hash = createHash('sha256');
    let rowCount = 0;
    let redactedCount = 0;
    let leftover = '';

    const decoder = new TextDecoder('utf-8', { fatal: false });
    // Convert Web ReadableStream → Node Readable so we can pipeline().
    const nodeStream = Readable.fromWeb(
      res.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    const out = createWriteStream(ndjsonPath);

    // Tap each chunk: hash it, count NDJSON rows, scan for redactions.
    const tap = new Readable({ read() {} });
    nodeStream.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      hash.update(buf);
      // Row + redaction accounting on a UTF-8 view; safe because we
      // accumulate `leftover` across chunk boundaries.
      const text = leftover + decoder.decode(buf, { stream: true });
      const lines = text.split('\n');
      leftover = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        rowCount++;
        // A redacted row has actionHash === null in the signed payload.
        // Cheap substring probe — exhaustive parsing happens during verify.
        if (trimmed.includes('"actionHash":null')) redactedCount++;
      }
      tap.push(buf);
    });
    nodeStream.on('end', () => {
      // Flush any final partial line that arrived without a trailing newline.
      const tail = leftover + decoder.decode();
      const trimmed = tail.trim();
      if (trimmed.length > 0) {
        rowCount++;
        if (trimmed.includes('"actionHash":null')) redactedCount++;
      }
      tap.push(null);
    });
    nodeStream.on('error', (err) => tap.destroy(err));

    await pipeline(tap, out);

    return {
      ndjsonPath,
      rowCount,
      redactedCount,
      sha256: hash.digest('hex'),
    };
  } finally {
    clearTimeout(t);
  }
}

export async function createWorkDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cerniq-evidence-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Top-level orchestrator: pulls every artifact the auditor needs.
 *  Public so tests can spy on the per-source fetch helpers. */
export async function fetchAllArtifacts(
  opts: BundleCliOptions,
  adapter: FetchAdapter = defaultAdapter,
  workDir?: string,
): Promise<FetchedArtifacts> {
  const dir = workDir ?? (await createWorkDir());
  const base = opts.apiBase.replace(/\/+$/, '');

  // The audit export is per-agent (`/v1/agents/:agentId/audit/export.ndjson`),
  // not per-principal. We fall back to {principalId} if no agent was passed,
  // which is the CERNIQ convention for "all agents owned by this principal"
  // when (and only when) the operator has wired that route. Document the
  // limitation in the auditor README so it's not a silent assumption.
  const agentSegment = encodeURIComponent(opts.agentId ?? opts.principalId);
  const exportUrl =
    `${base}/v1/agents/${agentSegment}/audit/export.ndjson` +
    `?from=${encodeURIComponent(opts.from)}&to=${encodeURIComponent(opts.to)}`;

  // Stream NDJSON first — it's the heaviest artifact, fail fast if it errors.
  const ndjson = await streamNdjsonExport(exportUrl, opts.apiKey, adapter, dir);

  // Run the four well-known fetches concurrently — small payloads, independent.
  const [jwks, cerniqConfiguration, retention, securityTxt] = await Promise.all([
    fetchJson(`${base}/.well-known/audit-signing-key`, opts.apiKey, adapter),
    fetchJson(`${base}/.well-known/cerniq-configuration`, opts.apiKey, adapter),
    fetchOptionalJson(`${base}/.well-known/retention-policy.json`, opts.apiKey, adapter),
    fetchText(`${base}/.well-known/security.txt`, opts.apiKey, adapter),
  ]);

  return {
    ndjsonPath: ndjson.ndjsonPath,
    ndjsonRowCount: ndjson.rowCount,
    redactedRowCount: ndjson.redactedCount,
    ndjsonSha256: ndjson.sha256,
    jwks,
    cerniqConfiguration,
    retentionPolicy: retention.body,
    retentionPolicyAvailable: retention.available,
    securityTxt,
  };
}

// Internal helpers exposed for tests only — do not depend on them externally.
export const __testing = {
  fetchJson,
  fetchText,
  fetchOptionalJson,
  writeFile,
};
