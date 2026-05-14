import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { client } from '../client.js';
import { emitJson, ok, info } from '../output.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export async function agentsCreate(opts: { name: string; runtime?: string; printPrivateKey?: boolean }): Promise<void> {
  // Generate a fresh keypair locally — AEGIS never sees the private key.
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const aegis = await client();
  // SDK uses `register()` (not `create()`) and the wire field is
  // `label`, not `name`. Runtime defaults to OPENAI to match the
  // most common quickstart path; advanced callers can pass --runtime.
  const runtime = (opts.runtime?.toUpperCase() ?? 'OPENAI') as
    | 'OPENAI'
    | 'ANTHROPIC'
    | 'GOOGLE'
    | 'HUGGINGFACE'
    | 'CUSTOM';
  const agent = await aegis.agents.register({
    publicKey: b64u(pub),
    runtime,
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

export async function agentsList(opts: { limit?: number; cursor?: string; json?: boolean }): Promise<void> {
  // The control-plane API does expose `GET /v1/agents` (paginated), but
  // the SDK's `AgentClient` does not yet wrap it. Until the SDK adds
  // `list()`, the CLI prints a clear hint instead of pretending to
  // support the operation. Tracked for the next SDK release.
  void opts; // signature preserved for bin.ts wiring
  process.stderr.write(
    'agents list is not yet supported by @aegis/sdk; use the dashboard or `aegis agents get <id>`.\n',
  );
  process.exitCode = 2;
}

export async function agentsGet(id: string, opts: { json?: boolean }): Promise<void> {
  const aegis = await client();
  const agent = await aegis.agents.get(id);
  if (opts.json) emitJson(agent);
  else emitJson(agent);
}

export async function agentsRevoke(id: string, opts: { reason?: string }): Promise<void> {
  const aegis = await client();
  if (opts.reason) {
    process.stderr.write(
      'warning: --reason is no longer supported by the SDK revoke endpoint; ignoring.\n',
    );
  }
  await aegis.agents.revoke(id);
  ok(`agent revoked: ${id}`);
}
