import type { Aegis } from '@aegis/sdk';
import type { RawHttp } from './raw-http.js';
import type { ToolDefinition } from './registry.js';

export function registerAuditTool(
  _aegis: Aegis,
  rawHttp: RawHttp,
  registry: Map<string, ToolDefinition>,
): void {
  registry.set('aegis.audit.search', {
    name: 'aegis.audit.search',
    description:
      "Search this principal's audit events. Read-only; principals cannot read other principals' " +
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
    // SDK surface for audit search is not yet modeled; the endpoint
    // exists, so we go through the raw helper rather than reach into
    // the SDK's private http field.
    handler: async (args) =>
      await rawHttp.json('/v1/audit-events', {
        query: {
          agent_id: typeof args.agent_id === 'string' ? args.agent_id : undefined,
          action: typeof args.action === 'string' ? args.action : undefined,
          decision: typeof args.decision === 'string' ? args.decision : undefined,
          from: typeof args.from === 'string' ? args.from : undefined,
          to: typeof args.to === 'string' ? args.to : undefined,
          limit: typeof args.limit === 'number' ? String(args.limit) : undefined,
          cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
        },
      }),
  });
}
