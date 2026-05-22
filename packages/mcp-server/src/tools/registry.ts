// Tool registry — every OKORO-as-MCP tool is registered here. The names
// are the public API of this package (ADR-0008 §2). They MAY NOT be
// renamed without an ADR + minor version bump on the OKORO API spec.

export const TOOL_NAMES = [
  'okoro.verify',
  'okoro.agents.create',
  'okoro.agents.get',
  'okoro.agents.list',
  'okoro.agents.revoke',
  'okoro.policies.create',
  'okoro.policies.get',
  'okoro.policies.list',
  'okoro.policies.revoke',
  'okoro.audit.search',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
