// Output helpers — colored stderr for status, plain stdout for data so
// CLI output is pipe-friendly (`aegis agents list | jq ...`).

import kleur from 'kleur';

export function info(msg: string): void {
  process.stderr.write(`${kleur.cyan('ℹ')}  ${msg}\n`);
}
export function ok(msg: string): void {
  process.stderr.write(`${kleur.green('✓')}  ${msg}\n`);
}
export function warn(msg: string): void {
  process.stderr.write(`${kleur.yellow('!')}  ${msg}\n`);
}
export function err(msg: string): void {
  process.stderr.write(`${kleur.red('✗')}  ${msg}\n`);
}

export function emitJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function emitTable(rows: Record<string, unknown>[], columns?: string[]): void {
  const first = rows[0];
  if (first === undefined) {
    info('(no rows)');
    return;
  }
  const cols = columns ?? Object.keys(first);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => stringify(r[c]).length)),
  );
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  process.stdout.write(cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ') + '\n');
  process.stdout.write(sep + '\n');
  for (const r of rows) {
    process.stdout.write(
      cols.map((c, i) => stringify(r[c]).padEnd(widths[i] ?? 0)).join('  ') + '\n',
    );
  }
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}
