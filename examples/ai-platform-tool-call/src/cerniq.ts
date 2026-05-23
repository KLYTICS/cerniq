// Tiny helper for the example. Reads CERNIQ_API_KEY + CERNIQ_BASE_URL
// from env and constructs an SDK client.

import { Cerniq } from '@cerniq/sdk';

export function cerniq(): Cerniq {
  const apiKey = process.env.CERNIQ_API_KEY;
  if (!apiKey) throw new Error('CERNIQ_API_KEY env required');
  return new Cerniq({
    apiKey,
    baseUrl: process.env.CERNIQ_BASE_URL ?? 'https://api.cerniq.dev',
  });
}
