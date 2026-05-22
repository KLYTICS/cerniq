// GcpKmsAdapter — native Ed25519 sign via Google Cloud KMS.
//
// GCP Cloud KMS supports `EC_SIGN_ED25519` (since 2024-Q1). This is the
// preferred KMS pattern for OKORO: the private key NEVER leaves Google's
// HSM. Sign latency is ~10-20 ms (acceptable for audit; less acceptable
// for the JWT issuance hot path — operators concerned about JWT latency
// should run a regional KMS replica or fall back to the envelope pattern).
//
// Resource format:
//   projects/{project}/locations/{location}/keyRings/{kr}/cryptoKeys/{key}/cryptoKeyVersions/{version}
//
// One OKORO `kid` maps to one GCP `cryptoKeyVersions/{version}`. Rotation
// is "create new version, update active mapping, deprecate old."

import { Injectable, Logger } from '@nestjs/common';

import type {
  ActiveSigner,
  KeyMetadata,
  KmsAdapter,
  KmsKeyPurpose,
} from '../../common/crypto/crypto.bootstrap.js';

export interface GcpKmsAdapterConfig {
  /** Map of purpose → registered keys (one of which is active per purpose). */
  keys: Partial<Record<KmsKeyPurpose, GcpKmsKey[]>>;
  /** Override clock for tests. */
  now?: () => Date;
}

export interface GcpKmsKey {
  kid: string;
  /** Full GCP resource name. */
  resourceName: string;
  /** base64url Ed25519 public key — fetched from KMS at registration time. */
  publicKey: string;
  algorithm: KeyMetadata['algorithm'];
  validFrom: string;
  validUntil: string | null;
}

/** Minimal client surface — production wiring uses `@google-cloud/kms`. */
export interface GcpKmsClientLike {
  asymmetricSign(input: { name: string; data: Uint8Array }): Promise<{ signature: Uint8Array }>;
}

import { withKmsSpan } from './kms.spans';

@Injectable()
export class GcpKmsAdapter implements KmsAdapter {
  readonly providerId = 'gcp-kms' as const;
  private readonly logger = new Logger(GcpKmsAdapter.name);
  private readonly byKid = new Map<string, { key: GcpKmsKey; purpose: KmsKeyPurpose }>();
  private readonly active = new Map<KmsKeyPurpose, string>();

  constructor(
    config: GcpKmsAdapterConfig,
    private readonly kms: GcpKmsClientLike,
  ) {
    for (const [purpose, list] of Object.entries(config.keys)) {
      if (!list) continue;
      for (const k of list) {
        this.byKid.set(k.kid, { key: k, purpose: purpose as KmsKeyPurpose });
        if (k.validUntil === null) this.active.set(purpose as KmsKeyPurpose, k.kid);
      }
    }
    this.logger.log(`GcpKmsAdapter registered ${this.byKid.size} key(s) across ${this.active.size} purpose(s)`);
  }

  async getActiveKey(purpose: KmsKeyPurpose): Promise<ActiveSigner> {
    const kid = this.active.get(purpose);
    if (!kid) throw new Error(`KMS: no active GCP key for purpose=${purpose}`);
    const entry = this.byKid.get(kid);
    if (!entry) throw new Error(`KMS: active kid=${kid} missing`);

    return {
      metadata: this.toMetadata(entry.key, entry.purpose),
      sign: async (message: Uint8Array) => {
        if (entry.key.algorithm !== 'EdDSA') {
          throw new Error(`GcpKmsAdapter: ${entry.key.algorithm} not supported`);
        }
        return await withKmsSpan('gcp-kms', 'sign', kid, purpose, async () => {
          const result = await this.kms.asymmetricSign({ name: entry.key.resourceName, data: message });
          if (result.signature?.length !== 64) {
            throw new Error(`GcpKmsAdapter: KMS returned invalid Ed25519 signature length`);
          }
          return result.signature;
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

  private toMetadata(k: GcpKmsKey, p: KmsKeyPurpose): KeyMetadata {
    return {
      kid: k.kid,
      purpose: p,
      publicKey: k.publicKey,
      algorithm: k.algorithm,
      validFrom: k.validFrom,
      validUntil: k.validUntil,
    };
  }
}

// Production wiring template (kms.module.ts):
//
//   import { KeyManagementServiceClient } from '@google-cloud/kms';
//   const client = new KeyManagementServiceClient();
//   const adapter = new GcpKmsAdapter(config, {
//     asymmetricSign: async ({ name, data }) => {
//       const [resp] = await client.asymmetricSign({ name, data });
//       return { signature: resp.signature as Uint8Array };
//     },
//   });
