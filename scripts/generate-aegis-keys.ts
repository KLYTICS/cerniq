#!/usr/bin/env -S node --import=tsx
/**
 * AEGIS — generate the internal Ed25519 signing keypair used to sign audit
 * records and the audit hash chain.
 *
 * Outputs (any combination, controlled by --format):
 *   - env  : .env-style file with AEGIS_SIGNING_PRIVATE_KEY / _PUBLIC_KEY (base64url)
 *   - jwk  : JWKS-shaped JSON for the /.well-known/audit-signing-key endpoint
 *            { kty: "OKP", crv: "Ed25519", kid: <16-char b64url sha256 prefix>,
 *              use: "sig", alg: "EdDSA", x: <pub b64url> }
 *
 * The private key file is written with mode 0600. The public material (kid +
 * pub b64url) is echoed to stdout so the operator can record it at issuance.
 *
 * Idempotency: refuses to overwrite an existing output file unless --force is
 * passed. Idempotency key = (out dir, format).
 *
 * Production: do NOT use this script's output directly in production. Mint
 * keys inside the KMS / secret manager (Railway, AWS KMS, GCP KMS) and inject
 * via env vars at deploy time. This script targets local + dev + staging.
 *
 *   pnpm --filter @aegis/scripts keys -- --format both --out ./.local/keys
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import { stdout, stderr, exit, argv } from 'node:process';

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { Command } from 'commander';

// @noble/ed25519 v2 needs sha512 wired for sync API; we use async, but wiring
// guards against accidental sync use.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ── Pure helpers (exported for tests) ─────────────────────────────

export function toB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromB64Url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

/**
 * Stable key id derived from the public key.
 * kid = first 16 chars of base64url(sha256(publicKey))
 *
 * Stability matters: peer module serves /.well-known/audit-signing-key and
 * relying parties cache by kid. Changing the derivation = breaking caches.
 */
export function deriveKid(publicKey: Uint8Array): string {
  const digest = sha256(publicKey);
  return toB64Url(digest).slice(0, 16);
}

export interface KeypairMaterial {
  privateKeyB64Url: string;
  publicKeyB64Url: string;
  kid: string;
}

export async function generateKeypair(): Promise<KeypairMaterial> {
  // ed.utils.randomPrivateKey() uses crypto.getRandomValues underneath — no Math.random.
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKeyB64Url: toB64Url(privateKey),
    publicKeyB64Url: toB64Url(publicKey),
    kid: deriveKid(publicKey),
  };
}

export interface JwkPublic {
  kty: 'OKP';
  crv: 'Ed25519';
  kid: string;
  use: 'sig';
  alg: 'EdDSA';
  x: string;
}

export function toJwkPublic(material: KeypairMaterial): JwkPublic {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    kid: material.kid,
    use: 'sig',
    alg: 'EdDSA',
    x: material.publicKeyB64Url,
  };
}

export function toEnvFile(material: KeypairMaterial, generatedAt: string): string {
  return [
    `# AEGIS internal Ed25519 audit-signing keypair`,
    `# generated: ${generatedAt}`,
    `# kid:       ${material.kid}`,
    `# DO NOT commit. Source via direnv or paste into your secret manager.`,
    ``,
    `AEGIS_SIGNING_PRIVATE_KEY=${material.privateKeyB64Url}`,
    `AEGIS_SIGNING_PUBLIC_KEY=${material.publicKeyB64Url}`,
    `AEGIS_SIGNING_KID=${material.kid}`,
    ``,
  ].join('\n');
}

// ── File I/O with idempotency ─────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

interface WriteOpts {
  outDir: string;
  format: 'env' | 'jwk' | 'both';
  force: boolean;
}

interface WriteResult {
  envPath?: string;
  jwkPath?: string;
}

export async function writeArtifacts(
  material: KeypairMaterial,
  opts: WriteOpts,
  now: () => Date = () => new Date(),
): Promise<WriteResult> {
  await mkdir(opts.outDir, { recursive: true });

  const envPath = join(opts.outDir, 'aegis-signing.env');
  const jwkPath = join(opts.outDir, 'aegis-signing.jwk.json');
  const generatedAt = now().toISOString();

  const targets: Array<{ path: string; body: string; emit: boolean }> = [
    {
      path: envPath,
      body: toEnvFile(material, generatedAt),
      emit: opts.format === 'env' || opts.format === 'both',
    },
    {
      path: jwkPath,
      body: `${JSON.stringify(toJwkPublic(material), null, 2)}\n`,
      emit: opts.format === 'jwk' || opts.format === 'both',
    },
  ];

  if (!opts.force) {
    for (const t of targets) {
      if (!t.emit) continue;
      if (await fileExists(t.path)) {
        throw new Error(
          `refusing to overwrite ${t.path} — re-run with --force to replace.`,
        );
      }
    }
  }

  const result: WriteResult = {};
  for (const t of targets) {
    if (!t.emit) continue;
    // 0600 for the env file (contains private key); 0644 for JWK (public only).
    const mode = t.path === envPath ? 0o600 : 0o644;
    await writeFile(t.path, t.body, { mode });
    if (t.path === envPath) result.envPath = t.path;
    else result.jwkPath = t.path;
  }
  return result;
}

// ── CLI ───────────────────────────────────────────────────────────

interface CliOpts {
  out: string;
  format: 'env' | 'jwk' | 'both';
  force: boolean;
}

function parseCli(args: string[]): CliOpts {
  const program = new Command()
    .name('generate-aegis-keys')
    .description('Mint AEGIS internal Ed25519 audit-signing keypair.')
    .option('--out <dir>', 'output directory', './.local/keys')
    .option('--format <kind>', 'env | jwk | both', 'both')
    .option('--force', 'overwrite existing files', false)
    .exitOverride();

  program.parse(args, { from: 'user' });
  const o = program.opts<{ out: string; format: string; force: boolean }>();

  if (o.format !== 'env' && o.format !== 'jwk' && o.format !== 'both') {
    throw new Error(`--format must be env|jwk|both, got "${o.format}"`);
  }
  return { out: resolve(o.out), format: o.format, force: o.force };
}

async function main(): Promise<void> {
  const cli = parseCli(argv.slice(2));
  const material = await generateKeypair();
  const written = await writeArtifacts(material, {
    outDir: cli.out,
    format: cli.format,
    force: cli.force,
  });

  // Emit a single structured line on success — public material only.
  const summary = {
    ok: true,
    kid: material.kid,
    publicKey: material.publicKeyB64Url,
    files: written,
  };
  stdout.write(`${JSON.stringify(summary)}\n`);
}

// Only run main when invoked as a script, not when imported by tests.
const invokedDirectly = (() => {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  // tsx + ESM: import.meta.url vs argv[1]
  try {
    const entryUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    exit(1);
  });
}
