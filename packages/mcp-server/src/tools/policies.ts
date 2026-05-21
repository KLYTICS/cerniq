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
    handler: async (args) =>
      await aegis.policies.create({
        agentId: String(args.agent_id),
        scopes: args.scopes as never,
        expiresInSeconds: typeof args.expires_in_seconds === 'number' ? args.expires_in_seconds : undefined,
      }),
  });

  registry.set('aegis.policies.get', {
    name: 'aegis.policies.get',
    description: 'Fetch one policy by id.',
    inputSchema: {
      type: 'object',
      properties: { policy_id: { type: 'string' } },
      required: ['policy_id'],
      additionalProperties: false,
    },
    handler: async (args) => await aegis.policies.get(String(args.policy_id)),
  });

  registry.set('aegis.policies.list', {
    name: 'aegis.policies.list',
    description: 'List active policies for an agent or principal.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] },
        limit: { type: 'number', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      await aegis.policies.list({
        agentId: typeof args.agent_id === 'string' ? args.agent_id : undefined,
        status: typeof args.status === 'string' ? (args.status as 'ACTIVE' | 'REVOKED' | 'EXPIRED') : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
      }),
  });

  registry.set('aegis.policies.revoke', {
    name: 'aegis.policies.revoke',
    description: 'Revoke a policy immediately. All future verifies under this policy return POLICY_REVOKED.',
    inputSchema: {
      type: 'object',
      properties: {
        policy_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['policy_id'],
      additionalProperties: false,
    },
    handler: async (args) =>
      { await aegis.policies.revoke(String(args.policy_id), {
        reason: typeof args.reason === 'string' ? args.reason : undefined,
      }); },
  });
}
