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
  if (rows.length === 0) {
    info('(no rows)');
    return;
  }
  const cols = columns ?? Object.keys(rows[0]!);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)),
  );
  const sep = cols.map((_, i) => '─'.repeat(widths[i]!)).join('  ');
  process.stdout.write(cols.map((c, i) => c.padEnd(widths[i]!)).join('  ') + '\n');
  process.stdout.write(sep + '\n');
  for (const r of rows) {
    process.stdout.write(
      cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i]!)).join('  ') + '\n',
    );
  }
}
