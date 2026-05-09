// Bloomberg-density metric strip. Six numbers in a row, no cards, no
// graphs. Tracks the operator memory feedback (memory: feedback_less_cards)
// — MetricStrip > card grid.

interface Props {
  total: number;
  active: number;
  invocations24h: number;
  denials24h: number;
  denialRate: number;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtPct(p: number): string {
  return `${p.toFixed(2)}%`;
}

export function McpMetricStrip({ total, active, invocations24h, denials24h, denialRate }: Props) {
  return (
    <dl className="metric-strip" aria-label="MCP servers summary">
      <Item label="registered" value={fmtNum(total)} />
      <Item label="active" value={fmtNum(active)} tone={active < total ? 'warn' : 'ok'} />
      <Item label="invocations 24h" value={fmtNum(invocations24h)} />
      <Item label="denials 24h" value={fmtNum(denials24h)} tone={denials24h > 0 ? 'warn' : 'muted'} />
      <Item label="denial rate" value={fmtPct(denialRate)} tone={denialRate > 1 ? 'warn' : 'ok'} />
    </dl>
  );
}

function Item({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
