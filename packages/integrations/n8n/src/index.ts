// n8n-nodes-aegis — n8n community node. STUB.
//
// The real implementation produces TWO files in the published package:
//   nodes/AegisVerify/AegisVerify.node.ts
//   credentials/AegisApi.credentials.ts
//
// And declares them in package.json under the `"n8n"` field per n8n's
// community-node convention. This src/index.ts is a placeholder so peers
// can see the contract before promotion.

export const N8N_NODE_NAME = 'aegisVerify';

export interface AegisVerifyNodeParams {
  apiKey: string;
  agentToken: string;
  action: string;
  amount?: number;
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
}

export interface AegisVerifyNodeOutput {
  valid: boolean;
  trustScore?: number;
  trustBand?: string;
  reason?: string;
  auditEventId?: string;
}

/**
 * Reference implementation of the verify call. The real n8n node will use
 * n8n's `this.helpers.httpRequest` instead of a direct fetch. STUB.
 */
export async function verifyOnce(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  params: AegisVerifyNodeParams,
): Promise<AegisVerifyNodeOutput> {
  // TODO(peer aegis:int-n8n): real implementation calls
  // `POST https://api.aegis.dev/v1/verify` with X-API-KEY + agent token.
  return { valid: false, reason: 'NOT_IMPLEMENTED' };
}
