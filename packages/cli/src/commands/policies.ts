import { client } from '../client.js';
import { emitJson, emitTable, ok } from '../output.js';
import { readFile } from 'node:fs/promises';

/**
 * Create an agent policy.
 *
 * Mirrors `PolicyClient.create(agentId, input)` in @aegis/sdk:
 *   - `agentId` is a positional arg (the SDK uses it to build the URL).
 *   - The SDK takes an absolute `expiresAt` (ISO string or Date), not a
 *     relative TTL — we convert here so the CLI's `--ttl <seconds>` UX
 *     keeps working.
 */
export async function policiesCreate(opts: {
  agentId: string;
  scopesFile: string;
  ttl?: number;
  json?: boolean;
}): Promise<void> {
  const raw = await readFile(opts.scopesFile, 'utf8');
  const scopes = JSON.parse(raw);
  const aegis = await client();
  // `--ttl` defaults to 24h via Commander in bin.ts. Convert to ISO so
  // we pass an absolute deadline; the SDK accepts Date | string.
  const ttlSeconds = opts.ttl ?? 86_400;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const policy = await aegis.policies.create(opts.agentId, { scopes, expiresAt });
  ok(`policy created: ${policy.policyId}`);
  emitJson(policy);
}

/**
 * List policies for an agent.
 *
 * The SDK's `list(agentId)` returns `PolicyRecord[]` directly — no
 * wrapper object, no server-side status filter. PolicyRecord exposes
 * `{ policyId, signedToken, expiresAt }`. We display the columns we
 * have; per-agent listing is implied (no agent column needed).
 */
export async function policiesList(opts: {
  agentId: string;
  status?: string;
  json?: boolean;
}): Promise<void> {
  const aegis = await client();
  const policies = await aegis.policies.list(opts.agentId);
  if (opts.json) {
    emitJson({ policies });
    return;
  }
  if (opts.status) {
    process.stderr.write(
      'warning: --status is no longer supported by the SDK list endpoint; ignoring filter.\n',
    );
  }
  emitTable(policies.map((p) => ({ policyId: p.policyId, expires: p.expiresAt })));
}

/**
 * Revoke a policy.
 *
 * `PolicyClient.revoke(agentId, policyId)` takes both IDs positionally;
 * there is no `--reason` field on the SDK call. The CLI keeps accepting
 * `--reason` as a no-op flag with a deprecation warning so existing
 * scripts don't break — drop the flag entry in bin.ts once downstream
 * tooling has caught up.
 */
export async function policiesRevoke(
  policyId: string,
  opts: { agentId: string; reason?: string },
): Promise<void> {
  if (opts.reason) {
    process.stderr.write(
      'warning: --reason is no longer supported by the SDK revoke endpoint; ignoring.\n',
    );
  }
  const aegis = await client();
  await aegis.policies.revoke(opts.agentId, policyId);
  ok(`policy revoked: ${policyId}`);
}
