import type { Aegis, AgentRuntime } from '@aegis/sdk';
import type { RawHttp } from './raw-http.js';
import type { ToolDefinition } from './registry.js';

const VALID_RUNTIMES: readonly AgentRuntime[] = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'];

function parseRuntime(raw: unknown): AgentRuntime {
  if (typeof raw !== 'string') return 'CUSTOM';
  const candidate = raw.toUpperCase() as AgentRuntime;
  return VALID_RUNTIMES.includes(candidate) ? candidate : 'CUSTOM';
}

export function registerAgentsTools(
  aegis: Aegis,
  rawHttp: RawHttp,
  registry: Map<string, ToolDefinition>,
): void {
  registry.set('aegis.agents.create', {
    name: 'aegis.agents.create',
    description:
      "Register a new agent with AEGIS. The caller must supply the agent's base64url Ed25519 public key — " +
      'AEGIS never receives the private key (ADR-0002).',
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
    description: "List agents in the caller's principal. Paginated.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
    // SDK does not yet expose `agents.list()`; the endpoint exists, so we
    // go through the raw helper rather than fabricate an SDK call.
    handler: async (args) =>
      await rawHttp.json('/v1/agents', {
        query: {
          limit: typeof args.limit === 'number' ? String(args.limit) : undefined,
          cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
        },
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
