// KeyStorage — Round 25 Lane A. Pluggable persistence for the Ed25519
// private keys that `generateKeypair()` produces.
//
// Why this exists:
//
// The SDK's README told developers "persist privateKey locally — AEGIS
// never receives it." Juniors then dropped the key into a `.env` file and
// leaked it via git, or into `localStorage` where any XSS could exfiltrate
// it. The CLAUDE.md invariant ("private keys never enter AEGIS") only
// holds when the developer's storage choice is itself sound.
//
// KeyStorage is the contract. Implementations:
//
//   - `memory()`        — in-process Map. Edge / serverless / tests.
//   - `fileSystem()`    — `~/.aegis/keys/` with 0600 perms. Node only.
//   - `indexedDB()`     — origin-scoped IndexedDB. Browser only.
//   - `kms({ provider })` — adapter shape for AWS/GCP/Vault KMS; never sees
//                            the raw private bytes, instead returns a signer
//                            that delegates to the KMS Sign API.
//
// All implementations encode the private key as base64url so the wire shape
// matches what `generateKeypair()` returns. Public keys travel alongside in
// the same record so the SDK can re-link an existing key to an agentId on
// reboot without a server round-trip.

import { capabilities } from './runtime.js';

export interface StoredKey {
  /** Base64url-encoded Ed25519 private key (32 bytes after decode). */
  privateKey: string;
  /** Base64url-encoded Ed25519 public key (32 bytes after decode). */
  publicKey: string;
  /** ISO timestamp of original creation. Set by the SDK on first put. */
  createdAt: string;
  /** Optional agentId once the key has been registered with AEGIS. */
  agentId?: string;
  /** Free-form label for human selection (matches AgentRecord.label). */
  label?: string;
}

export interface KeyStorage {
  /** Read a key by name. Returns undefined when absent. */
  get(name: string): Promise<StoredKey | undefined>;
  /** Write a key under a name. Overwrites silently. */
  put(name: string, key: StoredKey): Promise<void>;
  /** Remove a key. No-op when absent. */
  delete(name: string): Promise<void>;
  /** List all stored key names. Order is implementation-defined. */
  list(): Promise<string[]>;
}

// ── Implementations ─────────────────────────────────────────────────────────

/**
 * In-memory storage. Lifetime is the JS process. Use for tests, edge
 * workers (which restart per request anyway), and ephemeral CLI flows.
 */
export function memoryKeyStorage(): KeyStorage {
  const store = new Map<string, StoredKey>();
  return {
    async get(name) {
      return store.get(name);
    },
    async put(name, key) {
      store.set(name, key);
    },
    async delete(name) {
      store.delete(name);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

/**
 * File-system storage. Writes to `$AEGIS_KEY_DIR` (or `~/.aegis/keys/` by
 * default). Each key is a JSON file at `<dir>/<name>.json` with mode 0600.
 * The directory itself is created with mode 0700 on first use.
 *
 * Refuses to run on non-Node runtimes (throws at construction). Use
 * `kms()` or `indexedDB()` instead in those environments.
 */
export function fileSystemKeyStorage(opts: { dir?: string } = {}): KeyStorage {
  const caps = capabilities();
  if (!caps.hasFilesystem) {
    throw new Error(
      `fileSystemKeyStorage: requires Node/Bun/Deno runtime (detected ${caps.runtime}). Use memoryKeyStorage() or indexedDBKeyStorage() instead.`,
    );
  }
  // Lazy-import node:fs / node:path / node:os so non-Node bundles don't
  // pull these in. The capability check above guards the dynamic require.
  // type-rationale: top-level `require` is unavailable in pure ESM; we
  // resolve via createRequire only on Node-shaped runtimes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = (globalThis as any).require ?? eval('require');
  const fs = req('node:fs');
  const path = req('node:path');
  const os = req('node:os');

  const dir = opts.dir ?? path.join(os.homedir(), '.aegis', 'keys');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const fileFor = (name: string): string => {
    // Strict allow-list: alphanumerics, dash, underscore. Keeps the key
    // name from escaping the directory via `../` or absolute paths.
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`invalid key name "${name}" — allowed chars: [a-zA-Z0-9_-]`);
    }
    return path.join(dir, `${name}.json`);
  };
  return {
    async get(name) {
      const file = fileFor(name);
      if (!fs.existsSync(file)) return undefined;
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw) as StoredKey;
    },
    async put(name, key) {
      const file = fileFor(name);
      fs.writeFileSync(file, JSON.stringify(key), { mode: 0o600 });
    },
    async delete(name) {
      const file = fileFor(name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    },
    async list() {
      const entries: string[] = fs.readdirSync(dir);
      return entries
        .filter((e: string) => e.endsWith('.json'))
        .map((e: string) => e.replace(/\.json$/, ''));
    },
  };
}

/**
 * IndexedDB storage — browser only. Origin-scoped, persists across tabs
 * and reloads. Refuses on non-browser runtimes.
 *
 * NOTE: IndexedDB is plain-text storage. For high-stakes browser flows
 * the recommended pattern is `kms()` with a remote signer (the browser
 * never holds the raw private bytes). IndexedDB is for low-stakes /
 * development convenience.
 */
export function indexedDBKeyStorage(dbName = 'aegis-keys'): KeyStorage {
  const caps = capabilities();
  if (caps.runtime !== 'browser') {
    throw new Error(
      `indexedDBKeyStorage: requires browser runtime (detected ${caps.runtime}). Use kms() in non-browser environments.`,
    );
  }
  // type-rationale: globalThis.indexedDB is typed in lib.dom but TS sees
  // `any` because the runtime check above narrows differently than the
  // type system. We cast through `as any` once at the boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idb: IDBFactory = (globalThis as any).indexedDB;
  const STORE = 'keys';

  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
  }
  async function tx<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = op(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB op failed'));
    });
  }
  return {
    async get(name) {
      // type-rationale: get() returns `any` — narrow to StoredKey | undefined.
      const v = await tx<unknown>('readonly', (s) => s.get(name));
      return (v as StoredKey | undefined) ?? undefined;
    },
    async put(name, key) {
      await tx<IDBValidKey>('readwrite', (s) => s.put(key, name));
    },
    async delete(name) {
      await tx<undefined>('readwrite', (s) => s.delete(name));
    },
    async list() {
      const v = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
      return v.map((k) => String(k));
    },
  };
}

// ── KMS adapter shape (no implementation, but typed) ────────────────────────

/**
 * Marker for KMS-backed storage. The SDK never holds private bytes; instead,
 * `sign()` round-trips through the KMS Sign API.
 *
 * Implementations live in companion adapter packages (`@aegis/adapter-aws-kms`,
 * etc.) — kept out of the core SDK to avoid pulling cloud SDKs into edge bundles.
 *
 * The Round 25 SDK ships the SHAPE; full provider implementations land in
 * Round 26 alongside `@aegis/adapter-aws-lambda` / `-vercel-edge` / etc.
 */
export interface KmsKeyStorage {
  readonly kind: 'kms';
  /** Sign a message with the KMS-held private key. Returns base64url. */
  sign(name: string, message: Uint8Array): Promise<string>;
  /** Return the public key bytes; never returns the private. */
  publicKey(name: string): Promise<string>;
}

/**
 * Pick the default storage adapter for the current runtime. Used by
 * `Aegis.quickstart()` when the caller didn't supply one explicitly.
 *
 *   - node / bun / deno  → fileSystem()
 *   - browser            → indexedDB()
 *   - edge / workers     → memory() (ephemeral; warns)
 */
export function defaultKeyStorage(opts: { dir?: string } = {}): KeyStorage {
  const caps = capabilities();
  if (caps.hasFilesystem) return fileSystemKeyStorage(opts);
  if (caps.runtime === 'browser') return indexedDBKeyStorage();
  return memoryKeyStorage();
}
