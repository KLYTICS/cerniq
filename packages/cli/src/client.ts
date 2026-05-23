// Lazy CERNIQ SDK construction. The CLI calls `await client()` at the top
// of each command; we don't construct a global so commands can be
// independently testable.

import { Cerniq } from '@cerniq/sdk';

import { resolveCredentials } from './credentials.js';

export async function client(): Promise<Cerniq> {
  const creds = await resolveCredentials();
  if (!creds) {
    throw new CliError('not_logged_in', 'Run `cerniq bootstrap` or set CERNIQ_API_KEY env.');
  }
  return new Cerniq({ apiKey: creds.apiKey, baseUrl: creds.baseUrl });
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
