import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

import { client } from '../client.js';
import { emitJson, emitTable, ok, info } from '../output.js';

import type { AgentRuntime } from '@cerniq/sdk';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

// API contract: RegisterAgentInput.runtime must be one of these literals.
// CLI accepts lowercase too for convenience and uppercases here.
const VALID_RUNTIMES: AgentRuntime[] = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'];

function normalizeRuntime(input: string | undefined): AgentRuntime {
  const v = (input ?? 'CUSTOM').toUpperCase();
  if (!(VALID_RUNTIMES as string[]).includes(v)) {
    throw new Error(`Invalid --runtime "${input}". Must be one of: ${VALID_RUNTIMES.join(', ')}.`);
  }
  return v as AgentRuntime;
}

export async function agentsCreate(opts: {
  name: string;
  runtime?: string;
  printPrivateKey?: boolean;
}): Promise<void> {
  // Generate a fresh keypair locally — CERNIQ never sees the private key.
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const cerniq = await client();
  // SDK method is `register` (matches POST /agents/register). The CLI keeps the
  // friendlier `create` verb. `--name` is plumbed to the API's `label` field
  // (RegisterAgentInput has no `name` — only `publicKey`, `runtime`,
  // `model?`, `label?`).
  const agent = await cerniq.agents.register({
    publicKey: b64u(pub),
    runtime: normalizeRuntime(opts.runtime),
    label: opts.name,
  });
  ok(`agent created: ${agent.agentId}`);
  emitJson(agent);
  if (opts.printPrivateKey) {
    info('PRIVATE KEY (store securely — CERNIQ never sees this):');
    process.stdout.write(b64u(priv) + '\n');
  } else {
    info('Re-run with --print-private-key to display the private key once.');
  }
}

export async function agentsList(opts: {
  limit?: number;
  cursor?: string;
  json?: boolean;
}): Promise<void> {
  const cerniq = await client();
  const result = await cerniq.agents.list({ limit: opts.limit, cursor: opts.cursor });
  if (opts.json) {
    emitJson(result);
    return;
  }
  emitTable(
    result.agents.map((a) => ({
      id: a.agentId,
      label: a.label ?? '',
      runtime: a.runtime,
      status: a.status,
      score: a.trustScore,
      band: a.trustBand,
    })),
  );
  if (result.nextCursor) {
    info(`More results: --cursor ${result.nextCursor}  (total ${result.total})`);
  }
}

export async function agentsGet(id: string, opts: { json?: boolean }): Promise<void> {
  const cerniq = await client();
  const agent = await cerniq.agents.get(id);
  if (opts.json) emitJson(agent);
  else emitJson(agent);
}

export async function agentsRevoke(id: string): Promise<void> {
  // API endpoint `DELETE /agents/:id` takes no body. The previous CLI
  // `--reason` flag was a no-op (silently dropped). Removed to avoid
  // promising functionality that doesn't reach the API. To plumb a real
  // reason through, add it to the API DTO + SDK + here in one PR.
  const cerniq = await client();
  await cerniq.agents.revoke(id);
  ok(`agent revoked: ${id}`);
}
