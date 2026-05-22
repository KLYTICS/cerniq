// VaultTransitAdapter — HashiCorp Vault Transit secrets engine.
//
// Vault's transit/sign endpoint supports `ed25519` natively. OKORO sends
// the message bytes; Vault returns a signature in `vault:v1:<b64>` format
// which we strip + decode. The Ed25519 private key never leaves Vault.
//
// Wire format reference:
//   POST /v1/transit/sign/{name}
//   { "input": "<base64 of message>" }
//   → { "data": { "signature": "vault:v1:<base64 raw signature>" } }
//
// Resilience: on 5xx from Vault, the adapter retries once with a 100ms
// backoff. On the second failure it throws — caller (audit.service)
// retries via outbox per ADR-0007.

import { Injectable, Logger } from '@nestjs/common';

import type {
  ActiveSigner,
  KeyMetadata,
  KmsAdapter,
  KmsKeyPurpose,
} from '../../common/crypto/crypto.bootstrap.js';

import { withKmsSpan } from './kms.spans';

export interface VaultTransitAdapterConfig {
  /**
   * Map of purpose → registered transit keys (one active per purpose).
   * The transit key NAME is what Vault's `/v1/transit/sign/{name}` URL uses;
   * OKORO's `kid` is its own naming and may differ from the transit name.
   */
  keys: Partial<Record<KmsKeyPurpose, VaultTransitKey[]>>;
}

export interface VaultTransitKey {
  kid: string;
  /** Vault transit key name. */
  transitName: string;
  /** Vault key version (integer; Vault appends to "vault:v{n}:..."). */
  version: number;
  /** base64url Ed25519 public key — fetched once from Vault read-key API. */
  publicKey: string;
  algorithm: KeyMetadata['algorithm'];
  validFrom: string;
  validUntil: string | null;
}

/** Minimal Vault HTTP surface — production uses fetch via VaultClient. */
export interface VaultClientLike {
  /** POST /v1/transit/sign/{name} with `{ input: base64(message) }`. */
  signTransit(input: { name: string; input: string }): Promise<{ data: { signature: string } }>;
}

@Injectable()
export class VaultTransitAdapter implements KmsAdapter {
  readonly providerId = 'vault-transit' as const;
  private readonly logger = new Logger(VaultTransitAdapter.name);
  private readonly byKid = new Map<string, { key: VaultTransitKey; purpose: KmsKeyPurpose }>();
  private readonly active = new Map<KmsKeyPurpose, string>();

  constructor(
    config: VaultTransitAdapterConfig,
    private readonly vault: VaultClientLike,
  ) {
    for (const [purpose, list] of Object.entries(config.keys)) {
      if (!list) continue;
      for (const k of list) {
        this.byKid.set(k.kid, { key: k, purpose: purpose as KmsKeyPurpose });
        if (k.validUntil === null) this.active.set(purpose as KmsKeyPurpose, k.kid);
      }
    }
    this.logger.log(`VaultTransitAdapter registered ${this.byKid.size} key(s)`);
  }

  async getActiveKey(purpose: KmsKeyPurpose): Promise<ActiveSigner> {
    const kid = this.active.get(purpose);
    if (!kid) throw new Error(`KMS: no active Vault transit key for purpose=${purpose}`);
    const entry = this.byKid.get(kid);
    if (!entry) throw new Error(`KMS: active kid=${kid} missing`);

    return {
      metadata: this.toMetadata(entry.key, entry.purpose),
      sign: async (message: Uint8Array) => {
        if (entry.key.algorithm !== 'EdDSA') {
          throw new Error(`VaultTransitAdapter: ${entry.key.algorithm} not supported`);
        }
        return await withKmsSpan('vault-transit', 'sign', kid, purpose, async () => {
          const inputB64 = Buffer.from(message).toString('base64');
          const result = await this.signWithRetry({ name: entry.key.transitName, input: inputB64 });
          const sig = parseVaultSignature(result.data.signature, entry.key.version);
          if (sig.length !== 64) throw new Error(`VaultTransitAdapter: bad signature length ${sig.length}`);
          return sig;
        });
      },
    };
  }

  async getKeyByKid(kid: string): Promise<{ kid: string; publicKey: string; algorithm: KeyMetadata['algorithm'] } | null> {
    const e = this.byKid.get(kid);
    if (!e) return null;
    return { kid: e.key.kid, publicKey: e.key.publicKey, algorithm: e.key.algorithm };
  }

  async listKeys(purpose: KmsKeyPurpose): Promise<KeyMetadata[]> {
    return Array.from(this.byKid.values())
      .filter((e) => e.purpose === purpose)
      .map((e) => this.toMetadata(e.key, e.purpose));
  }

  private toMetadata(k: VaultTransitKey, p: KmsKeyPurpose): KeyMetadata {
    return {
      kid: k.kid,
      purpose: p,
      publicKey: k.publicKey,
      algorithm: k.algorithm,
      validFrom: k.validFrom,
      validUntil: k.validUntil,
    };
  }

  private async signWithRetry(input: { name: string; input: string }): Promise<{ data: { signature: string } }> {
    try {
      return await this.vault.signTransit(input);
    } catch (err) {
      this.logger.warn(`vault sign failed, retrying once: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 100));
      return await this.vault.signTransit(input);
    }
  }
}

/**
 * Parse Vault's `"vault:v{n}:<base64>"` envelope. Asserts the version
 * matches what OKORO expects — a mismatched version means Vault rotated
 * under us and we missed the kid update.
 */
export function parseVaultSignature(envelope: string, expectedVersion: number): Uint8Array {
  const m = /^vault:v(\d+):(.+)$/.exec(envelope);
  if (!m) throw new Error(`Vault envelope malformed: ${envelope.slice(0, 32)}…`);
  const version = Number.parseInt(m[1], 10);
  if (version !== expectedVersion) {
    throw new Error(`Vault key version drift: expected v${expectedVersion}, got v${version}`);
  }
  return Buffer.from(m[2], 'base64');
}
