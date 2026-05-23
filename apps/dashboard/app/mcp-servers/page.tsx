// MCP servers — registered relying-party MCP servers per principal.
// Bloomberg-density data table, no card grids. ADR-0008 §4.

import type { Metadata } from 'next';

import { McpMetricStrip } from './components/McpMetricStrip';
import { McpServerTable } from './components/McpServerTable';

export const metadata: Metadata = {
  title: 'MCP servers · CERNIQ',
};

interface McpServerSummary {
  id: string;
  name: string;
  endpoint: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  actionPrefix: string;
  minTrustBand: 'PLATINUM' | 'VERIFIED' | 'WATCH';
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED';
  createdAt: string;
  lastSeenAt: string | null;
  recentInvocations: number;
  /** Denials in the last 24h. */
  recentDenials: number;
}

interface McpServerListResponse {
  servers: McpServerSummary[];
  total: number;
}

async function fetchMcpServers(): Promise<McpServerListResponse> {
  // The dashboard runs server-side here; we hit the API directly.
  // Auth via per-request session cookie wired in M-020.
  const baseUrl = process.env.CERNIQ_API_BASE_URL ?? 'http://localhost:4000';
  const apiKey = process.env.CERNIQ_DASHBOARD_API_KEY ?? '';
  if (!apiKey) {
    return { servers: [], total: 0 };
  }
  try {
    const res = await fetch(`${baseUrl}/v1/mcp-servers`, {
      headers: { 'X-CERNIQ-API-Key': apiKey, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { servers: [], total: 0 };
    return (await res.json()) as McpServerListResponse;
  } catch {
    return { servers: [], total: 0 };
  }
}

export default async function McpServersPage() {
  const data = await fetchMcpServers();
  const totalInvocations = data.servers.reduce((s, x) => s + x.recentInvocations, 0);
  const totalDenials = data.servers.reduce((s, x) => s + x.recentDenials, 0);
  const denialRate = totalInvocations > 0 ? (totalDenials / totalInvocations) * 100 : 0;
  const active = data.servers.filter((s) => s.status === 'ACTIVE').length;

  return (
    <section className="cerniq-page">
      <header className="cerniq-page-header">
        <h1>MCP servers</h1>
        <p className="muted">
          Trusted MCP servers registered to your principal. Each row is a relying party that calls
          CERNIQ for tool-call verification via <code>@cerniq/mcp-bridge</code>.
        </p>
      </header>

      <McpMetricStrip
        total={data.total}
        active={active}
        invocations24h={totalInvocations}
        denials24h={totalDenials}
        denialRate={denialRate}
      />

      <McpServerTable servers={data.servers} />
    </section>
  );
}
