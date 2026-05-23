import { readFile } from 'node:fs/promises';

import { client } from '../client.js';
import { emitJson, emitTable, ok } from '../output.js';

export async function policiesCreate(opts: {
  agentId: string;
  scopesFile: string;
  ttl?: number;
  label?: string;
  json?: boolean;
}): Promise<void> {
  const raw = await readFile(opts.scopesFile, 'utf8');
  const scopes = JSON.parse(raw);
  const ttlSeconds = opts.ttl ?? 86400;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const cerniq = await client();
  // SDK signature: create(agentId, { label?, scopes, expiresAt }).
  // agentId is path-positional in the API (POST /agents/:agentId/policies),
  // not part of the body — so the SDK takes it as a separate arg.
  const policy = await cerniq.policies.create(opts.agentId, {
    label: opts.label,
    scopes,
    expiresAt,
  });
  ok(`policy created: ${policy.policyId}`);
  emitJson(policy);
}

export async function policiesList(opts: { agentId: string; json?: boolean }): Promise<void> {
  // SDK `list(agentId)` returns `PolicyRecord[]` (not `{ policies: [...] }`).
  // The API endpoint is `GET /agents/:agentId/policies`, so agentId is
  // required — there's no "list all policies across all agents" surface.
  // No status filter (the API returns active policies only; revoked/expired
  // are surfaced via the audit log).
  const cerniq = await client();
  const policies = await cerniq.policies.list(opts.agentId);
  if (opts.json) {
    emitJson(policies);
    return;
  }
  emitTable(
    policies.map((p) => ({
      id: p.policyId,
      expires: p.expiresAt,
    })),
  );
}

export async function policiesRevoke(policyId: string, opts: { agentId: string }): Promise<void> {
  // SDK `revoke(agentId, policyId)` — both required because the API endpoint
  // is `DELETE /agents/:agentId/policies/:policyId`. CLI's prior `--reason`
  // flag was a no-op (not in API contract); removed.
  const cerniq = await client();
  await cerniq.policies.revoke(opts.agentId, policyId);
  ok(`policy revoked: ${policyId}`);
}
