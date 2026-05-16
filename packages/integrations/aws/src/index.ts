// @aegis/aws — Pattern-C cloud function adapter for AWS. STUB.

import type { Aegis, VerifyResult } from '@aegis/sdk';

// ── Lambda middleware ─────────────────────────────────────────────
export interface LambdaWrapperConfig<TEvent, TResult> {
  aegis: Aegis;
  actionResolver: (event: TEvent) => string;
  agentTokenResolver: (event: TEvent) => string | undefined;
  onDenial?: (reason: string, event: TEvent) => TResult | Promise<TResult>;
}

/** STUB. Wraps a Lambda handler with AEGIS verification. */
export function aegisLambdaWrapper<TEvent, TResult>(
  handler: (event: TEvent) => Promise<TResult>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: LambdaWrapperConfig<TEvent, TResult>,
): (event: TEvent) => Promise<TResult> {
  return async (event: TEvent) => {
    // TODO(peer aegis:int-aws): verify before delegating to handler.
    return handler(event);
  };
}

// ── EventBridge audit sink ────────────────────────────────────────
export interface EventBridgeSink {
  export(events: unknown[]): Promise<void>;
}

/** STUB. */
export function eventBridgeAuditSink(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  busName: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config?: { region?: string },
): EventBridgeSink {
  return {
    async export(_events) {
      // TODO(peer aegis:int-aws): PutEvents to EventBridge.
    },
  };
}

// ── Bedrock Agents wrapper ────────────────────────────────────────
export interface BedrockAgentVerifierConfig {
  aegis: Aegis;
  actionPrefix: string;
}

/** STUB. */
export function bedrockAgentVerifier(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: BedrockAgentVerifierConfig,
): <TEvent, TResult>(handler: (event: TEvent) => Promise<TResult>) => (event: TEvent) => Promise<TResult> {
  return (handler) => async (event) => {
    // TODO(peer aegis:int-aws): inspect Bedrock action-group payload; verify; delegate.
    return handler(event);
  };
}

export type { Aegis, VerifyResult };
