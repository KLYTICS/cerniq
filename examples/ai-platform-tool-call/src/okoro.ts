// Tiny helper for the example. Reads OKORO_API_KEY + OKORO_BASE_URL
// from env and constructs an SDK client.

import { Okoro } from '@okoro/sdk';

export function okoro(): Okoro {
  const apiKey = process.env.OKORO_API_KEY;
  if (!apiKey) throw new Error('OKORO_API_KEY env required');
  return new Okoro({
    apiKey,
    baseUrl: process.env.OKORO_BASE_URL ?? 'https://api.okoro.dev',
  });
}
