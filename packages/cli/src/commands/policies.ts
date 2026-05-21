import { readFile } from 'node:fs/promises';
import type { PolicyScope } from '@aegis/sdk';
import { CliError, client } from '../client.js';
import { emit, emitRecord, ok, warn } from '../output.js';

const DEFAULT_TTL_SECONDS = 86_400;

export async function policiesCreate(
  opts: { agentId: string; scopesFile: string; ttl?: number; json?: boolean },
): Promise<void> {
  const raw = await readFile(opts.scopesFile, 'utf8');
  const scopes = JSON.parse(raw) as PolicyScope[];
  const ttl = opts.ttl ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const aegis = await client();
  const policy = await aegis.policies.create(opts.agentId, { scopes, expiresAt });
  ok(`policy created: ${policy.policyId}`);
  emitRecord(policy as unknown as Record<string, unknown>);
}

export async function policiesList(
  opts: { agentId?: string; status?: string; json?: boolean },
): Promise<void> {
  if (!opts.agentId) {
    throw new CliError('missing_agent_id', '--agent-id is required (SDK list is per-agent).');
  }
  if (opts.status) {
    warn(`status filter is not yet plumbed through the SDK; returning all policies for ${opts.agentId}.`);
  }
  const aegis = await client();
  const policies = await aegis.policies.list(opts.agentId);
  emit(
    { agentId: opts.agentId, policies },
    policies.map((p) => ({ policyId: p.policyId, expiresAt: p.expiresAt })),
  );
}

export async function policiesRevoke(
  policyId: string,
  opts: { agentId?: string; reason?: string },
): Promise<void> {
  if (!opts.agentId) {
    throw new CliError(
      'missing_agent_id',
      '--agent-id is required (revoke endpoint is /agents/:agentId/policies/:policyId).',
    );
  }
  if (opts.reason) {
    warn(`reason not persisted by SDK: ${opts.reason}`);
  }
  const aegis = await client();
  await aegis.policies.revoke(opts.agentId, policyId);
  ok(`policy revoked: ${policyId}`);
}
