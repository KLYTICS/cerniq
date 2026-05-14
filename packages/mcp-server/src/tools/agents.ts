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
        name: { type: 'string', description: 'Human-readable agent name (becomes `label`).' },
        public_key: { type: 'string', description: 'base64url-encoded Ed25519 public key (32 bytes).' },
        runtime: {
          type: 'string',
          enum: ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'],
          description: 'Agent runtime tag. Defaults to OPENAI.',
        },
        model: { type: 'string', description: 'Optional model identifier (e.g. "gpt-4o").' },
      },
      required: ['name', 'public_key'],
      additionalProperties: false,
    },
    // SDK uses `register()` (not `create()`) and the wire field is
    // `label`, not `name`. Runtime defaults to OPENAI to match the
    // most common quickstart path.
    handler: async (args) => {
      const runtime = (typeof args.runtime === 'string' ? args.runtime : 'OPENAI') as
        | 'OPENAI'
        | 'ANTHROPIC'
        | 'GOOGLE'
        | 'HUGGINGFACE'
        | 'CUSTOM';
      return aegis.agents.register({
        publicKey: String(args.public_key),
        runtime,
        label: String(args.name),
        model: typeof args.model === 'string' ? args.model : undefined,
      });
    },
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
    description:
      'List agents in the caller\'s principal. NOTE: pending SDK support — returns a clear error until ' +
      '`AgentClient.list()` wraps the existing `GET /v1/agents` endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      void args;
      throw new Error(
        'aegis.agents.list is not yet supported by @aegis/sdk. The control-plane endpoint ' +
          '(GET /v1/agents) exists; the SDK wrapper is pending.',
      );
    },
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
        reason: { type: 'string', description: 'Accepted but ignored — SDK revoke() takes only the agentId.' },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    // SDK signature: `revoke(agentId)`. The `reason` field is preserved
    // in the input schema for back-compat with existing MCP clients
    // but dropped at the SDK boundary.
    handler: async (args) => aegis.agents.revoke(String(args.agent_id)),
  });
}
