// AwsKmsAdapter — envelope-encryption pattern for Ed25519 keys.
//
// Why envelope encryption rather than native KMS sign? As of 2026-Q2,
// AWS KMS does not yet GA EdDSA signing — the SigningAlgorithm enum
// supports RSASSA, ECDSA, and SM2DSA only. CERNIQ is Ed25519-only per
// ADR-0002.
//
// Pattern (NIST SP 800-57 §6.2.2):
//   1. Operator generates an Ed25519 keypair offline.
//   2. KMS Encrypt(plaintext = ed25519 private key, KeyId = master DEK).
//   3. Ciphertext stored at rest (S3, Secrets Manager, env, etc.).
//   4. At CERNIQ startup, KMS Decrypt unwraps the private key into
//      process memory. Memory is zeroed on shutdown.
//   5. Sign happens locally with `@noble/ed25519` — fast (50µs vs 5-15ms
//      for round-trip KMS Sign).
//
// Rotation: re-encrypt the same Ed25519 keypair under a new master DEK
// (`aws kms re-encrypt`), or generate a new Ed25519 keypair and bump
// `kid`. The latter is the ADR-0011 pattern.
//
// Switch to native KMS Sign: when AWS adds `EDDSA`, swap the `sign()`
// body to call `kms:Sign({ KeyId, Message, MessageType: 'RAW',
// SigningAlgorithm: 'EDDSA' })`. Interface stays the same; private key
// no longer leaves KMS. Documented in M-035.

import { Injectable, Logger } from '@nestjs/common';
import * as ed from '@noble/ed25519';

import '../../common/crypto/crypto.bootstrap.js';
import type {
  ActiveSigner,
  KeyMetadata,
  KmsAdapter,
  KmsKeyPurpose,
} from '../../common/crypto/crypto.bootstrap.js';
import { encodeBase64Url, decodeBase64Url } from '../../common/crypto/ed25519.util.js';

import { withKmsSpan } from './kms.spans';

export interface AwsKmsAdapterConfig {
  /** AWS region for KMS Decrypt. */
  region: string;
  /**
   * Map of purpose → wrapped-key descriptor. The wrapped ciphertext is
   * KMS-encrypted Ed25519 private key (32 bytes plaintext) base64url'd
   * for env transport. The kid is what CERNIQ stamps on signed records.
   */
  keys: Partial<Record<KmsKeyPurpose, AwsWrappedKey>>;
}

export interface AwsWrappedKey {
  kid: string;
  /** base64url ciphertext from `aws kms encrypt --plaintext fileb://ed25519.key`. */
  wrappedPrivateKeyB64: string;
  /** base64url Ed25519 public key (32 bytes). Distributed to JWKS. */
  publicKey: string;
  algorithm: KeyMetadata['algorithm'];
  validFrom: string;
  validUntil: string | null;
}

interface UnwrappedKey {
  metadata: KeyMetadata;
  privateKey: Uint8Array;
}

/**
 * KMS interface a real AWS SDK client implements. Defining it locally
 * keeps `@aws-sdk/client-kms` out of unit tests; production wiring in
 * `kms.module.ts` injects the real client.
 */
export interface KmsClientLike {
  decrypt(input: { CiphertextBlob: Uint8Array }): Promise<{ Plaintext?: Uint8Array }>;
}

@Injectable()
export class AwsKmsAdapter implements KmsAdapter {
  readonly providerId = 'aws-kms' as const;
  private readonly logger = new Logger(AwsKmsAdapter.name);
  private readonly unwrapped = new Map<string, UnwrappedKey>(); // kid → unwrapped
  private readonly active = new Map<KmsKeyPurpose, string>();
  private initialized = false;

  constructor(
    private readonly config: AwsKmsAdapterConfig,
    private readonly kms: KmsClientLike,
  ) {}

  /** Idempotent. Decrypts wrapped keys at boot. Throws on any decrypt failure. */
  async init(): Promise<void> {
    if (this.initialized) return;
    for (const [purpose, wrapped] of Object.entries(this.config.keys)) {
      if (!wrapped) continue;
      const ciphertext = decodeBase64Url(wrapped.wrappedPrivateKeyB64);
      const result = await this.kms.decrypt({ CiphertextBlob: ciphertext });
      if (result.Plaintext?.length !== 32) {
        throw new Error(`KMS decrypt for purpose=${purpose}: expected 32-byte Ed25519 key`);
      }
      const meta: KeyMetadata = {
        kid: wrapped.kid,
        purpose: purpose as KmsKeyPurpose,
        publicKey: wrapped.publicKey,
        algorithm: wrapped.algorithm,
        validFrom: wrapped.validFrom,
        validUntil: wrapped.validUntil,
      };
      this.unwrapped.set(wrapped.kid, { metadata: meta, privateKey: result.Plaintext });
      if (wrapped.validUntil === null) {
        this.active.set(purpose as KmsKeyPurpose, wrapped.kid);
      }
    }
    this.initialized = true;
    this.logger.log(
      `AwsKmsAdapter unwrapped ${this.unwrapped.size} key(s) across ${this.active.size} purpose(s)`,
    );
  }

  async getActiveKey(purpose: KmsKeyPurpose): Promise<ActiveSigner> {
    if (!this.initialized) await this.init();
    const kid = this.active.get(purpose);
    if (!kid) throw new Error(`KMS: no active AWS-wrapped key for purpose=${purpose}`);
    const entry = this.unwrapped.get(kid);
    if (!entry) throw new Error(`KMS: active kid=${kid} not unwrapped`);

    return {
      metadata: entry.metadata,
      sign: async (message: Uint8Array) => {
        if (entry.metadata.algorithm !== 'EdDSA') {
          throw new Error(`AwsKmsAdapter: hybrid/PQ signing not supported by this adapter`);
        }
        return await withKmsSpan('aws-kms', 'sign', kid, purpose, () =>
          ed.signAsync(message, entry.privateKey),
        );
      },
    };
  }

  async getKeyByKid(
    kid: string,
  ): Promise<{ kid: string; publicKey: string; algorithm: KeyMetadata['algorithm'] } | null> {
    if (!this.initialized) await this.init();
    const e = this.unwrapped.get(kid);
    if (!e) return null;
    return {
      kid: e.metadata.kid,
      publicKey: e.metadata.publicKey,
      algorithm: e.metadata.algorithm,
    };
  }

  async listKeys(purpose: KmsKeyPurpose): Promise<KeyMetadata[]> {
    if (!this.initialized) await this.init();
    return Array.from(this.unwrapped.values())
      .filter((e) => e.metadata.purpose === purpose)
      .map((e) => e.metadata);
  }

  /** Test helper. Production code does not call this. */
  __publicKeyForTests(kid: string): string | null {
    return this.unwrapped.get(kid)?.metadata.publicKey ?? null;
  }

  /** Zero in-memory key bytes. Called by Nest's onModuleDestroy. */
  destroy(): void {
    for (const [, e] of this.unwrapped) e.privateKey.fill(0);
    this.unwrapped.clear();
    this.active.clear();
  }
}

// Production wiring helper. AppModule constructs the real KMS client:
//   import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
//   const client = new KMSClient({ region: 'us-east-1' });
//   const adapter = new AwsKmsAdapter(config, {
//     decrypt: async (input) => {
//       const out = await client.send(new DecryptCommand(input));
//       return { Plaintext: out.Plaintext as Uint8Array };
//     },
//   });
export const __awsKmsAdapterDoc = '';
const _markPubUsed: typeof encodeBase64Url = encodeBase64Url; // tree-shaker hint
void _markPubUsed;
