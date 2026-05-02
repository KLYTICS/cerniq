// Seeding helpers. Where possible, fixtures call PRODUCTION code paths
// (controllers via Supertest) instead of inserting rows directly — that
// way the e2e suite catches drift between the wire shape and the storage
// shape. Direct DB writes are reserved for state the API doesn't expose
// (creating a Principal, forcing a `FLAGGED` trustBand for the
// ANOMALY_FLAGGED precedence test, etc.).

import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { ApiKeyService } from '../../../src/modules/auth/api-key.service';
import type { PrismaService } from '../../../src/common/prisma/prisma.service';
import type { AppConfigService } from '../../../src/config/config.service';

import type { SupertestHttp } from './test-app';

export interface SeededPrincipal {
  principalId: string;
  apiKey: string;
  apiKeyId: string;
  email: string;
}

/**
 * Create a Principal + a FULL-scope ApiKey via the production
 * ApiKeyService so the bcrypt hash matches what api-key.guard expects.
 *
 * We instantiate ApiKeyService manually (rather than getting it from the
 * Nest container) because the principalsModule / signup flow isn't on the
 * wire surface yet — direct invocation gives us a real key without a
 * stubbed guard.
 */
export async function seedPrincipalAndApiKey(
  prisma: PrismaService | PrismaClient,
  config: AppConfigService,
  options: { email?: string; label?: string | null; scope?: 'FULL' | 'VERIFY_ONLY' } = {},
): Promise<SeededPrincipal> {
  const email = options.email ?? `e2e-${randomUUID()}@aegis.test`;
  const principal = await prisma.principal.create({
    data: { email, name: 'E2E Test', emailVerified: true },
  });

  // Reuse the real service so the bcrypt hash + prefix invariant cannot
  // drift. type-rationale: ApiKeyService takes the concrete PrismaService
  // class as its first arg, but the public methods only touch
  // `prisma.apiKey.*` which the test PrismaService satisfies fully.
  const svc = new ApiKeyService(prisma as PrismaService, config);
  const issued = await svc.issue(principal.id, options.label ?? 'e2e-key', options.scope ?? 'FULL');

  return {
    principalId: principal.id,
    apiKey: issued.plaintextKey,
    apiKeyId: issued.apiKeyId,
    email,
  };
}

export interface SeededAgent {
  agentId: string;
  publicKey: string;
}

/**
 * Register an agent through the public HTTP surface. We pass the API key
 * in the same header production uses so any breakage in the auth chain
 * surfaces here, not silently in a unit test.
 */
export async function registerAgentViaApi(
  http: SupertestHttp,
  apiKey: string,
  body: { publicKey: string; runtime: string; label?: string; model?: string },
): Promise<SeededAgent> {
  const res = await http
    .post('/v1/agents/register')
    .set('X-AEGIS-API-Key', apiKey)
    .send(body);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`registerAgent failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { agentId: res.body.agentId, publicKey: res.body.publicKey };
}

export interface SeededPolicy {
  policyId: string;
  signedToken: string;
  expiresAt: string;
}

/**
 * Same idea as registerAgentViaApi — exercise the controller, not the
 * service. The default scope is `commerce` with a $100 cap to match the
 * full-flow narrative.
 */
export async function createPolicyViaApi(
  http: SupertestHttp,
  apiKey: string,
  agentId: string,
  body: {
    scopes: Array<{
      category: string;
      spendLimit?: { currency: string; maxPerTransaction?: number; maxPerDay?: number; maxPerMonth?: number };
      allowedDomains?: string[];
      merchantCategories?: string[];
    }>;
    expiresAt: string;
    label?: string;
  },
): Promise<SeededPolicy> {
  const res = await http
    .post(`/v1/agents/${agentId}/policies`)
    .set('X-AEGIS-API-Key', apiKey)
    .send(body);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createPolicy failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return {
    policyId: res.body.policyId,
    signedToken: res.body.signedToken,
    expiresAt: res.body.expiresAt,
  };
}

/** ISO timestamp `n` days in the future. */
export function isoInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** ISO timestamp `n` seconds in the future (negative for past). */
export function isoInSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
