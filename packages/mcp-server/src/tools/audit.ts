import type { Okoro } from '@okoro/sdk';

import type { ToolDefinition } from './registry.js';

export function registerAuditTool(okoro: Okoro, registry: Map<string, ToolDefinition>): void {
  registry.set('okoro.audit.search', {
    name: 'okoro.audit.search',
    description:
      'Search this principal\'s audit events. Read-only; principals cannot read other principals\' ' +
      'audit logs. Each event carries a hash-chain signature verifiable against the JWKS at ' +
      '/.well-known/audit-signing-key (ADR-0011).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        action: { type: 'string', description: 'e.g. "commerce.purchase".' },
        decision: { type: 'string', enum: ['APPROVED', 'DENIED', 'FLAGGED'] },
        from: { type: 'string', description: 'ISO timestamp lower bound (inclusive).' },
        to: { type: 'string', description: 'ISO timestamp upper bound (exclusive).' },
        limit: { type: 'number', minimum: 1, maximum: 200 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      // SDK surface for audit search lands in M-021 (sdk-ts extension).
      // Until then this tool calls the REST API directly via okoro.http.
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) {
        if (v === undefined || v === null) continue;
        params.set(k.replace(/_/g, ''), typeof v === 'string' ? v : JSON.stringify(v));
      }
      // @ts-expect-error - http accessor available on Okoro client per
      // packages/sdk-ts/src/index.ts; types lag by one publish cycle.
      return await okoro.http.get(`/v1/audit-events?${params.toString()}`);
    },
  });
}
