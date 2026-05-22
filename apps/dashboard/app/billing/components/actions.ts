'use server';

// Server Actions for the Billing page.
// Wrap api-client calls so the secret-bearing fetch stays server-side
// (CLAUDE.md invariant 1 + the api-client doc-comment).

import { OkoroApiError, OkoroAuthMissingError, createCheckout } from '../../../lib/api-client';

export async function startCheckout(
  planTier: 'DEVELOPER' | 'GROWTH',
): Promise<{ url: string; error?: undefined } | { url?: undefined; error: string }> {
  try {
    const result = await createCheckout(planTier);
    return { url: result.url };
  } catch (err) {
    if (err instanceof OkoroAuthMissingError) {
      return { error: 'Dashboard not authorized — set OKORO_DASHBOARD_API_KEY.' };
    }
    if (err instanceof OkoroApiError) {
      return { error: `${err.code}: ${err.message}` };
    }
    return { error: (err as Error).message ?? 'Checkout failed.' };
  }
}
