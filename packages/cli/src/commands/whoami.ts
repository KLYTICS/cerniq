import { resolveCredentials, credentialsPath } from '../credentials.js';
import { info, err } from '../output.js';

export async function whoami(): Promise<void> {
  const creds = await resolveCredentials();
  if (!creds) {
    err('not logged in. run `aegis bootstrap`.');
    process.exit(1);
  }
  info(`base   : ${creds.baseUrl}`);
  info(`apiKey : ${creds.apiKey.slice(0, 14)}…`);
  info(`source : ${creds.label === 'env' ? 'AEGIS_API_KEY env' : credentialsPath()}`);
  if (creds.principalId) info(`principal: ${creds.principalId}`);
  if (creds.expiresAt) info(`expires : ${creds.expiresAt}`);
}
