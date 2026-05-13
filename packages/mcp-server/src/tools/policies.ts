import type { Aegis } from '@aegis/sdk';
import type { ToolDefinition } from './registry.js';

export function registerPoliciesTools(aegis: Aegis, registry: Map<string, ToolDefinition>): void {
  registry.set('aegis.policies.create', {
    name: 'aegis.policies.create',
    description:
      'Issue a scoped policy for an agent. Returns a signed JWT (EdDSA) the agent presents at ' +
      '/v1/verify. Spend limits, MCC ranges, and merchant allow-lists are validated server-side.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        scopes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', description: 'e.g. "commerce", "code", "data".' },
              actions: { type: 'array', items: { type: 'string' } },
              merchant_domains: { type: 'array', items: { type: 'string' } },
              spend_limit: {
                type: 'object',
                properties: {
                  amount: { type: 'string', description: 'Decimal as string, e.g. "500.00".' },
                  currency: { type: 'string' },
                  window: { type: 'string', enum: ['per_request', 'per_day', 'lifetime'] },
                },
                required: ['amount', 'currency', 'window'],
              },
            },
            required: ['category'],
          },
        },
        expires_in_seconds: { type: 'number', minimum: 60, maximum: 7776000 },
      },
      required: ['agent_id', 'scopes'],
      additionalProperties: false,
    },
    // SDK shape: `create(agentId, { scopes, expiresAt: Date|string, label? })`.
    // The MCP tool exposes `expires_in_seconds` for ergonomics; we
    // convert to an absolute ISO timestamp here. Default is 24h.
    handler: async (args) => {
      const ttlSeconds =
        typeof args.expires_in_seconds === 'number' ? args.expires_in_seconds : 86_400;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      return aegis.policies.create(String(args.agent_id), {
        scopes: args.scopes as never,
        expiresAt,
      });
    },
  });

  registry.set('aegis.policies.get', {
    name: 'aegis.policies.get',
    description:
      'Fetch one policy by id. NOTE: pending SDK support — returns a clear error until ' +
      '`PolicyClient.get()` is added to @aegis/sdk.',
    inputSchema: {
      type: 'object',
      properties: { policy_id: { type: 'string' } },
      required: ['policy_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      void args;
      throw new Error(
        'aegis.policies.get is not yet supported by @aegis/sdk; use aegis.policies.list and filter client-side.',
      );
    },
  });

  registry.set('aegis.policies.list', {
    name: 'aegis.policies.list',
    description:
      'List active policies for an agent. SDK requires `agent_id`; status / paging filters are ' +
      'not yet supported and are accepted as no-ops with a warning.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] },
        limit: { type: 'number', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.agent_id !== 'string' || args.agent_id.length === 0) {
        throw new Error('aegis.policies.list requires `agent_id`.');
      }
      // status/limit/cursor surfaced in inputSchema for forward compat;
      // SDK list() takes only agentId today and returns the full array.
      return aegis.policies.list(args.agent_id);
    },
  });

  registry.set('aegis.policies.revoke', {
    name: 'aegis.policies.revoke',
    description: 'Revoke a policy immediately. All future verifies under this policy return POLICY_REVOKED.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        policy_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['agent_id', 'policy_id'],
      additionalProperties: false,
    },
    // SDK signature: `revoke(agentId, policyId)`. The historical
    // `reason` field is accepted in the schema for back-compat but
    // dropped at the SDK boundary; document the omission server-side
    // via an audit-event note when needed.
    handler: async (args) =>
      aegis.policies.revoke(String(args.agent_id), String(args.policy_id)),
  });
}
