// AuditSignerService — single signing surface for the AEGIS audit chain.
// Closes M-037 ("audit signing routed through `KmsAdapter`").
//
// Resolution order at init():
//   1. If a KmsAdapter is registered (production: AWS / GCP / Vault /
//      in-memory wired by `kms.module.ts`), use it. Stamp `signingKeyId`
//      from the active KMS key's metadata.kid.
//   2. Else (local dev with no `setKmsAdapter()` call): fall back to
//      env-derived Ed25519 key. Use the deterministic kid `kid-genesis-v1`
//      so backfilled rows verify against a single published pubkey.
//
// Why a separate service rather than inlining in audit.service.ts:
//   - Audit.service is shared across multiple session edits. Smaller
//     diffs there reduce merge friction.
//   - Tests can stub AuditSignerService directly (no need to set up
//     a KmsAdapter just to write an audit-spec test).
//   - When ADR-0013 hybrid PQ flips on, `signMessage` returns the
//     hybrid envelope without callers caring.
//
// Security invariants:
//   - The private key NEVER leaves this module's closure. KMS adapters
//     hand back a signer whose only operation is `sign(msg) → bytes`.
//     env-fallback path holds the key in a Buffer that is zeroed on
//     `onModuleDestroy`.
//   - Rotation: a `setKmsAdapter()` call followed by re-init reads the
//     new active key. Old kids stay verifiable via JWKS.
//   - Failure: any signing error throws; callers (audit.service) wrap
//     with their existing transactional retry semantics. No silent zeros.

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as ed from '@noble/ed25519';
import './crypto.bootstrap.js';
import {
  decodeBase64Url,
  encodeBase64Url,
  Ed25519Util,
} from './ed25519.util';
import { getKmsAdapter, type ActiveSigner } from './crypto.bootstrap';
import { AppConfigService } from '../../config/config.service';

const FALLBACK_KID = 'kid-genesis-v1';

interface ResolvedSigner {
  kid: string;
  /** Performs the sign. Returns base64url-encoded signature bytes (raw, not envelope). */
  signRaw(message: Uint8Array): Promise<Uint8Array>;
  /** base64url public key for /.well-known publishing. */
  publicKey: string;
  source: 'kms' | 'env' | 'ephemeral';
}

@Injectable()
export class AuditSignerService implements OnModuleDestroy {
  private readonly logger = new Logger(AuditSignerService.name);
  private resolved: ResolvedSigner | null = null;
  /** Held only on the env-fallback path. KMS-backed signers don't expose private bytes. */
  private envPrivateKey: Uint8Array | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly ed25519: Ed25519Util,
  ) {}

  /** Idempotent. Safe to call from `onModuleInit` or lazily. */
  async init(): Promise<void> {
    if (this.resolved) return;

    // Path 1: KMS adapter registered.
    let kmsSigner: ActiveSigner | null = null;
    try {
      const kms = getKmsAdapter();
      kmsSigner = await kms.getActiveKey('AUDIT');
    } catch {
      kmsSigner = null;
    }
    if (kmsSigner) {
      this.resolved = {
        kid: kmsSigner.metadata.kid,
        publicKey: kmsSigner.metadata.publicKey,
        signRaw: (msg) => kmsSigner!.sign(msg),
        source: 'kms',
      };
      this.logger.log(`AuditSignerService: KMS-backed (kid=${this.resolved.kid})`);
      return;
    }

    // Path 2: env-derived Ed25519 fallback.
    const priv = (this.config as unknown as { auditEd25519PrivateB64?: string }).auditEd25519PrivateB64;
    const pub = (this.config as unknown as { auditEd25519PublicB64?: string }).auditEd25519PublicB64;
    const isProd = (this.config as unknown as { nodeEnv?: string }).nodeEnv === 'production';

    if (priv && pub) {
      this.envPrivateKey = decodeBase64Url(priv);
      this.resolved = {
        kid: FALLBACK_KID,
        publicKey: pub,
        signRaw: (msg) => ed.signAsync(msg, this.envPrivateKey!),
        source: 'env',
      };
      this.logger.warn(
        `AuditSignerService: env-fallback (kid=${FALLBACK_KID}). For production, register a KmsAdapter via kms.module.ts.`,
      );
      return;
    }

    // Path 3: ephemeral dev fallback.
    if (isProd) {
      throw new Error(
        'AuditSignerService: no signing key available in production. ' +
          'Either set AUDIT_ED25519_{PRIVATE,PUBLIC}_KEY_B64 or wire a KmsAdapter (ADR-0011).',
      );
    }
    const kp = await this.ed25519.generateKeypair();
    this.envPrivateKey = kp.privateKey;
    this.resolved = {
      kid: 'kid-dev-ephemeral',
      publicKey: encodeBase64Url(kp.publicKey),
      signRaw: (msg) => ed.signAsync(msg, this.envPrivateKey!),
      source: 'ephemeral',
    };
    this.logger.warn('AuditSignerService: EPHEMERAL keypair (dev only). DO NOT USE IN PRODUCTION.');
  }

  /**
   * Sign an audit-chain message. Returns the base64url signature + the
   * `kid` to stamp on the row. Callers (audit.service) persist both.
   */
  async signChainMessage(message: Uint8Array): Promise<{ signatureB64Url: string; kid: string }> {
    if (!this.resolved) await this.init();
    const signer = this.resolved!;
    const sigBytes = await signer.signRaw(message);
    return { signatureB64Url: encodeBase64Url(sigBytes), kid: signer.kid };
  }

  /**
   * Sign-callback shape — for callers that already build the message
   * bytes themselves (e.g. AuditChainUtil.signWithSigner). Pairs with
   * `getActiveKid()` for the row stamp.
   */
  async signRaw(message: Uint8Array): Promise<Uint8Array> {
    if (!this.resolved) await this.init();
    return this.resolved!.signRaw(message);
  }

  /** Active kid used for the most recent (or next) sign. Read-only. */
  async getActiveKid(): Promise<string> {
    if (!this.resolved) await this.init();
    return this.resolved!.kid;
  }

  /** For `/.well-known/audit-signing-key` publishing. */
  async getPublishedKey(): Promise<{ format: 'ed25519-base64url'; key: string; kid: string; source: ResolvedSigner['source'] }> {
    if (!this.resolved) await this.init();
    return {
      format: 'ed25519-base64url',
      key: this.resolved!.publicKey,
      kid: this.resolved!.kid,
      source: this.resolved!.source,
    };
  }

  /** Test helper. Production code MUST NOT call this. */
  __resetForTests(): void {
    if (this.envPrivateKey) this.envPrivateKey.fill(0);
    this.envPrivateKey = null;
    this.resolved = null;
  }

  onModuleDestroy(): void {
    if (this.envPrivateKey) this.envPrivateKey.fill(0);
    this.envPrivateKey = null;
    this.resolved = null;
  }
}
