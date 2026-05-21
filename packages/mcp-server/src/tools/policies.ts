import type { Aegis, PolicyRecord, PolicyScope } from '@aegis/sdk';
import type { ToolDefinition } from './registry.js';

const DEFAULT_TTL_SECONDS = 86_400;

function resolveExpiresAt(args: Record<string, unknown>): Date {
  if (typeof args.expires_at === 'string') return new Date(args.expires_at);
  const ttl = typeof args.expires_in_seconds === 'number' ? args.expires_in_seconds : DEFAULT_TTL_SECONDS;
  return new Date(Date.now() + ttl * 1000);
}

export function registerPoliciesTools(
  aegis: Aegis,
  registry: Map<string, ToolDefinition>,
): void {
  registry.set('aegis.policies.create', {
    name: 'aegis.policies.create',
    description:
      'Issue a scoped policy for an agent. Returns a signed JWT (EdDSA) the agent presents at ' +
      '/v1/verify. Spend limits, MCC ranges, and merchant allow-lists are validated server-side.',
    annotations: {
      title: 'Create policy',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        scopes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', description: 'e.g. "commerce", "data-read".' },
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
        expires_at: { type: 'string', description: 'ISO timestamp. Takes precedence over expires_in_seconds.' },
        label: { type: 'string' },
      },
      required: ['agent_id', 'scopes'],
      additionalProperties: false,
    },
    handler: async (args) =>
      await aegis.policies.create(String(args.agent_id), {
        scopes: args.scopes as PolicyScope[],
        expiresAt: resolveExpiresAt(args),
        ...(typeof args.label === 'string' ? { label: args.label } : {}),
      }),
  });

  registry.set('aegis.policies.get', {
    name: 'aegis.policies.get',
    description:
      "Fetch one policy by id. Currently filters client-side from policies.list(agentId) — the API does " +
      'not yet expose a GET /policies/:id endpoint. Throws if the policy is not found in the agent\'s list.',
    annotations: {
      title: 'Get policy',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        policy_id: { type: 'string' },
      },
      required: ['agent_id', 'policy_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const policies = await aegis.policies.list(String(args.agent_id));
      const found = policies.find((p: PolicyRecord) => p.policyId === String(args.policy_id));
      if (!found) {
        throw new Error(`policy_not_found: ${args.policy_id} not in agent ${args.agent_id}`);
      }
      return found;
    },
  });

  registry.set('aegis.policies.list', {
    name: 'aegis.policies.list',
    description:
      "List policies for an agent. Returns all active policies; the API does not yet expose server-side " +
      'status/cursor filtering on this endpoint.',
    annotations: {
      title: 'List policies',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: async (args) => await aegis.policies.list(String(args.agent_id)),
  });

  registry.set('aegis.policies.revoke', {
    name: 'aegis.policies.revoke',
    description: 'Revoke a policy immediately. All future verifies under this policy return POLICY_REVOKED.',
    annotations: {
      title: 'Revoke policy',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
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
    handler: async (args) => {
      await aegis.policies.revoke(String(args.agent_id), String(args.policy_id));
      return {
        agentId: String(args.agent_id),
        policyId: String(args.policy_id),
        revoked: true,
        ...(typeof args.reason === 'string'
          ? { reasonAccepted: false, note: 'SDK revoke() does not yet persist a reason.' }
          : {}),
      };
    },
  });
}
