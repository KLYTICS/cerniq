// Tool registry — every AEGIS-as-MCP tool is registered here. The names
// are the public API of this package (ADR-0008 §2). They MAY NOT be
// renamed without an ADR + minor version bump on the AEGIS API spec.

export const TOOL_NAMES = [
  'aegis.verify',
  'aegis.agents.create',
  'aegis.agents.get',
  'aegis.agents.list',
  'aegis.agents.revoke',
  'aegis.policies.create',
  'aegis.policies.get',
  'aegis.policies.list',
  'aegis.policies.revoke',
  'aegis.audit.search',
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
