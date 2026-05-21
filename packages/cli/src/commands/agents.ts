import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

import { client } from '../client.js';
import { emitJson, emitTable, ok, info } from '../output.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export async function agentsCreate(opts: { name: string; runtime?: string; printPrivateKey?: boolean }): Promise<void> {
  // Generate a fresh keypair locally — AEGIS never sees the private key.
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const aegis = await client();
  const agent = await aegis.agents.create({ name: opts.name, publicKey: b64u(pub) });
  ok(`agent created: ${(agent as { id: string }).id}`);
  emitJson(agent);
  if (opts.printPrivateKey) {
    info('PRIVATE KEY (store securely — AEGIS never sees this):');
    process.stdout.write(b64u(priv) + '\n');
  } else {
    info('Re-run with --print-private-key to display the private key once.');
  }
}

export async function agentsList(opts: { limit?: number; cursor?: string; json?: boolean }): Promise<void> {
  const aegis = await client();
  const result = (await aegis.agents.list({ limit: opts.limit, cursor: opts.cursor })) as { agents: { id: string; name: string; status: string; trustScore: number; trustBand: string }[] };
  if (opts.json) {
    emitJson(result);
    return;
  }
  emitTable(result.agents.map((a) => ({ id: a.id, name: a.name, status: a.status, score: a.trustScore, band: a.trustBand })));
}

export async function agentsGet(id: string, opts: { json?: boolean }): Promise<void> {
  const aegis = await client();
  const agent = await aegis.agents.get(id);
  if (opts.json) emitJson(agent);
  else emitJson(agent);
}

export async function agentsRevoke(id: string, opts: { reason?: string }): Promise<void> {
  const aegis = await client();
  await aegis.agents.revoke(id, { reason: opts.reason });
  ok(`agent revoked: ${id}`);
}
