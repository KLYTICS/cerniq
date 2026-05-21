import type { Aegis } from '@aegis/sdk';

import type { ToolDefinition } from './registry.js';

export function registerAgentsTools(aegis: Aegis, registry: Map<string, ToolDefinition>): void {
  registry.set('aegis.agents.create', {
    name: 'aegis.agents.create',
    description:
      'Register a new agent with AEGIS. The caller must supply the agent\'s base64url Ed25519 public key — ' +
      'AEGIS never receives the private key (ADR-0002).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable agent name.' },
        public_key: { type: 'string', description: 'base64url-encoded Ed25519 public key (32 bytes).' },
        metadata: { type: 'object', description: 'Free-form metadata. Cannot contain secrets.' },
      },
      required: ['name', 'public_key'],
      additionalProperties: false,
    },
    handler: async (args) =>
      await aegis.agents.create({
        name: String(args.name),
        publicKey: String(args.public_key),
        metadata: args.metadata as Record<string, unknown> | undefined,
      }),
  });

  registry.set('aegis.agents.get', {
    name: 'aegis.agents.get',
    description: 'Fetch one agent by id.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string' } },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: async (args) => await aegis.agents.get(String(args.agent_id)),
  });

  registry.set('aegis.agents.list', {
    name: 'aegis.agents.list',
    description: 'List agents in the caller\'s principal. Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      await aegis.agents.list({
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
      }),
  });

  registry.set('aegis.agents.revoke', {
    name: 'aegis.agents.revoke',
    description:
      'Revoke an agent. Subsequent verify calls return AGENT_REVOKED. Reversible only by re-creating ' +
      'the agent under a new id (ADR-0004).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        reason: { type: 'string', description: 'Free-form reason; appears in audit log.' },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: async (args) =>
      { await aegis.agents.revoke(String(args.agent_id), {
        reason: typeof args.reason === 'string' ? args.reason : undefined,
      }); },
  });
}
