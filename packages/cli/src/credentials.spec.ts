// Tests credential file/dir creation mode.
//
// Why: a previous impl wrote ~/.aegis/credentials.json at default-umask perms
// (typically 0644) and chmod'd it down afterward, leaving a window where the
// API key was readable by other local users. We now mirror the Go canonical
// (`internal/config/config.go:Save`): mkdir 0700 + writeFile-with-mode 0600 +
// atomic rename. These tests pin both modes and the atomicity invariant.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync, mkdirSync, readdirSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let TMP_HOME: string;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => TMP_HOME };
});

async function importFresh() {
  vi.resetModules();
  return await import('./credentials');
}

beforeEach(() => {
  TMP_HOME = mkdtempSync(join(tmpdir(), 'aegis-cli-creds-'));
});
afterEach(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
});

describe('writeCredentials — file/dir mode hardening', () => {
  it('creates ~/.aegis at mode 0700 and credentials.json at mode 0600 from scratch', async () => {
    const { writeCredentials, credentialsPath } = await importFresh();
    await writeCredentials({ apiKey: 'sk_live_test', baseUrl: 'https://api.aegis.dev' });

    const path = credentialsPath();
    expect(existsSync(path)).toBe(true);

    const fileMode = statSync(path).mode & 0o777;
    expect(fileMode).toBe(0o600);

    const dirMode = statSync(join(TMP_HOME, '.aegis')).mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it('tightens a pre-existing loose-perm credentials file to 0600', async () => {
    const { writeCredentials, credentialsPath } = await importFresh();
    // Simulate a credentials file previously written at the buggy 0644.
    mkdirSync(join(TMP_HOME, '.aegis'), { mode: 0o755, recursive: true });
    writeFileSync(credentialsPath(), '{"apiKey":"old","baseUrl":"x"}\n');
    chmodSync(credentialsPath(), 0o644);

    await writeCredentials({ apiKey: 'sk_live_new', baseUrl: 'https://api.aegis.dev' });

    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
    expect(statSync(join(TMP_HOME, '.aegis')).mode & 0o777).toBe(0o700);
  });

  it('does not leave a .tmp sidecar on success', async () => {
    const { writeCredentials } = await importFresh();
    await writeCredentials({ apiKey: 'sk_live_test', baseUrl: 'https://api.aegis.dev' });

    const entries = readdirSync(join(TMP_HOME, '.aegis'));
    expect(entries).toContain('credentials.json');
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });

  it('round-trips: writeCredentials then readCredentials returns the same payload', async () => {
    const { writeCredentials, readCredentials } = await importFresh();
    const payload = {
      apiKey: 'sk_live_round_trip',
      baseUrl: 'https://api.aegis.dev',
      principalId: 'prin_123',
      label: 'test',
    };
    await writeCredentials(payload);
    const round = await readCredentials();
    expect(round).toEqual(payload);
  });

  it('writes valid JSON (no half-written state visible mid-process)', async () => {
    const { writeCredentials, credentialsPath } = await importFresh();
    await writeCredentials({ apiKey: 'sk_live_test', baseUrl: 'https://api.aegis.dev' });
    // If atomic rename worked, the final file is always parseable.
    const raw = readFileSync(credentialsPath(), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
