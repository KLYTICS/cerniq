import type { AgentRuntime, Cerniq } from '@cerniq/sdk';

import type { ToolDefinition } from './registry.js';

const VALID_RUNTIMES: readonly AgentRuntime[] = [
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  'HUGGINGFACE',
  'CUSTOM',
];

function normalizeRuntime(input: unknown): AgentRuntime {
  if (input === undefined || input === null || input === '') return 'CUSTOM';
  const v = String(input).toUpperCase();
  if (!(VALID_RUNTIMES as readonly string[]).includes(v)) {
    throw new Error(
      `Invalid runtime "${String(input)}". Must be one of: ${VALID_RUNTIMES.join(', ')}.`,
    );
  }
  return v as AgentRuntime;
}

export function registerAgentsTools(cerniq: Cerniq, registry: Map<string, ToolDefinition>): void {
  registry.set('cerniq.agents.create', {
    name: 'cerniq.agents.create',
    description:
      "Register a new agent with CERNIQ. The caller must supply the agent's base64url Ed25519 public key — " +
      'CERNIQ never receives the private key (ADR-0002).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable agent label (maps to API `label`).' },
        public_key: {
          type: 'string',
          description: 'base64url-encoded Ed25519 public key (32 bytes).',
        },
        runtime: {
          type: 'string',
          enum: VALID_RUNTIMES as unknown as string[],
          description: 'Agent runtime. Defaults to CUSTOM.',
        },
        model: {
          type: 'string',
          description: 'Optional model identifier (e.g. "claude-sonnet-4-5").',
        },
      },
      required: ['name', 'public_key'],
      additionalProperties: false,
    },
    // SDK is `register()` (POST /agents/register). `RegisterAgentInput` has no
    // `metadata` field — previously the MCP tool advertised it; removed to
    // avoid silent drops. Add it on the API DTO + Prisma model first if needed.
    handler: async (args) =>
      await cerniq.agents.register({
        publicKey: String(args.public_key),
        runtime: normalizeRuntime(args.runtime),
        label: String(args.name),
        model: typeof args.model === 'string' ? args.model : undefined,
      }),
  });

  registry.set('cerniq.agents.get', {
    name: 'cerniq.agents.get',
    description: 'Fetch one agent by id.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string' } },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: async (args) => await cerniq.agents.get(String(args.agent_id)),
  });

  registry.set('cerniq.agents.list', {
    name: 'cerniq.agents.list',
    description: "List agents in the caller's principal. Cursor-paginated.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      await cerniq.agents.list({
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
      }),
  });

  registry.set('cerniq.agents.revoke', {
    name: 'cerniq.agents.revoke',
    description:
      'Revoke an agent. Subsequent verify calls return AGENT_REVOKED. Reversible only by re-creating ' +
      'the agent under a new id (ADR-0004).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    // `reason` removed — API `DELETE /agents/:agentId` takes no body. The
    // previous MCP tool advertised the param and the SDK silently dropped it.
    handler: async (args) => {
      await cerniq.agents.revoke(String(args.agent_id));
    },
  });
}
