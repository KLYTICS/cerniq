// Persistent credentials store. Lives at `~/.okoro/credentials.json`,
// mode 0600. NEVER includes private keys — only API keys, base URL,
// and the optional default principal id.
//
// Per ADR-0009 §6, the human-side credentials are short-lived; the dashboard
// re-exchanges Auth0 tokens for fresh API keys every 8 hours. The CLI
// shares the same credential file so `okoro whoami` reflects whatever
// the dashboard last wrote.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface OkoroCredentials {
  apiKey: string;
  baseUrl: string;
  principalId?: string;
  /** When the API key expires. ISO. */
  expiresAt?: string;
  /** Free-form. Used by `okoro whoami` to render context. */
  label?: string;
}

const CREDS_PATH = join(homedir(), '.okoro', 'credentials.json');

export async function readCredentials(): Promise<OkoroCredentials | null> {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    const raw = await readFile(CREDS_PATH, 'utf8');
    return JSON.parse(raw) as OkoroCredentials;
  } catch {
    return null;
  }
}

export async function writeCredentials(c: OkoroCredentials): Promise<void> {
  await mkdir(dirname(CREDS_PATH), { recursive: true });
  await writeFile(CREDS_PATH, JSON.stringify(c, null, 2) + '\n', 'utf8');
  await chmod(CREDS_PATH, 0o600);
}

export function credentialsPath(): string {
  return CREDS_PATH;
}

/** Resolve creds with env-var override (`OKORO_API_KEY`, `OKORO_BASE_URL`). */
export async function resolveCredentials(): Promise<OkoroCredentials | null> {
  const fromEnv = process.env.OKORO_API_KEY;
  if (fromEnv) {
    return {
      apiKey: fromEnv,
      baseUrl: process.env.OKORO_BASE_URL ?? 'https://api.okoro.dev',
      label: 'env',
    };
  }
  return await readCredentials();
}
