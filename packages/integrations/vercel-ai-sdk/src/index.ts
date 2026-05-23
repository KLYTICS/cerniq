// @aegis/vercel-ai-sdk — Pattern-A tool wrapper for Vercel AI SDK. STUB.

import type { Aegis, TrustBand, VerifyResult } from '@aegis/sdk';

export interface VercelToolAegisConfig {
  aegis: Aegis;
  actionPrefix: string;
  minTrustBand?: TrustBand;
  agentTokenResolver?: (ctx: { messages?: unknown[] }) => string | undefined;
  onDenial?: (reason: string, ctx: { toolName: string; aegisResult: VerifyResult | null }) => void;
}

export class VercelToolVerificationDenial extends Error {
  public readonly code: string;
  public readonly result: VerifyResult | null;
  constructor(code: string, result: VerifyResult | null) {
    super(`AEGIS denied Vercel AI SDK tool: ${code}`);
    this.name = 'VercelToolVerificationDenial';
    this.code = code;
    this.result = result;
  }
}

/**
 * Factory that returns a tool-wrapper.
 *
 * STUB — peer aegis:int-vercel-ai-sdk owns implementation.
 */
export function aegisTool(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: VercelToolAegisConfig,
): <T>(tool: T) => T {
  return <T>(tool: T): T => {
    // TODO(peer aegis:int-vercel-ai-sdk): clone tool, wrap execute() so
    // it calls config.aegis.verify(token, { action }) first and throws
    // VercelToolVerificationDenial on failure.
    return tool;
  };
}

export type { Aegis, TrustBand, VerifyResult };
