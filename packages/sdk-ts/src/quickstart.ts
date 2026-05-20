// Aegis.quickstart() — Round 25 Lane A.
//
// The one-call onboarding helper. Takes an API key + label, returns
// everything a junior developer needs for their first verify:
//
//   const { aegis, agent, policy, sign } = await Aegis.quickstart({
//     apiKey: process.env.AEGIS_API_KEY!,
//     label: 'my-first-agent',
//   });
//   const token = await sign({ action: 'commerce.purchase', amount: 100 });
//   const result = await aegis.verify(token);
//
// What it does:
//
//   1. Reads or generates an Ed25519 keypair via the provided KeyStorage
//      (default: filesystem on Node, IndexedDB on browser, memory on edge).
//   2. Registers the agent with AEGIS (idempotent — if the stored key
//      already has an `agentId`, reuse it).
//   3. Mints a default policy (TTL 24h, action allow-list = `quickstart.*`).
//   4. Returns a `sign(ctx)` closure that pre-binds the agentId + policyId
//      so the developer can sign per-request without passing them.
//
// Junior-grade: every parameter has a sensible default. The only thing
// the caller MUST supply is the API key (or set AEGIS_API_KEY in env).

import { Aegis } from './index.js';
import { generateKeypair, signAgentToken } from './crypto.js';
import type { AgentRecord, PolicyRecord, PolicyScope, SignContext } from './types.js';
import { defaultKeyStorage, type KeyStorage, type StoredKey } from './key-storage.js';
import { detectRuntime, type AegisRuntime } from './runtime.js';

export interface QuickstartOptions {
  /** Required. AEGIS API key. Falls back to `AEGIS_API_KEY` env var. */
  apiKey?: string;
  /** Optional. Defaults to "aegis-quickstart". */
  label?: string;
  /** Optional. Defaults to "ANTHROPIC". */
  runtime?: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'HUGGINGFACE' | 'CUSTOM';
  /** Optional. Pluggable storage; defaults to runtime-appropriate adapter. */
  storage?: KeyStorage;
  /** Optional key name within storage. Defaults to `label`. */
  keyName?: string;
  /**
   * Optional scope override. Defaults to a permissive `quickstart.*` policy
   * with $100 USD per-transaction cap and a 24-hour expiry — safe for
   * learning, NOT safe for production (kept loose so juniors don't hit
   * SCOPE_NOT_GRANTED on their first verify).
   */
  scopes?: PolicyScope[];
  /** Optional policy expiry. Defaults to 24h from now. */
  policyExpiresAt?: Date;
  /** Optional override of the AEGIS base URL. Defaults to env / public. */
  baseUrl?: string;
}

export interface QuickstartBundle {
  /** The configured Aegis client — pass to relying-party code. */
  aegis: Aegis;
  /** The registered agent (or the one re-bound from stored key). */
  agent: AgentRecord;
  /** The freshly-minted policy. */
  policy: PolicyRecord;
  /** Pre-bound signer — caller passes `SignContext` only. */
  sign: (ctx: SignContext) => Promise<string>;
  /** Detected runtime for telemetry / debugging. */
  runtime: AegisRuntime;
  /** The storage adapter that held the keypair. */
  storage: KeyStorage;
  /** Storage key name (in case caller wants to rebind later). */
  keyName: string;
}

const DEFAULT_LABEL = 'aegis-quickstart';
const DEFAULT_RUNTIME = 'ANTHROPIC' as const;
const DEFAULT_POLICY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCOPES: PolicyScope[] = [
  {
    category: 'commerce',
    spendLimit: { currency: 'USD', maxPerTransaction: 100, maxPerDay: 500 },
  },
];

/**
 * Resolve `AEGIS_API_KEY` from the explicit option, falling back to env.
 * Throws with the catalog-aligned `next` message when neither is set.
 */
function resolveApiKey(explicit: string | undefined): string {
  if (explicit && explicit.length > 0) return explicit;
  // type-rationale: globalThis.process is Node-shaped; we narrow defensively.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process;
  const fromEnv: unknown = proc?.env?.AEGIS_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  throw new Error(
    'Aegis.quickstart: apiKey not provided. ' +
      'Set AEGIS_API_KEY in your environment, or pass apiKey to the SDK constructor ' +
      '(https://docs.aegislabs.io/errors/auth_required)',
  );
}

export async function quickstart(opts: QuickstartOptions = {}): Promise<QuickstartBundle> {
  const apiKey = resolveApiKey(opts.apiKey);
  const label = opts.label ?? DEFAULT_LABEL;
  const keyName = opts.keyName ?? label;
  const storage = opts.storage ?? defaultKeyStorage();
  const runtime = opts.runtime ?? DEFAULT_RUNTIME;
  const detected = detectRuntime();

  const aegis = new Aegis({
    apiKey,
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  });

  // Step 1 — load or generate the keypair.
  let stored = await storage.get(keyName);
  if (!stored) {
    const kp = await generateKeypair();
    stored = {
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      createdAt: new Date().toISOString(),
      label,
    };
    await storage.put(keyName, stored);
  }

  // Step 2 — register the agent (or reuse the stored binding).
  let agent: AgentRecord;
  if (stored.agentId) {
    try {
      agent = await aegis.agents.get(stored.agentId);
    } catch {
      // Stored binding is stale (revoked, deleted, principal changed). Fall
      // through to re-register. We do not silently swallow other errors —
      // the get() call will re-throw transport failures.
      agent = await aegis.agents.register({
        publicKey: stored.publicKey,
        runtime,
        label,
      });
      await storage.put(keyName, { ...stored, agentId: agent.agentId });
    }
  } else {
    agent = await aegis.agents.register({
      publicKey: stored.publicKey,
      runtime,
      label,
    });
    const updated: StoredKey = { ...stored, agentId: agent.agentId };
    await storage.put(keyName, updated);
    stored = updated;
  }

  // Step 3 — mint a default policy.
  const expiresAt = opts.policyExpiresAt ?? new Date(Date.now() + DEFAULT_POLICY_TTL_MS);
  const policy = await aegis.policies.create(agent.agentId, {
    label: `${label}-policy`,
    scopes: opts.scopes ?? DEFAULT_SCOPES,
    expiresAt,
  });

  // Step 4 — return the bundle with a pre-bound signer closure.
  const privateKey = stored.privateKey;
  const agentId = agent.agentId;
  const policyId = policy.policyId;
  const sign = (ctx: SignContext): Promise<string> =>
    signAgentToken(privateKey, agentId, policyId, ctx);

  return {
    aegis,
    agent,
    policy,
    sign,
    runtime: detected,
    storage,
    keyName,
  };
}
