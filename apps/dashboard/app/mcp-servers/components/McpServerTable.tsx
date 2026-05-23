// Bloomberg-density data table — every column carries operator-relevant
// information. No empty cells, no decorative columns. Per memory feedback:
// `feedback_less_cards`.

interface McpServerSummary {
  id: string;
  name: string;
  endpoint: string;
  transport: string;
  actionPrefix: string;
  minTrustBand: string;
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
  recentInvocations: number;
  recentDenials: number;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '–';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function statusBadge(s: string): string {
  switch (s) {
    case 'ACTIVE':
      return 'ok';
    case 'PAUSED':
      return 'warn';
    case 'REVOKED':
      return 'crit';
    default:
      return 'muted';
  }
}

export function McpServerTable({ servers }: { servers: McpServerSummary[] }) {
  if (servers.length === 0) {
    return (
      <div className="data-empty">
        <p>No MCP servers registered.</p>
        <pre className="hint">{`# from your terminal:
cerniq mcp install --host claude-desktop`}</pre>
      </div>
    );
  }
  return (
    <table className="data-table dense" aria-label="MCP servers">
      <thead>
        <tr>
          <th>name</th>
          <th>endpoint</th>
          <th>transport</th>
          <th>action prefix</th>
          <th>min band</th>
          <th>status</th>
          <th className="num">inv 24h</th>
          <th className="num">denied 24h</th>
          <th>last seen</th>
          <th>created</th>
        </tr>
      </thead>
      <tbody>
        {servers.map((s) => (
          <tr key={s.id}>
            <td className="mono">{s.name}</td>
            <td className="mono dim">{s.endpoint}</td>
            <td className="mono">{s.transport}</td>
            <td className="mono">{s.actionPrefix}</td>
            <td>{s.minTrustBand}</td>
            <td>
              <span className={`badge badge-${statusBadge(s.status)}`}>{s.status}</span>
            </td>
            <td className="num">{s.recentInvocations.toLocaleString()}</td>
            <td className={`num ${s.recentDenials > 0 ? 'crit' : ''}`}>
              {s.recentDenials.toLocaleString()}
            </td>
            <td className="dim">{relativeTime(s.lastSeenAt)}</td>
            <td className="dim">{relativeTime(s.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
