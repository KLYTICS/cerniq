import 'server-only';

type HealthResult =
  | { source: 'api'; status: 'ok' | 'degraded' | 'down'; checkedAt: string }
  | { source: 'fallback'; reason: string };

async function fetchHealth(): Promise<HealthResult> {
  const base = process.env.OKORO_API_BASE_URL;
  if (!base) return { source: 'fallback', reason: 'OKORO_API_BASE_URL unset' };
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/health`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return { source: 'api', status: 'down', checkedAt: new Date().toISOString() };
    }
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    const status: 'ok' | 'degraded' | 'down' =
      body.status === 'ok' || body.status === 'healthy'
        ? 'ok'
        : body.status === 'degraded'
          ? 'degraded'
          : 'ok';
    return { source: 'api', status, checkedAt: new Date().toISOString() };
  } catch (err) {
    return { source: 'fallback', reason: err instanceof Error ? err.message : 'fetch error' };
  }
}

const COLOR: Record<string, string> = {
  ok: 'var(--okoro-verified)',
  degraded: 'var(--okoro-pending)',
  down: 'var(--okoro-denied)',
};

const LABEL: Record<string, string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
};

export async function StatusBadge() {
  const result = await fetchHealth();
  const tone = result.source === 'api' ? result.status : 'down';
  const color = COLOR[tone];
  const label = result.source === 'api' ? LABEL[tone] : 'Unknown';
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-[var(--okoro-mist)] bg-[var(--okoro-ink)] px-3 py-1 text-xs"
      data-source={result.source}
      data-status={tone}
      data-testid="status-badge"
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="font-mono text-[var(--okoro-halo)]">api.okoroapp.com · {label}</span>
      {result.source === 'fallback' && (
        <span className="font-mono text-[var(--okoro-shadow)]">({result.reason})</span>
      )}
    </span>
  );
}
