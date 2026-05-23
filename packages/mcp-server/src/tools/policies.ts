import type { Cerniq, PolicyScope } from '@cerniq/sdk';

import type { ToolDefinition } from './registry.js';

export function registerPoliciesTools(cerniq: Cerniq, registry: Map<string, ToolDefinition>): void {
  registry.set('cerniq.policies.create', {
    name: 'cerniq.policies.create',
    description:
      'Issue a scoped policy for an agent. Returns a signed JWT (EdDSA) the agent presents at ' +
      '/v1/verify. Spend limits, MCC ranges, and merchant allow-lists are validated server-side.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        label: { type: 'string', description: 'Optional human-readable label.' },
        scopes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                description: 'e.g. "commerce", "data-read", "data-write".',
              },
              spendLimit: {
                type: 'object',
                properties: {
                  currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
                  maxPerTransaction: { type: 'number' },
                  maxPerDay: { type: 'number' },
                  maxPerMonth: { type: 'number' },
                },
                required: ['currency'],
              },
              allowedDomains: { type: 'array', items: { type: 'string' } },
              merchantCategories: { type: 'array', items: { type: 'string' } },
              dataScopes: { type: 'array', items: { type: 'string' } },
              validFrom: { type: 'string' },
              validUntil: { type: 'string' },
            },
            required: ['category'],
          },
        },
        expires_in_seconds: { type: 'number', minimum: 60, maximum: 7776000 },
      },
      required: ['agent_id', 'scopes', 'expires_in_seconds'],
      additionalProperties: false,
    },
    // SDK is `create(agentId, { label?, scopes, expiresAt })`. agentId is
    // path-positional (POST /agents/:agentId/policies), and expiresAt is an
    // absolute timestamp — we compute it from expires_in_seconds here so the
    // MCP surface stays caller-friendly.
    handler: async (args) => {
      const ttlSeconds = Number(args.expires_in_seconds);
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      return await cerniq.policies.create(String(args.agent_id), {
        label: typeof args.label === 'string' ? args.label : undefined,
        scopes: args.scopes as PolicyScope[],
        expiresAt,
      });
    },
  });

  // `cerniq.policies.get` removed — the API has no GET-single-policy endpoint
  // (only POST/GET-all-for-agent/DELETE). Reinstate after adding the API DTO
  // + controller route. The MCP server should not advertise tools that don't
  // map to a real API surface.

  registry.set('cerniq.policies.list', {
    name: 'cerniq.policies.list',
    description:
      'List active policies for an agent. (Per-agent only — there is no list-all surface.)',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    // SDK `list(agentId)` returns `PolicyRecord[]`. No status/limit/cursor
    // filters — those weren't in the API contract. Status lifecycle events
    // (REVOKED/EXPIRED) live in the audit log instead.
    handler: async (args) => await cerniq.policies.list(String(args.agent_id)),
  });

  registry.set('cerniq.policies.revoke', {
    name: 'cerniq.policies.revoke',
    description:
      'Revoke a policy immediately. All future verifies under this policy return POLICY_REVOKED.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent that owns the policy.' },
        policy_id: { type: 'string' },
      },
      required: ['agent_id', 'policy_id'],
      additionalProperties: false,
    },
    // SDK `revoke(agentId, policyId)` — both required because the API route
    // is `DELETE /agents/:agentId/policies/:policyId`. `reason` removed
    // (API DELETE takes no body).
    handler: async (args) => {
      await cerniq.policies.revoke(String(args.agent_id), String(args.policy_id));
    },
  });
}
