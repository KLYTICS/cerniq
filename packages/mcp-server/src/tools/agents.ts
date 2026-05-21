import type { Aegis, AgentRuntime, AgentStatus } from '@aegis/sdk';

import type { ToolDefinition } from './registry.js';

const VALID_RUNTIMES: readonly AgentRuntime[] = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'];
const VALID_STATUSES: readonly AgentStatus[] = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED'];

function parseRuntime(raw: unknown): AgentRuntime {
  if (typeof raw !== 'string') return 'CUSTOM';
  const candidate = raw.toUpperCase() as AgentRuntime;
  return VALID_RUNTIMES.includes(candidate) ? candidate : 'CUSTOM';
}

export function registerAgentsTools(
  aegis: Aegis,
  registry: Map<string, ToolDefinition>,
): void {
  registry.set('aegis.agents.create', {
    name: 'aegis.agents.create',
    description:
      "Register a new agent with AEGIS. The caller must supply the agent's base64url Ed25519 public key — " +
      'AEGIS never receives the private key (ADR-0002).',
    annotations: {
      title: 'Register agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Human-readable agent label.' },
        public_key: { type: 'string', description: 'base64url-encoded Ed25519 public key (32 bytes).' },
        runtime: {
          type: 'string',
          enum: VALID_RUNTIMES as unknown as string[],
          description: 'Agent runtime; defaults to CUSTOM if omitted.',
        },
        model: { type: 'string', description: 'Optional model identifier.' },
      },
      required: ['public_key'],
      additionalProperties: false,
    },
    handler: async (args) =>
      await aegis.agents.register({
        publicKey: String(args.public_key),
        runtime: parseRuntime(args.runtime),
        ...(typeof args.label === 'string' ? { label: args.label } : {}),
        ...(typeof args.model === 'string' ? { model: args.model } : {}),
      }),
  });

  registry.set('aegis.agents.get', {
    name: 'aegis.agents.get',
    description: 'Fetch one agent by id.',
    annotations: {
      title: 'Get agent',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
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
      "List agents owned by the calling principal. Paginated (cursor in nextCursor). " +
      'Filterable by status, runtime, and a substring search on id/label/model.',
    annotations: {
      title: 'List agents',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
        status: { type: 'string', enum: VALID_STATUSES as unknown as string[] },
        runtime: { type: 'string', enum: VALID_RUNTIMES as unknown as string[] },
        search: { type: 'string', description: 'Substring match on agentId / label / model.' },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      await aegis.agents.list({
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}),
        ...(typeof args.status === 'string' ? { status: args.status as AgentStatus } : {}),
        ...(typeof args.runtime === 'string' ? { runtime: args.runtime as AgentRuntime } : {}),
        ...(typeof args.search === 'string' ? { search: args.search } : {}),
      }),
  });

  registry.set('aegis.agents.revoke', {
    name: 'aegis.agents.revoke',
    description:
      'Revoke an agent. Subsequent verify calls return AGENT_REVOKED. Reversible only by re-creating ' +
      'the agent under a new id (ADR-0004).',
    annotations: {
      title: 'Revoke agent',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        reason: { type: 'string', description: 'Free-form reason; not yet plumbed through the SDK.' },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      await aegis.agents.revoke(String(args.agent_id));
      return {
        agentId: String(args.agent_id),
        revoked: true,
        ...(typeof args.reason === 'string'
          ? { reasonAccepted: false, note: 'SDK revoke() does not yet persist a reason.' }
          : {}),
      };
    },
  });
}
