import { readFile } from 'node:fs/promises';

import { client } from '../client.js';
import { emitJson, emitTable, ok } from '../output.js';

export async function policiesCreate(opts: {
  agentId: string;
  scopesFile: string;
  ttl?: number;
  json?: boolean;
}): Promise<void> {
  const raw = await readFile(opts.scopesFile, 'utf8');
  const scopes = JSON.parse(raw);
  const cerniq = await client();
  const policy = await cerniq.policies.create({
    agentId: opts.agentId,
    scopes,
    expiresInSeconds: opts.ttl,
  });
  ok(`policy created: ${(policy as { id: string }).id}`);
  emitJson(policy);
}

export async function policiesList(opts: {
  agentId?: string;
  status?: string;
  json?: boolean;
}): Promise<void> {
  const cerniq = await client();
  const result = (await cerniq.policies.list({
    agentId: opts.agentId,
    status: opts.status as 'ACTIVE' | 'REVOKED' | 'EXPIRED' | undefined,
  })) as { policies: { id: string; agentId: string; status: string; expiresAt: string }[] };
  if (opts.json) emitJson(result);
  else
    emitTable(
      result.policies.map((p) => ({
        id: p.id,
        agent: p.agentId,
        status: p.status,
        expires: p.expiresAt,
      })),
    );
}

export async function policiesRevoke(id: string, opts: { reason?: string }): Promise<void> {
  const cerniq = await client();
  await cerniq.policies.revoke(id, { reason: opts.reason });
  ok(`policy revoked: ${id}`);
}
