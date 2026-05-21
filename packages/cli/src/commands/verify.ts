// `aegis verify <token>` — relying-party-style verification from the CLI.
//
// Useful when an integrator wants to sanity-check what AEGIS thinks of a
// token they just received, without writing a script. The CLI runs the
// SDK's `verify()` path against the configured base URL using the
// VERIFY-ONLY key when present (and warns if it falls back to the
// management key — the verify edge should never see a management key
// in production per `tools/quickstart/src/index.ts:23-26`).

import { Aegis } from '@aegis/sdk';
import { CliError } from '../client.js';
import { resolveCredentials } from '../credentials.js';
import { emitRecord, warn } from '../output.js';

export interface VerifyOptions {
  action?: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
  merchantId?: string;
}

export async function verify(token: string, opts: VerifyOptions): Promise<void> {
  if (!token || token.length < 10) {
    throw new CliError('invalid_token', 'token argument is required and must be a JWT.');
  }
  const creds = await resolveCredentials();
  if (!creds) {
    throw new CliError('not_logged_in', 'Run `aegis bootstrap` or set AEGIS_API_KEY env.');
  }
  // AEGIS verifies through the verify-only key. If the operator only has
  // a management key we still call /verify (the API accepts both), but we
  // warn so it's visible in scripts that the production flow should split
  // keys.
  const verifyKey = process.env.AEGIS_VERIFY_KEY ?? creds.apiKey;
  if (verifyKey === creds.apiKey) {
    warn('Using management key for verify. In production set AEGIS_VERIFY_KEY to the verify-only key (aegis_vk_*).');
  }

  const aegis = new Aegis({
    apiKey: creds.apiKey,
    verifyKey,
    baseUrl: creds.baseUrl,
  });

  const result = await aegis.verify(token, {
    ...(opts.action !== undefined ? { action: opts.action } : {}),
    ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
    ...(opts.currency !== undefined ? { currency: opts.currency } : {}),
    ...(opts.merchantDomain !== undefined ? { merchantDomain: opts.merchantDomain } : {}),
    ...(opts.merchantId !== undefined ? { merchantId: opts.merchantId } : {}),
  });

  emitRecord({
    valid: result.valid,
    decision: result.valid ? 'APPROVED' : 'DENIED',
    denialReason: result.denialReason ?? '',
    agentId: result.agentId ?? '',
    trustScore: result.trustScore,
    trustBand: result.trustBand ?? '',
    scopesGranted: result.scopesGranted,
    ttl: result.ttl,
    verifiedAt: result.verifiedAt,
  });

  // Non-success verify is a DENY, not an exception. Exit code reflects:
  //   - APPROVED → 0
  //   - DENIED   → 22 (CLI-domain code; out of the AegisError 4–13 range)
  if (!result.valid) process.exit(22);
}
