// @aegis/openai — Pattern-A tool-call middleware for OpenAI clients.
// STUB. Implementation owned by the peer who claims aegis:int-openai.

import type { Aegis, VerifyResult, TrustBand } from '@aegis/sdk';

export interface OpenAIWithAegisConfig {
  /** AEGIS client. */
  aegis: Aegis;
  /** Action prefix for the verify call, e.g. `'openai.'`. */
  actionPrefix: string;
  /** Minimum trust band the agent must satisfy. Default `'VERIFIED'`. */
  minTrustBand?: TrustBand;
  /**
   * Resolves the AEGIS agent token from the request. Default reads
   * `metadata?.aegis_token` on the OpenAI input payload.
   */
  agentTokenResolver?: (req: unknown) => string | undefined;
  /** Optional callback when a tool call is denied. Default throws. */
  onDenial?: (reason: string, ctx: DenialContext) => void;
}

export interface DenialContext {
  toolName: string;
  agentToken: string | undefined;
  aegisResult: VerifyResult | null;
}

export class OpenAIVerificationDenial extends Error {
  public readonly code: string;
  public readonly result: VerifyResult | null;
  constructor(code: string, result: VerifyResult | null) {
    super(`AEGIS denied OpenAI tool call: ${code}`);
    this.name = 'OpenAIVerificationDenial';
    this.code = code;
    this.result = result;
  }
}

/**
 * Wraps an OpenAI client so every tool call is verified by AEGIS first.
 *
 * STUB — implementation pending. See README for the contract.
 *
 * @param client The OpenAI client instance to wrap.
 * @param config Verification configuration.
 * @returns A proxy of the OpenAI client with AEGIS verification injected.
 */
export function withAegisVerification<T extends object>(
  client: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: OpenAIWithAegisConfig,
): T {
  // TODO(peer aegis:int-openai): proxy the client; intercept
  // responses.create + beta.threads.runs.create + .stream; on each
  // tool-call output, invoke config.aegis.verify(token, { action })
  // and either let it through or call config.onDenial(reason, ctx).
  return new Proxy(client, {
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  });
}

export type { Aegis, VerifyResult, TrustBand };
