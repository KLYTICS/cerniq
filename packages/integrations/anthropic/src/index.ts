// @aegis/anthropic — Pattern-A tool-call middleware for Anthropic
// Messages API + Claude Agent SDK. STUB.

import type { Aegis, VerifyResult, TrustBand } from '@aegis/sdk';

export interface AnthropicWithAegisConfig {
  aegis: Aegis;
  actionPrefix: string;
  minTrustBand?: TrustBand;
  agentTokenResolver?: (req: unknown) => string | undefined;
  onDenial?: (reason: string, ctx: { toolName: string; aegisResult: VerifyResult | null }) => void;
}

export class AnthropicVerificationDenial extends Error {
  public readonly code: string;
  public readonly result: VerifyResult | null;
  constructor(code: string, result: VerifyResult | null) {
    super(`AEGIS denied Anthropic tool_use: ${code}`);
    this.name = 'AnthropicVerificationDenial';
    this.code = code;
    this.result = result;
  }
}

/**
 * Wraps an Anthropic client so every tool_use block is AEGIS-verified.
 * STUB — implementation owned by peer aegis:int-anthropic.
 */
export function withAegisVerification<T extends object>(
  client: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: AnthropicWithAegisConfig,
): T {
  // TODO(peer aegis:int-anthropic): proxy messages.create + messages.stream;
  // intercept tool_use content blocks; verify; inject tool_result on denial.
  return new Proxy(client, {
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Middleware adapter for the Claude Agent SDK. STUB.
 */
export function aegisToolMiddleware(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: AnthropicWithAegisConfig,
): (block: unknown) => Promise<unknown> {
  return async (block) => {
    // TODO(peer aegis:int-anthropic): inspect block; if tool_use, verify;
    // pass through or replace with denial tool_result.
    return block;
  };
}

export type { Aegis, VerifyResult, TrustBand };
