// Output helpers — colored stderr for status, plain stdout for data so
// CLI output is pipe-friendly (`aegis agents list | jq ...`).
//
// Output mode is a process-level switch set by `bin.ts` from the global
// `--output` flag. Defaults to `table` (human-readable). When set to
// `json`, every emit() call writes structured JSON to stdout so scripts
// can pipe directly into `jq`.

import kleur from 'kleur';

export type OutputMode = 'table' | 'json';

let currentMode: OutputMode = 'table';

/** Set the process-wide output mode. Idempotent; safe to call from bin.ts. */
export function setOutputMode(mode: OutputMode): void {
  currentMode = mode;
}

export function getOutputMode(): OutputMode {
  return currentMode;
}

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
  const stringify = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
    return JSON.stringify(v);
  };
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => stringify(r[c]).length)),
  );
  const sep = cols.map((_, i) => '─'.repeat(widths[i]!)).join('  ');
  process.stdout.write(cols.map((c, i) => c.padEnd(widths[i]!)).join('  ') + '\n');
  process.stdout.write(sep + '\n');
  for (const r of rows) {
    process.stdout.write(
      cols.map((c, i) => stringify(r[c]).padEnd(widths[i]!)).join('  ') + '\n',
    );
  }
}

/**
 * Emit a record collection in the active output mode. Commands should
 * prefer this over calling `emitJson` / `emitTable` directly so
 * `--output json` works without per-command branches.
 *
 * `rows` is the data shown in table mode; `payload` is what's emitted
 * in json mode (often the full API response with pagination cursors,
 * which would clutter a table).
 */
export function emit(
  payload: unknown,
  rows: Record<string, unknown>[],
  columns?: string[],
): void {
  if (currentMode === 'json') {
    emitJson(payload);
    return;
  }
  emitTable(rows, columns);
}

/**
 * Emit a single record. In json mode prints the record; in table mode
 * prints a 1-column key/value layout so single records still look like
 * a CLI rather than a debug dump.
 */
export function emitRecord(payload: Record<string, unknown>): void {
  if (currentMode === 'json') {
    emitJson(payload);
    return;
  }
  const rows = Object.entries(payload).map(([key, value]) => ({
    field: key,
    value:
      value === null || value === undefined
        ? ''
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
            ? String(value)
            : JSON.stringify(value),
  }));
  emitTable(rows, ['field', 'value']);
}
