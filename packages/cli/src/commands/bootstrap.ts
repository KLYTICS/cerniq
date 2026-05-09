import prompts from 'prompts';
import { writeCredentials, credentialsPath, readCredentials } from '../credentials.js';
import { info, ok, warn } from '../output.js';

export async function bootstrap(opts: { apiKey?: string; baseUrl?: string; force?: boolean } = {}): Promise<void> {
  const existing = await readCredentials();
  if (existing && !opts.force) {
    warn(`Credentials already exist at ${credentialsPath()}. Use --force to overwrite.`);
    return;
  }

  let apiKey = opts.apiKey;
  let baseUrl = opts.baseUrl ?? 'https://api.aegis.dev';

  if (!apiKey) {
    const r = await prompts([
      { type: 'password', name: 'apiKey', message: 'AEGIS API key (aegis_live_… or aegis_test_…)', validate: (s) => s.length > 8 || 'too short' },
      { type: 'text', name: 'baseUrl', message: 'AEGIS base URL', initial: baseUrl },
    ]);
    apiKey = r.apiKey;
    baseUrl = r.baseUrl ?? baseUrl;
  }

  if (!apiKey) {
    throw new Error('cancelled');
  }

  await writeCredentials({ apiKey, baseUrl });
  ok(`Credentials written to ${credentialsPath()}`);
  info('Run `aegis whoami` to verify.');
}
