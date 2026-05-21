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

/**
 * Tool annotations per MCP 1.0 spec:
 * https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations
 *
 * Advisory hints the host uses to render confirmation prompts and to
 * route long-running tools. They do not relax server-side enforcement —
 * AEGIS auth, scope, and audit chains still gate every call.
 */
export interface ToolAnnotations {
  /** Human-readable title. Defaults to the tool name when absent. */
  title?: string;
  /** True iff the tool only reads state. AEGIS list/get/search/verify = true. */
  readOnlyHint?: boolean;
  /**
   * True iff the tool can perform irreversible state changes (revoke).
   * Hosts should require explicit user confirmation before invoking.
   */
  destructiveHint?: boolean;
  /**
   * True iff invoking the tool multiple times with the same arguments has
   * the same observable effect as invoking it once. AEGIS revokes are
   * idempotent; registrations are not (each call mints a new agent).
   */
  idempotentHint?: boolean;
  /**
   * True iff the tool interacts with an "open world" (network calls,
   * filesystem, external systems). All AEGIS tools hit the API → true.
   */
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /** MCP 1.0 tool annotations. Required for every tool. */
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
