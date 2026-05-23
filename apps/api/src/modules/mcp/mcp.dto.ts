// MCP control-plane DTOs (ADR-0008). The MCP module manages the registry
// of trusted MCP servers per principal. Each registration represents an
// MCP server that calls CERNIQ's verify endpoint for tool gating.

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';

export interface RegisterMcpServerDto {
  /** Human-readable name. Unique per principal. */
  name: string;
  /** Where the MCP server is hosted. For stdio, this is informational. */
  endpoint: string;
  transport: McpTransport;
  /** Optional URL exposing the server's tools/list manifest for discovery. */
  manifestUrl?: string;
  /** CERNIQ verifies tool calls under these action prefixes (e.g. "mcp.fs."). */
  actionPrefix: string;
  /** Minimum trust band required to invoke this server's tools. */
  minTrustBand?: 'PLATINUM' | 'VERIFIED' | 'WATCH';
}

export interface McpServerDto {
  id: string;
  principalId: string;
  name: string;
  endpoint: string;
  transport: McpTransport;
  manifestUrl: string | null;
  actionPrefix: string;
  minTrustBand: 'PLATINUM' | 'VERIFIED' | 'WATCH';
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED';
  createdAt: string;
  /** Computed at read time from recent verify events on this server. */
  lastSeenAt: string | null;
  /** Count of verifies in the last 24h, computed at read time. */
  recentInvocations: number;
}

export interface ListMcpServersDto {
  servers: McpServerDto[];
  total: number;
}
