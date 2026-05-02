/**
 * Test fixtures — deterministic helpers around agent / policy / token setup.
 *
 * Every helper returns the *minimum* an assertion needs and never hides
 * the SDK behind cleverness. If a test wants to inspect raw HTTP, use
 * RawClient directly.
 */

import { generateKeypair, signAgentToken } from '@aegis/sdk';
import type { Aegis } from '@aegis/sdk';
import type { AgentRecord, PolicyScope, SignContext } from '@aegis/sdk';
import { randomUUID } from 'node:crypto';

export interface AgentFixture {
  agentId: string;
  publicKey: string;
  privateKey: string;
  record: AgentRecord;
}

export interface PolicyFixture {
  policyId: string;
  signedToken: string;
  expiresAt: string;
}

/**
 * A unique label suffix per call. Tests run sequentially against a single
 * API instance; deterministic but unique avoids `409 CONFLICT` on retries.
 */
export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export function futureIso(secondsFromNow = 60 * 60): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

export function pastIso(secondsAgo = 60): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

export async function createAgent(
  sdk: Aegis,
  opts: { runtime?: 'openai' | 'anthropic' | 'google' | 'custom'; label?: string } = {},
): Promise<AgentFixture> {
  const kp = await generateKeypair();
  const record = await sdk.agents.register({
    publicKey: kp.publicKey,
    runtime: (opts.runtime ?? 'anthropic').toUpperCase() as never,
    label: opts.label ?? `e2e-agent-${uniqueSuffix()}`,
  });
  return { agentId: record.agentId, publicKey: kp.publicKey, privateKey: kp.privateKey, record };
}

export async function createPolicy(
  sdk: Aegis,
  agentId: string,
  scopes: PolicyScope[],
  opts: { expiresAt?: string; label?: string } = {},
): Promise<PolicyFixture> {
  const policy = await sdk.policies.create(agentId, {
    scopes,
    expiresAt: opts.expiresAt ?? futureIso(),
    label: opts.label ?? `e2e-policy-${uniqueSuffix()}`,
  });
  return { policyId: policy.policyId, signedToken: policy.signedToken, expiresAt: policy.expiresAt };
}

/**
 * Common scope shape used across denial tests.
 */
export const SCOPES = {
  commerce(opts: { maxPerTransaction?: number; maxPerDay?: number; allowedDomains?: string[] } = {}): PolicyScope {
    return {
      category: 'commerce',
      spendLimit: {
        currency: 'USD',
        ...(opts.maxPerTransaction !== undefined ? { maxPerTransaction: opts.maxPerTransaction } : {}),
        ...(opts.maxPerDay !== undefined ? { maxPerDay: opts.maxPerDay } : { maxPerDay: 1000 }),
      },
      ...(opts.allowedDomains ? { allowedDomains: opts.allowedDomains } : {}),
    };
  },
  dataRead(scopes: string[] = ['read:calendar']): PolicyScope {
    return { category: 'data-read', dataScopes: scopes };
  },
};

/**
 * Sign a per-request agent token using the SDK's client-side signer.
 *
 * We use this everywhere instead of a server-side /v1/token/sign endpoint —
 * AEGIS by design never sees a private key, so test tokens are signed
 * locally.
 */
export async function signTokenFor(
  agent: AgentFixture,
  policyId: string,
  ctx: SignContext,
): Promise<string> {
  return signAgentToken(agent.privateKey, agent.agentId, policyId, ctx);
}

/**
 * Tamper a compact JWS — flip one byte in the signature segment so the
 * Ed25519 verify is guaranteed to fail without changing token shape.
 */
export function tamperToken(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a compact JWS');
  const sig = parts[2]!;
  // Flip the first base64url char to one that's still valid alphabet.
  const swapped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  return `${parts[0]}.${parts[1]}.${swapped}`;
}
