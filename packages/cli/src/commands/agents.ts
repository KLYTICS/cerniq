import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import type { AgentRecord, AgentRuntime } from '@aegis/sdk';
import { client, rawJson } from '../client.js';
import { emitJson, emitTable, ok, info, warn } from '../output.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const VALID_RUNTIMES: readonly AgentRuntime[] = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'];

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function parseRuntime(raw: string | undefined): AgentRuntime {
  const candidate = (raw ?? 'CUSTOM').toUpperCase() as AgentRuntime;
  return VALID_RUNTIMES.includes(candidate) ? candidate : 'CUSTOM';
}

export async function agentsCreate(opts: { name: string; runtime?: string; printPrivateKey?: boolean }): Promise<void> {
  // Generate a fresh keypair locally — AEGIS never sees the private key.
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const aegis = await client();
  const agent = await aegis.agents.register({
    publicKey: b64u(pub),
    runtime: parseRuntime(opts.runtime),
    label: opts.name,
  });
  ok(`agent created: ${agent.agentId}`);
  emitJson(agent);
  if (opts.printPrivateKey) {
    info('PRIVATE KEY (store securely — AEGIS never sees this):');
    process.stdout.write(b64u(priv) + '\n');
  } else {
    info('Re-run with --print-private-key to display the private key once.');
  }
}

interface AgentListResponse {
  agents: AgentRecord[];
  nextCursor?: string | null;
}

export async function agentsList(opts: { limit?: number; cursor?: string; json?: boolean }): Promise<void> {
  // SDK has no `agents.list()` yet — go through the raw helper. The
  // endpoint shape is the API's `GET /v1/agents` list response.
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  const result = await rawJson<AgentListResponse>(`/v1/agents${qs ? `?${qs}` : ''}`);
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
}

export async function agentsGet(id: string, opts: { json?: boolean }): Promise<void> {
  const aegis = await client();
  const agent = await aegis.agents.get(id);
  // `--json` is the explicit machine path; default is also JSON for now
  // because agent records have no obvious row-projection. Honor the flag
  // either way so future row-formatted output can land without breaking
  // pipelines.
  void opts;
  emitJson(agent);
}

export async function agentsRevoke(id: string, opts: { reason?: string }): Promise<void> {
  const aegis = await client();
  if (opts.reason) {
    // SDK revoke() does not yet plumb a reason body. Surface that so
    // operators don't assume it persisted to the audit row.
    warn(`reason not persisted by SDK: ${opts.reason}`);
  }
  await aegis.agents.revoke(id);
  ok(`agent revoked: ${id}`);
}
