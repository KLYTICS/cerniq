// Persistent credentials store. Lives at `~/.aegis/credentials.json`,
// mode 0600. NEVER includes private keys — only API keys, base URL,
// and the optional default principal id.
//
// Per ADR-0009 §6, the human-side credentials are short-lived; the dashboard
// re-exchanges Auth0 tokens for fresh API keys every 8 hours. The CLI
// shares the same credential file so `aegis whoami` reflects whatever
// the dashboard last wrote.

import { readFile, writeFile, mkdir, chmod, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AegisCredentials {
  apiKey: string;
  baseUrl: string;
  principalId?: string;
  /** When the API key expires. ISO. */
  expiresAt?: string;
  /** Free-form. Used by `aegis whoami` to render context. */
  label?: string;
}

const CREDS_PATH = join(homedir(), '.aegis', 'credentials.json');

export async function readCredentials(): Promise<AegisCredentials | null> {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    const raw = await readFile(CREDS_PATH, 'utf8');
    return JSON.parse(raw) as AegisCredentials;
  } catch {
    return null;
  }
}

// Mirrors the Go canonical CLI (`packages/cli/internal/config/config.go:80-103`):
// parent dir is created 0700, payload is written to a temp file at 0600,
// then atomically renamed onto CREDS_PATH. Two reasons this matters:
//   1) Previous impl wrote the file at default-umask perms (typically 0644)
//      and chmod'd it down afterward, leaving a window where the API key was
//      readable by other local users on shared hosts.
//   2) Atomic rename means a crash mid-save can't leave a half-written
//      credentials file that JSON.parse() then chokes on.
export async function writeCredentials(c: AegisCredentials): Promise<void> {
  const dir = dirname(CREDS_PATH);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Tighten dir mode in the already-exists case (mkdir's `mode` only applies
  // on creation). Cheap and idempotent.
  await chmod(dir, 0o700).catch(() => {});
  const tmp = CREDS_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(c, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(tmp, CREDS_PATH);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  // Belt-and-suspenders for the overwrite-existing-file case: if CREDS_PATH
  // pre-existed at looser perms, rename preserves the new inode's mode (0600)
  // but make it explicit.
  await chmod(CREDS_PATH, 0o600);
}

export function credentialsPath(): string {
  return CREDS_PATH;
}

/** Resolve creds with env-var override (`AEGIS_API_KEY`, `AEGIS_BASE_URL`). */
export async function resolveCredentials(): Promise<AegisCredentials | null> {
  const fromEnv = process.env.AEGIS_API_KEY;
  if (fromEnv) {
    return {
      apiKey: fromEnv,
      baseUrl: process.env.AEGIS_BASE_URL ?? 'https://api.aegis.dev',
      label: 'env',
    };
  }
  return await readCredentials();
}
