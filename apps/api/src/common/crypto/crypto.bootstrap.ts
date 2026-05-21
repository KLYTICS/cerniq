// Crypto bootstrap — single source of truth for noble/ed25519 sync hashing
// and the KmsAdapter contract.
//
// Why this exists:
//   - `@noble/ed25519` v2 requires `ed.etc.sha512Sync` to be set before any
//     sync sign/verify operation. We were setting it in three files
//     (ed25519.util.ts, jwt.util.ts, and the SDK). Three places means three
//     opportunities for "imported in the wrong order, runtime crash."
//   - Importing this module anywhere in the API has a side effect that
//     installs the sha512Sync handler exactly once.
//   - It's also the natural home for the `KmsAdapter` interface (ADR-0011)
//     and the `getActiveSigner` factory that future verify/audit code uses
//     instead of holding raw private keys.
//
// Usage:
//   ```ts
//   import './crypto.bootstrap.js';     // side-effect import; first
//   import * as ed from '@noble/ed25519';
//   ```
// Or, for the full contract:
//   ```ts
//   import { bootstrapCrypto, getKmsAdapter, type KmsAdapter } from './crypto.bootstrap.js';
//   bootstrapCrypto();
//   const kms = getKmsAdapter();
//   const signer = await kms.getActiveKey('AUDIT');
//   const sig = await signer.sign(message);
//   ```
//
// IMPORTANT: this module avoids any NestJS / Prisma / Redis imports so it
// can be reused by the verify hot path (ADR-0003) — it must run unmodified
// on Cloudflare Workers.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

let bootstrapped = false;

/**
 * Idempotent. Safe to call from anywhere; only the first call has effect.
 * Returns true on the first call, false on subsequent calls — useful for
 * tests that want to assert ordering.
 */
export function bootstrapCrypto(): boolean {
  if (bootstrapped) return false;
  ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
  bootstrapped = true;
  return true;
}

// Side effect: when this module is imported, crypto is bootstrapped.
// Existing files that set sha512Sync inline can migrate to importing
// this module at their top — see WORK_BOARD M-025.
bootstrapCrypto();

// ───────────────────────────────────────────────────────────────────────────
// KmsAdapter — the contract committed in ADR-0011.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The signing-key purposes AEGIS understands. New purposes must be added
 * here AND in `docs/decisions/0011-key-rotation-kms.md`.
 *
 *   AUDIT     — signs audit-event chain entries (Ed25519 today).
 *   JWT       — signs policy-issued JWTs (Ed25519 today).
 *   WEBHOOK   — signs outbound webhook bodies (per-RP key namespace).
 *   AUDIT_PQ  — hybrid PQ counterpart of AUDIT (ML-DSA-65, ADR-0013).
 *   JWT_PQ    — hybrid PQ counterpart of JWT.
 */
export type KmsKeyPurpose = 'AUDIT' | 'JWT' | 'WEBHOOK' | 'AUDIT_PQ' | 'JWT_PQ';

export interface KeyMetadata {
  /** Stable identifier published in the JWKS endpoint and stamped on signed records. */
  kid: string;
  purpose: KmsKeyPurpose;
  /** base64url public key. For PQ purposes, this is the ML-DSA-65 verifying key. */
  publicKey: string;
  algorithm: 'EdDSA' | 'EdDSA+ML-DSA-65' | 'ML-DSA-65';
  validFrom: string; // ISO
  validUntil: string | null;
}

export interface ActiveSigner {
  metadata: KeyMetadata;
  /**
   * Sign a message. May be a local Ed25519 op or a remote KMS round-trip
   * depending on the adapter. Implementations MUST NOT expose private key
   * material to callers — `sign(msg)` is the only way to use the key.
   */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface KmsAdapter {
  /** Provider tag — for telemetry, never user-facing. */
  readonly providerId: 'in-memory' | 'aws-kms' | 'gcp-kms' | 'vault-transit' | 'azure-keyvault';

  /**
   * Returns the *currently active* signer for the given purpose. Active
   * means the one that should sign new records. Verify code uses
   * `getKeyByKid(kid)` instead.
   */
  getActiveKey(purpose: KmsKeyPurpose): Promise<ActiveSigner>;

  /**
   * Verify-side lookup. Returns the public key for a `kid` recorded on a
   * historical signed record. Returns null if `kid` is unknown — that's a
   * cryptographic failure, surfaces upstream as INVALID_SIGNATURE.
   */
  getKeyByKid(kid: string): Promise<{ kid: string; publicKey: string; algorithm: KeyMetadata['algorithm'] } | null>;

  /**
   * Powers the JWKS endpoint at `/.well-known/audit-signing-key` and the
   * sibling JWT keys endpoint. Returns metadata only — never private keys.
   */
  listKeys(purpose: KmsKeyPurpose): Promise<KeyMetadata[]>;
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory adapter — default for dev and current single-region prod.
// Reads keys from env at construction time. Production deployments wire in
// AwsKmsAdapter / VaultTransitAdapter from `apps/api/src/modules/kms/`
// (M-023, M-030). Until those land, this is what runs.
// ───────────────────────────────────────────────────────────────────────────

interface InMemoryKeyEntry extends KeyMetadata {
  privateKey: Uint8Array;
}

/**
 * The in-memory adapter is intentionally minimal. It exists so verify and
 * audit code can be written against `KmsAdapter` from day one without
 * waiting for cloud-KMS adapters to land.
 *
 * Configure by registering keys at startup (e.g. from Nest's
 * AppConfigService). Do not pass raw env values around the codebase —
 * this is the only place they're read.
 */
export class InMemoryKmsAdapter implements KmsAdapter {
  readonly providerId = 'in-memory' as const;
  private readonly keys = new Map<string, InMemoryKeyEntry>();
  private readonly active = new Map<KmsKeyPurpose, string>();

  registerKey(entry: InMemoryKeyEntry, opts: { setActive?: boolean } = {}): void {
    this.keys.set(entry.kid, entry);
    if (opts.setActive ?? entry.validUntil === null) {
      this.active.set(entry.purpose, entry.kid);
    }
  }

  async getActiveKey(purpose: KmsKeyPurpose): Promise<ActiveSigner> {
    const kid = this.active.get(purpose);
    if (!kid) throw new Error(`KMS: no active key registered for purpose=${purpose}`);
    const entry = this.keys.get(kid);
    if (!entry) throw new Error(`KMS: active kid=${kid} missing from key store`);

    return {
      metadata: stripPrivate(entry),
      sign: async (message: Uint8Array) => {
        if (entry.algorithm === 'EdDSA') {
          return await ed.signAsync(message, entry.privateKey);
        }
        // PQ + hybrid signing land in M-035 — tracked in ADR-0013. Until
        // then this adapter rejects PQ purposes loudly so feature-flagged
        // code can't quietly produce un-signable PQ records.
        throw new Error(`KMS: in-memory adapter does not yet sign algorithm=${entry.algorithm}`);
      },
    };
  }

  async getKeyByKid(kid: string): Promise<{ kid: string; publicKey: string; algorithm: KeyMetadata['algorithm'] } | null> {
    const entry = this.keys.get(kid);
    if (!entry) return null;
    return { kid: entry.kid, publicKey: entry.publicKey, algorithm: entry.algorithm };
  }

  async listKeys(purpose: KmsKeyPurpose): Promise<KeyMetadata[]> {
    return Array.from(this.keys.values()).filter((k) => k.purpose === purpose).map(stripPrivate);
  }
}

function stripPrivate(entry: InMemoryKeyEntry): KeyMetadata {
  const { privateKey: _privateKey, ...rest } = entry;
  return rest;
}

// ───────────────────────────────────────────────────────────────────────────
// Module-level singleton accessor. Set by the API bootstrap (Nest
// AppModule), read by anything that needs to sign/verify. Tests may
// `setKmsAdapter(new InMemoryKmsAdapter())` to inject a clean instance.
// ───────────────────────────────────────────────────────────────────────────

let kmsSingleton: KmsAdapter | null = null;

export function setKmsAdapter(adapter: KmsAdapter): void {
  kmsSingleton = adapter;
}

export function getKmsAdapter(): KmsAdapter {
  if (!kmsSingleton) {
    throw new Error('KMS adapter not initialized — call setKmsAdapter() during bootstrap');
  }
  return kmsSingleton;
}

/**
 * Test helper. Resets the singleton so each test gets a clean adapter.
 * Production code MUST NOT call this.
 */
export function __resetKmsForTests(): void {
  kmsSingleton = null;
}
