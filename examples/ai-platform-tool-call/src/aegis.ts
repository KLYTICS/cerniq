// Tiny helper for the example. Reads AEGIS_API_KEY + AEGIS_BASE_URL
// from env and constructs an SDK client.

import { Aegis } from '@aegis/sdk';

export function aegis(): Aegis {
  const apiKey = process.env.AEGIS_API_KEY;
  if (!apiKey) throw new Error('AEGIS_API_KEY env required');
  return new Aegis({
    apiKey,
    baseUrl: process.env.AEGIS_BASE_URL ?? 'https://api.aegis.dev',
  });
}
