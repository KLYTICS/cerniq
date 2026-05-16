// @aegis/azure — Pattern-C cloud function adapter for Azure. STUB.

import type { Aegis, VerifyResult } from '@aegis/sdk';

export interface FunctionsWrapperConfig<TReq, TRes> {
  aegis: Aegis;
  actionResolver: (req: TReq) => string;
  agentTokenResolver: (req: TReq) => string | undefined;
  principalResolver?: (req: TReq) => string | undefined;
  onDenial?: (reason: string, req: TReq) => TRes | Promise<TRes>;
}

/** STUB. Wraps an Azure Functions handler with AEGIS verification. */
export function aegisFunctionsWrapper<TReq, TRes>(
  handler: (req: TReq) => Promise<TRes>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: FunctionsWrapperConfig<TReq, TRes>,
): (req: TReq) => Promise<TRes> {
  return async (req) => {
    // TODO(peer aegis:int-azure): verify before delegating; on denial,
    // call config.onDenial(reason, req) if provided, else throw.
    return handler(req);
  };
}

export interface AzureOpenAIAegisConfig {
  aegis: Aegis;
  actionPrefix: string;
  entraIdPrincipalHeader?: string;
}

/**
 * Wraps an Azure OpenAI client. The Azure OpenAI surface is
 * API-compatible with OpenAI's; this delegates to @aegis/openai
 * once the peer promotes it. STUB.
 */
export function withAegisVerification<T extends object>(
  client: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: AzureOpenAIAegisConfig,
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  });
}

export type { Aegis, VerifyResult };
