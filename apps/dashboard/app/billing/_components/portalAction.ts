'use server';

// Server Action wrapper for /v1/billing/portal.
//
// The portal endpoint does not yet ship in the CERNIQ API (Round 21
// follow-up). To avoid crashing the dashboard when this lane lands first,
// we degrade gracefully: HTTP 404 → `{ unavailable: true }`, any other
// failure → `{ error }`. The ManageButton renders an explanatory message
// in the unavailable case rather than a fake URL.

import 'server-only';

import { getSessionApiKey } from '../../../lib/auth';

const CERNIQ_HEADER_API_KEY = 'X-CERNIQ-API-Key';

export type PortalResult =
  | { url: string }
  | { unavailable: true; reason: string }
  | { error: string };

export async function openPortal(returnUrl: string): Promise<PortalResult> {
  const apiKey = await getSessionApiKey();
  if (!apiKey) {
    return { error: 'Dashboard not authorized — set CERNIQ_DASHBOARD_API_KEY.' };
  }
  const baseUrl = process.env.CERNIQ_API_BASE_URL ?? 'http://localhost:4000';
  const baseNorm = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const target = new URL('v1/billing/portal', baseNorm).toString();

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CERNIQ_HEADER_API_KEY]: apiKey,
      },
      body: JSON.stringify({ returnUrl }),
      cache: 'no-store',
    });
  } catch (err) {
    return { error: (err as Error).message ?? 'Network error.' };
  }

  if (res.status === 404) {
    return {
      unavailable: true,
      reason: 'Customer portal endpoint not yet deployed (Round 21 follow-up).',
    };
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      // type-rationale: API error envelope is loosely typed across versions;
      // we only read .message defensively.
      const body = (await res.json()) as { message?: string; code?: string };
      if (body.message) detail = body.message;
    } catch {
      // fall through with HTTP status
    }
    return { error: detail };
  }

  // type-rationale: API contract is `{ url: string }`; we validate at runtime.
  const data = (await res.json()) as { url?: unknown };
  if (typeof data.url !== 'string' || data.url.length === 0) {
    return { error: 'Portal endpoint returned no URL.' };
  }
  return { url: data.url };
}
