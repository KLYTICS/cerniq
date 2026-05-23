// Persistent credentials store. Lives at `~/.cerniq/credentials.json`,
// mode 0600. NEVER includes private keys — only API keys, base URL,
// and the optional default principal id.
//
// Per ADR-0009 §6, the human-side credentials are short-lived; the dashboard
// re-exchanges Auth0 tokens for fresh API keys every 8 hours. The CLI
// shares the same credential file so `cerniq whoami` reflects whatever
// the dashboard last wrote.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CerniqCredentials {
  apiKey: string;
  baseUrl: string;
  principalId?: string;
  /** When the API key expires. ISO. */
  expiresAt?: string;
  /** Free-form. Used by `cerniq whoami` to render context. */
  label?: string;
}

const CREDS_PATH = join(homedir(), '.cerniq', 'credentials.json');

export async function readCredentials(): Promise<CerniqCredentials | null> {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    const raw = await readFile(CREDS_PATH, 'utf8');
    return JSON.parse(raw) as CerniqCredentials;
  } catch {
    return null;
  }
}

export async function writeCredentials(c: CerniqCredentials): Promise<void> {
  await mkdir(dirname(CREDS_PATH), { recursive: true });
  await writeFile(CREDS_PATH, JSON.stringify(c, null, 2) + '\n', 'utf8');
  await chmod(CREDS_PATH, 0o600);
}

export function credentialsPath(): string {
  return CREDS_PATH;
}

/** Resolve creds with env-var override (`CERNIQ_API_KEY`, `CERNIQ_BASE_URL`). */
export async function resolveCredentials(): Promise<CerniqCredentials | null> {
  const fromEnv = process.env.CERNIQ_API_KEY;
  if (fromEnv) {
    return {
      apiKey: fromEnv,
      baseUrl: process.env.CERNIQ_BASE_URL ?? 'https://api.cerniq.dev',
      label: 'env',
    };
  }
  return await readCredentials();
}
