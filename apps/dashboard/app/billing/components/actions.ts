'use server';

// Server Actions for the Billing page.
// Wrap api-client calls so the secret-bearing fetch stays server-side
// (CLAUDE.md invariant 1 + the api-client doc-comment).

import { CerniqApiError, CerniqAuthMissingError, createCheckout } from '../../../lib/api-client';

export async function startCheckout(
  planTier: 'DEVELOPER' | 'GROWTH',
): Promise<{ url: string; error?: undefined } | { url?: undefined; error: string }> {
  try {
    const result = await createCheckout(planTier);
    return { url: result.url };
  } catch (err) {
    if (err instanceof CerniqAuthMissingError) {
      return { error: 'Dashboard not authorized — set CERNIQ_DASHBOARD_API_KEY.' };
    }
    if (err instanceof CerniqApiError) {
      return { error: `${err.code}: ${err.message}` };
    }
    return { error: (err as Error).message ?? 'Checkout failed.' };
  }
}
