import type { Aegis, AuditSearchOptions } from '@aegis/sdk';
import type { ToolDefinition } from './registry.js';

export function registerAuditTool(
  aegis: Aegis,
  registry: Map<string, ToolDefinition>,
): void {
  registry.set('aegis.audit.search', {
    name: 'aegis.audit.search',
    description:
      "Search this principal's audit events. Read-only; principals cannot read other principals' " +
      'audit logs. Each event carries a hash-chain signature verifiable against the JWKS at ' +
      '/.well-known/audit-signing-key (ADR-0011). When `agent_id` is supplied the search is ' +
      'scoped to that single agent (faster, no cross-agent filter pass).',
    annotations: {
      title: 'Search audit events',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Optional. Scopes the search to one agent.' },
        from: { type: 'string', description: 'ISO timestamp lower bound (inclusive).' },
        to: { type: 'string', description: 'ISO timestamp upper bound (exclusive).' },
        limit: { type: 'number', minimum: 1, maximum: 1000 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const opts: AuditSearchOptions = {
        ...(typeof args.from === 'string' ? { from: args.from } : {}),
        ...(typeof args.to === 'string' ? { to: args.to } : {}),
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}),
      };
      return typeof args.agent_id === 'string'
        ? await aegis.audit.forAgent(args.agent_id, opts)
        : await aegis.audit.search(opts);
    },
  });
}
