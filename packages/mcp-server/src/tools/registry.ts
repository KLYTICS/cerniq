// Tool registry — every CERNIQ-as-MCP tool is registered here. The names
// are the public API of this package (ADR-0008 §2). They MAY NOT be
// renamed without an ADR + minor version bump on the CERNIQ API spec.

export const TOOL_NAMES = [
  'cerniq.verify',
  'cerniq.agents.create',
  'cerniq.agents.get',
  'cerniq.agents.list',
  'cerniq.agents.revoke',
  'cerniq.policies.create',
  'cerniq.policies.get',
  'cerniq.policies.list',
  'cerniq.policies.revoke',
  'cerniq.audit.search',
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
