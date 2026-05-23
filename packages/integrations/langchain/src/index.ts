// @aegis/langchain — Pattern-A tool middleware for LangChain (JS). STUB.

import type { Aegis, TrustBand, VerifyResult } from '@aegis/sdk';

export interface AegisToolConfig<TTool> {
  aegis: Aegis;
  actionPrefix: string;
  minTrustBand?: TrustBand;
  /** The LangChain tool being wrapped. */
  tool: TTool;
  agentTokenResolver?: (input: unknown) => string | undefined;
  onDenial?: (reason: string, ctx: { toolName: string; aegisResult: VerifyResult | null }) => void;
}

export class LangChainVerificationDenial extends Error {
  public readonly code: string;
  public readonly result: VerifyResult | null;
  constructor(code: string, result: VerifyResult | null) {
    super(`AEGIS denied LangChain tool: ${code}`);
    this.name = 'LangChainVerificationDenial';
    this.code = code;
    this.result = result;
  }
}

/**
 * AEGIS-wrapped LangChain tool. STUB — owned by peer aegis:int-langchain.
 *
 * The real implementation extends LangChain's `BaseTool` and overrides
 * `_call` / `invoke` to run verify first. This stub captures the contract.
 */
export class AegisTool<TTool = unknown> {
  public readonly config: AegisToolConfig<TTool>;

  constructor(config: AegisToolConfig<TTool>) {
    this.config = config;
  }

  /**
   * Call the wrapped tool — verifies via AEGIS first.
   * STUB.
   */
  async invoke(input: unknown): Promise<unknown> {
    // TODO(peer aegis:int-langchain): extract agent token, call aegis.verify,
    // throw LangChainVerificationDenial on failure, else delegate to this.config.tool.
    void input;
    return null;
  }
}

/**
 * LangGraph node factory. STUB.
 */
export function aegisVerifyNode(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: { aegis: Aegis; actionResolver: (state: unknown) => string },
): (state: unknown) => Promise<unknown> {
  return async (state) => {
    // TODO(peer aegis:int-langchain): verify; return state with verify_result attached.
    return state;
  };
}

export type { Aegis, TrustBand, VerifyResult };
