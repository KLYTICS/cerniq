// Assembles the final `aegis-evidence-*.tar.gz` from collected artifacts.
//
// We emit a strict POSIX ustar archive (Format 0x75 0x73 0x74 0x61 0x72 in
// the magic field) and pipe it through gzip — both formats are stable and
// supported by every auditor's `tar` and `7zip`. We deliberately avoid the
// `tar`/`archiver` npm modules: this bundle's whole job is to be auditable,
// and "what dependencies did the bundler pull in" is a question we'd rather
// answer with "Node built-ins only".
//
// Spec: POSIX 1003.1-1990 ustar; we only use the file type ('0' regular,
// '5' directory) and the standard fields. No PAX extensions — that means
// every member must fit the 100-byte name and 8 GB size limits, both of
// which are far beyond anything an audit export could produce.
//
// SHA256SUMS is the auditor's first check: the manifest file declares its
// own contents are intact, and SHA256SUMS independently corroborates by
// hashing every other file. Both must match for the bundle to be trusted.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import type {
  BundleEntry,
  BundleManifest,
  ChainVerificationFileShape,
  FetchedArtifacts,
  BundleCliOptions,
} from './types.js';
import { BUNDLE_SPEC_VERSION, TOOL_VERSION } from './types.js';

const BLOCK_SIZE = 512;
const NAME_FIELD_MAX = 100;

function pad(num: number, width: number): string {
  return num.toString(8).padStart(width - 1, '0') + '\0';
}

function writeString(buf: Buffer, str: string, offset: number, len: number): void {
  const encoded = Buffer.from(str, 'utf8');
  if (encoded.length > len) {
    throw new Error(`tar: field overflow (${encoded.length} > ${len}) for "${str}"`);
  }
  encoded.copy(buf, offset);
  // Remaining bytes are already zero from Buffer.alloc.
}

interface TarHeaderInput {
  name: string;
  size: number;
  /** '0' = regular file, '5' = directory. */
  typeflag: '0' | '5';
  mtime: number;
}

/** Build a 512-byte POSIX ustar header for one tar member. */
export function buildTarHeader(input: TarHeaderInput): Buffer {
  if (input.name.length > NAME_FIELD_MAX) {
    throw new Error(
      `tar: name "${input.name}" exceeds 100 bytes — bundle paths must stay short`,
    );
  }
  const header = Buffer.alloc(BLOCK_SIZE);

  writeString(header, input.name, 0, 100);
  // mode 0644 / 0755
  header.write(pad(input.typeflag === '5' ? 0o755 : 0o644, 8), 100, 8, 'utf8');
  header.write(pad(0, 8), 108, 8, 'utf8'); // uid
  header.write(pad(0, 8), 116, 8, 'utf8'); // gid
  header.write(pad(input.size, 12), 124, 12, 'utf8');
  header.write(pad(input.mtime, 12), 136, 12, 'utf8');
  // Checksum placeholder — 8 spaces. We compute the checksum, then write back.
  header.write('        ', 148, 8, 'utf8');
  header.write(input.typeflag, 156, 1, 'utf8');
  // linkname (100) — leave blank
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  // uname / gname
  header.write('aegis\0', 265, 6, 'utf8');
  header.write('aegis\0', 297, 6, 'utf8');

  // Compute the unsigned checksum over the entire 512-byte header.
  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) checksum += header[i] ?? 0;
  // Format: 6 octal digits + NUL + space.
  const cs = checksum.toString(8).padStart(6, '0');
  header.write(`${cs}\0 `, 148, 8, 'utf8');

  return header;
}

function padBlock(size: number): Buffer {
  const rem = size % BLOCK_SIZE;
  return rem === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - rem);
}

function sha256OfBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Materializes the manifest, SHA256SUMS, and any in-memory artifacts as
 *  bytes; computes their hashes; produces the final ordered `BundleEntry[]`. */
export async function planBundleEntries(args: {
  bundleRoot: string;
  fetched: FetchedArtifacts;
  verification: ChainVerificationFileShape;
  cli: BundleCliOptions;
  readme: string | null;
}): Promise<{
  entries: BundleEntry[];
  manifest: BundleManifest;
  sha256sumsContent: string;
}> {
  const ndjsonStat = await stat(args.fetched.ndjsonPath);

  const manifest: BundleManifest = {
    spec_version: BUNDLE_SPEC_VERSION,
    generated_at: new Date().toISOString(),
    principal_id: args.cli.principalId,
    agent_id: args.cli.agentId ?? null,
    time_range: {
      from: args.cli.from,
      to: args.cli.to,
    },
    counts: {
      audit_events: args.fetched.ndjsonRowCount,
      redacted_events: args.fetched.redactedRowCount,
    },
    api_base: args.cli.apiBase,
    tool_version: TOOL_VERSION,
    verification: {
      status: args.verification.status,
      first_failure_at: args.verification.firstFailureAt,
    },
    artifacts: {
      retention_policy_included: args.fetched.retentionPolicyAvailable,
    },
  };

  // Stable JSON serialization — sorted top-level keys would break wire shape,
  // so we just rely on the field declaration order above. Pretty-printed for
  // human auditors who will read the file directly.
  const manifestBytes = utf8Bytes(`${JSON.stringify(manifest, null, 2)}\n`);
  const jwksBytes = utf8Bytes(`${JSON.stringify(args.fetched.jwks, null, 2)}\n`);
  const configBytes = utf8Bytes(
    `${JSON.stringify(args.fetched.aegisConfiguration, null, 2)}\n`,
  );
  const verificationBytes = utf8Bytes(
    `${JSON.stringify(args.verification, null, 2)}\n`,
  );
  const securityBytes = utf8Bytes(args.fetched.securityTxt);

  // Order matters for SHA256SUMS reproducibility — sort by path lexicographically.
  const entries: BundleEntry[] = [];

  entries.push({
    path: 'audit-events.ndjson',
    source: { kind: 'file', absPath: args.fetched.ndjsonPath, size: ndjsonStat.size },
    sha256: args.fetched.ndjsonSha256,
  });
  entries.push({
    path: 'jwks.json',
    source: { kind: 'bytes', data: jwksBytes },
    sha256: sha256OfBytes(jwksBytes),
  });
  entries.push({
    path: 'aegis-configuration.json',
    source: { kind: 'bytes', data: configBytes },
    sha256: sha256OfBytes(configBytes),
  });

  if (args.fetched.retentionPolicyAvailable && args.fetched.retentionPolicy !== null) {
    const retentionBytes = utf8Bytes(
      `${JSON.stringify(args.fetched.retentionPolicy, null, 2)}\n`,
    );
    entries.push({
      path: 'retention-policy.json',
      source: { kind: 'bytes', data: retentionBytes },
      sha256: sha256OfBytes(retentionBytes),
    });
  }

  entries.push({
    path: 'security.txt',
    source: { kind: 'bytes', data: securityBytes },
    sha256: sha256OfBytes(securityBytes),
  });
  entries.push({
    path: 'manifest.json',
    source: { kind: 'bytes', data: manifestBytes },
    sha256: sha256OfBytes(manifestBytes),
  });
  entries.push({
    path: 'chain-verification.json',
    source: { kind: 'bytes', data: verificationBytes },
    sha256: sha256OfBytes(verificationBytes),
  });
  if (args.readme !== null) {
    const readmeBytes = utf8Bytes(args.readme);
    entries.push({
      path: 'README.md',
      source: { kind: 'bytes', data: readmeBytes },
      sha256: sha256OfBytes(readmeBytes),
    });
  }

  // SHA256SUMS — coreutils format: "<hex>  <filename>\n" — never include
  // the SHA256SUMS file in itself (chicken-and-egg).
  const sumsLines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.path}`);
  const sumsContent = `${sumsLines.join('\n')}\n`;
  const sumsBytes = utf8Bytes(sumsContent);
  entries.push({
    path: 'SHA256SUMS',
    source: { kind: 'bytes', data: sumsBytes },
    sha256: sha256OfBytes(sumsBytes),
  });

  return { entries, manifest, sha256sumsContent: sumsContent };
}

/** Streams a single tar member (header + body + zero-padding) into an output
 *  Readable.push stream. Files on disk are streamed byte-by-byte to keep
 *  the working set bounded for large NDJSON exports. */
async function* tarMemberChunks(
  bundleRoot: string,
  entry: BundleEntry,
  mtime: number,
): AsyncGenerator<Buffer, void, void> {
  const fullName = `${bundleRoot}/${entry.path}`;
  const size =
    entry.source.kind === 'bytes' ? entry.source.data.byteLength : entry.source.size;
  yield buildTarHeader({ name: fullName, size, typeflag: '0', mtime });

  if (entry.source.kind === 'bytes') {
    yield Buffer.from(
      entry.source.data.buffer,
      entry.source.data.byteOffset,
      entry.source.data.byteLength,
    );
  } else {
    const stream = createReadStream(entry.source.absPath);
    for await (const chunk of stream) yield chunk as Buffer;
  }

  const padding = padBlock(size);
  if (padding.length > 0) yield padding;
}

async function* tarStreamGenerator(
  bundleRoot: string,
  entries: BundleEntry[],
): AsyncGenerator<Buffer, void, void> {
  const mtime = Math.floor(Date.now() / 1000);
  // Directory entry — many tar implementations expect this for clean extract.
  yield buildTarHeader({ name: `${bundleRoot}/`, size: 0, typeflag: '5', mtime });
  for (const entry of entries) {
    yield* tarMemberChunks(bundleRoot, entry, mtime);
  }
  // Two 512-byte zero blocks terminate the archive.
  yield Buffer.alloc(BLOCK_SIZE * 2);
}

/** Writes the tarball to `outputPath`, streaming through gzip. */
export async function writeBundle(args: {
  outputPath: string;
  bundleRoot: string;
  entries: BundleEntry[];
}): Promise<void> {
  const tarReadable = Readable.from(
    tarStreamGenerator(args.bundleRoot, args.entries),
  );
  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(args.outputPath);
  await pipeline(tarReadable, gzip, out);
}

// Re-exports for tests that need direct access to the lower-level helpers.
export const __testing = {
  buildTarHeader,
  padBlock,
  sha256OfBytes,
  sha256OfFile,
};
