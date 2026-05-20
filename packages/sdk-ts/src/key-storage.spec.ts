import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  memoryKeyStorage,
  fileSystemKeyStorage,
  defaultKeyStorage,
  type StoredKey,
} from './key-storage.js';

const SAMPLE: StoredKey = {
  privateKey: 'priv_test_b64u',
  publicKey: 'pub_test_b64u',
  createdAt: '2026-05-20T00:00:00.000Z',
  label: 'test',
};

describe('memoryKeyStorage', () => {
  it('round-trips a key by name', async () => {
    const s = memoryKeyStorage();
    expect(await s.get('a')).toBeUndefined();
    await s.put('a', SAMPLE);
    expect(await s.get('a')).toEqual(SAMPLE);
  });

  it('list() returns inserted names; delete removes them', async () => {
    const s = memoryKeyStorage();
    await s.put('a', SAMPLE);
    await s.put('b', SAMPLE);
    expect((await s.list()).sort()).toEqual(['a', 'b']);
    await s.delete('a');
    expect(await s.list()).toEqual(['b']);
  });
});

describe('fileSystemKeyStorage', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-keys-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a JSON file with mode 0600 and round-trips', async () => {
    const s = fileSystemKeyStorage({ dir });
    await s.put('agent-one', SAMPLE);
    const file = path.join(dir, 'agent-one.json');
    expect(fs.existsSync(file)).toBe(true);
    // POSIX-only — owner-rw permission check. On platforms where umask
    // forces different bits, mode will still be ≤ 0o600.
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode & 0o077).toBe(0); // group + other have no bits
    expect(await s.get('agent-one')).toEqual(SAMPLE);
  });

  it('rejects names that could escape the directory', async () => {
    const s = fileSystemKeyStorage({ dir });
    await expect(s.put('../escape', SAMPLE)).rejects.toThrow(/invalid key name/);
    await expect(s.put('with space', SAMPLE)).rejects.toThrow(/invalid key name/);
    await expect(s.put('/abs/path', SAMPLE)).rejects.toThrow(/invalid key name/);
  });

  it('list() returns only .json basenames', async () => {
    const s = fileSystemKeyStorage({ dir });
    await s.put('one', SAMPLE);
    await s.put('two', SAMPLE);
    fs.writeFileSync(path.join(dir, 'README.txt'), 'noise');
    expect((await s.list()).sort()).toEqual(['one', 'two']);
  });

  it('delete is a no-op when the file does not exist', async () => {
    const s = fileSystemKeyStorage({ dir });
    await expect(s.delete('nonexistent')).resolves.toBeUndefined();
  });
});

describe('defaultKeyStorage (Node test runtime)', () => {
  it('returns a filesystem-backed adapter when run on Node', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-default-'));
    try {
      const s = defaultKeyStorage({ dir });
      await s.put('default-test', SAMPLE);
      expect(await s.get('default-test')).toEqual(SAMPLE);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
