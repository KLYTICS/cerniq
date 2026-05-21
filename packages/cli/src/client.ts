// Lazy AEGIS SDK construction. The CLI calls `await client()` at the top
// of each command; we don't construct a global so commands can be
// independently testable.

import { Aegis } from '@aegis/sdk';

import { resolveCredentials, type AegisCredentials } from './credentials.js';

async function requireCreds(): Promise<AegisCredentials> {
  const creds = await resolveCredentials();
  if (!creds) {
    throw new CliError('not_logged_in', 'Run `aegis bootstrap` or set AEGIS_API_KEY env.');
  }
  return creds;
}

export async function client(): Promise<Aegis> {
  const creds = await requireCreds();
  return new Aegis({ apiKey: creds.apiKey, baseUrl: creds.baseUrl });
}

/**
 * Raw GET against an absolute API path (e.g. `/v1/audit-events?...`). Used
 * by CLI commands that hit endpoints the SDK does not yet model (audit
 * search, JWKS, agent list). Goes around the typed SDK on purpose — keep
 * the surface narrow so the SDK can evolve without breaking the CLI.
 */
export async function rawJson<T = unknown>(path: string): Promise<T> {
  const creds = await requireCreds();
  const url = `${creds.baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : '/' + path}`;
  const res = await fetch(url, {
    headers: {
      'X-AEGIS-API-Key': creds.apiKey,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CliError(`http_${res.status}`, `${res.status} ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as T;
}

export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
