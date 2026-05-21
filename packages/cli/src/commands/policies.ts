import { client } from '../client.js';
import { emitJson, emitTable, ok } from '../output.js';
import { readFile } from 'node:fs/promises';

export async function policiesCreate(opts: { agentId: string; scopesFile: string; ttl?: number; json?: boolean }): Promise<void> {
  const raw = await readFile(opts.scopesFile, 'utf8');
  const scopes = JSON.parse(raw);
  const aegis = await client();
  const expiresAt = opts.ttl
    ? new Date(Date.now() + opts.ttl * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days default
  const policy = await aegis.policies.create(opts.agentId, {
    scopes,
    expiresAt,
  });
  ok(`policy created: ${policy.policyId}`);
  emitJson(policy);
}

export async function policiesList(opts: { agentId?: string; status?: string; json?: boolean }): Promise<void> {
  if (!opts.agentId) {
    throw new Error('--agent-id option is required');
  }
  const aegis = await client();
  const result = await aegis.policies.list(opts.agentId);
  if (opts.json) {
    emitJson({ policies: result });
    return;
  }
  emitTable(result.map((p) => ({ id: p.policyId, agent: opts.agentId, expires: p.expiresAt })));
}

export async function policiesRevoke(agentId: string, policyId: string, _opts: { reason?: string }): Promise<void> {
  const aegis = await client();
  await aegis.policies.revoke(agentId, policyId);
  ok(`policy revoked: ${policyId}`);
}
