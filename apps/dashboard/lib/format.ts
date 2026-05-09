// Display formatters. Pure, no allocations on the hot path. All return strings
// so server components can render without round-tripping numbers through JSON.

export function relativeTime(input: string | Date | null | undefined): string {
  if (!input) return '–';
  const ms = Date.now() - new Date(input).getTime();
  if (Number.isNaN(ms)) return '–';
  if (ms < 0) return 'in the future';
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(input).toISOString().slice(0, 10);
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.trunc(n));
}

export function fmtPct(p: number | null | undefined, digits = 2): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '–';
  return `${p.toFixed(digits)}%`;
}

export function shortId(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function trustBandTone(band: string): 'ok' | 'warn' | 'crit' | 'muted' {
  switch (band) {
    case 'PLATINUM':
    case 'VERIFIED':
      return 'ok';
    case 'WATCH':
      return 'warn';
    case 'FLAGGED':
      return 'crit';
    default:
      return 'muted';
  }
}

export function statusTone(status: string): 'ok' | 'warn' | 'crit' | 'muted' {
  switch (status) {
    case 'ACTIVE':
    case 'active':
      return 'ok';
    case 'PENDING_VERIFICATION':
    case 'SUSPENDED':
    case 'expired':
      return 'warn';
    case 'REVOKED':
    case 'revoked':
      return 'crit';
    default:
      return 'muted';
  }
}
