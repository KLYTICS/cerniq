'use server';

// Server actions for the /agents page. The actual API call is made on the
// server (key never reaches the browser), the result is returned to the
// client component, and the listing route is revalidated.

import { revalidatePath } from 'next/cache';

import { OkoroApiError, registerAgent, revokeAgent } from '../../lib/api-client';

export interface ActionResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface RegisterAgentResult {
  agentId: string;
  publicKey: string;
}

export async function registerAgentAction(input: FormData): Promise<ActionResult<RegisterAgentResult>> {
  const publicKey = String(input.get('publicKey') ?? '').trim();
  const runtime = String(input.get('runtime') ?? '').trim().toUpperCase();
  const model = String(input.get('model') ?? '').trim();
  const label = String(input.get('label') ?? '').trim();

  if (publicKey.length < 20) {
    return { ok: false, error: { code: 'INVALID_PUBLIC_KEY', message: 'Public key must be at least 20 chars (base64url Ed25519).' } };
  }
  if (!['OPENAI', 'ANTHROPIC', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'].includes(runtime)) {
    return { ok: false, error: { code: 'INVALID_RUNTIME', message: 'Pick a valid runtime.' } };
  }

  try {
    const created = await registerAgent({
      publicKey,
      runtime,
      ...(model ? { model } : {}),
      ...(label ? { label } : {}),
    });
    revalidatePath('/agents');
    return { ok: true, data: { agentId: created.agentId, publicKey: created.publicKey } };
  } catch (err) {
    if (err instanceof OkoroApiError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    return { ok: false, error: { code: 'UNKNOWN', message: 'Unexpected error registering agent.' } };
  }
}

export async function revokeAgentAction(agentId: string): Promise<ActionResult<{ agentId: string }>> {
  try {
    await revokeAgent(agentId);
    revalidatePath('/agents');
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, data: { agentId } };
  } catch (err) {
    if (err instanceof OkoroApiError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    return { ok: false, error: { code: 'UNKNOWN', message: 'Unexpected error revoking agent.' } };
  }
}
