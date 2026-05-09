// Lazy AEGIS SDK construction. The CLI calls `await client()` at the top
// of each command; we don't construct a global so commands can be
// independently testable.

import { Aegis } from '@aegis/sdk';
import { resolveCredentials } from './credentials.js';

export async function client(): Promise<Aegis> {
  const creds = await resolveCredentials();
  if (!creds) {
    throw new CliError('not_logged_in', 'Run `aegis bootstrap` or set AEGIS_API_KEY env.');
  }
  return new Aegis({ apiKey: creds.apiKey, baseUrl: creds.baseUrl });
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
