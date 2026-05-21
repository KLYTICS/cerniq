// Webhook-secret envelope encryption — AES-256-GCM with a per-deployment
// data encryption key (DEK). Wraps `WebhookSubscription.secret` at rest so
// a DB-only compromise cannot forge HMAC signatures on outgoing payloads.
//
// Why not bcrypt: webhook signing requires the *plaintext* HMAC key at
// delivery time (`WebhookDeliveryWorker.sign`). One-way hashing is
// incompatible with that requirement; reversible authenticated encryption
// is the correct primitive.
//
// Format on disk: `v1:<iv_b64url>:<tag_b64url>:<ct_b64url>`
//   - `v1` is a literal version tag — lets us migrate to v2 (e.g. KMS-wrapped
//     DEK or AES-GCM-SIV) without touching call sites.
//   - 12-byte random IV (NIST SP 800-38D recommended size for GCM).
//   - 16-byte GCM auth tag, separated for clarity (some libs concatenate;
//     splitting keeps decode logic explicit).
//   - AAD = "aegis.webhook-secret.v1" — domain-separates this DEK from any
//     other AES-GCM use of the same key, so a swapped ciphertext from a
//     different feature would fail authentication.
//
// CLAUDE.md compliance:
//   - Pure node:crypto (no new deps; @noble/ed25519 + jose remain the only
//     non-stdlib crypto in the repo).
//   - Paired spec exists at webhook-secret-cipher.spec.ts.
//   - Errors are typed via AegisError (InternalError) — never raw throws.
//   - No `any`, no Math.random; randomness comes from `randomBytes`.

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/config.service';
import { InternalError } from '../errors/aegis-error';

const VERSION = 'v1' as const;
const VERSION_PREFIX = `${VERSION}:`;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const AAD = Buffer.from('aegis.webhook-secret.v1', 'utf8');

@Injectable()
export class WebhookSecretCipher {
  private readonly logger = new Logger(WebhookSecretCipher.name);
  private readonly dek: Buffer;

  constructor(config: AppConfigService) {
    const provided = config.webhookSecretDekB64;
    if (provided) {
      const buf = Buffer.from(provided, 'base64');
      if (buf.length !== KEY_BYTES) {
        // Schema-level Zod refine should catch this, but defend in depth —
        // we'd rather crash at boot than silently truncate or pad.
        throw new InternalError(
          `AEGIS_WEBHOOK_SECRET_DEK_B64 decoded to ${buf.length} bytes; expected ${KEY_BYTES}.`,
        );
      }
      this.dek = buf;
      return;
    }

    if (config.nodeEnv === 'production') {
      // Fail-loud: a missing DEK in prod means subscriptions would be
      // re-encrypted under an ephemeral key on every boot, instantly
      // bricking outgoing webhooks. Refuse to start.
      throw new InternalError(
        'AEGIS_WEBHOOK_SECRET_DEK_B64 is required in production. Generate with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }

    // Dev/test: ephemeral key. Log so a developer can pin it across restarts
    // by exporting AEGIS_WEBHOOK_SECRET_DEK_B64 — otherwise existing
    // ciphertexts in their local DB will fail to decrypt after a restart.
    this.dek = randomBytes(KEY_BYTES);
    this.logger.warn(
      'AEGIS_WEBHOOK_SECRET_DEK_B64 not set — generated ephemeral DEK. ' +
        `Pin across restarts: AEGIS_WEBHOOK_SECRET_DEK_B64=${this.dek.toString('base64')}`,
    );
  }

  /**
   * Encrypt a UTF-8 plaintext to the envelope format.
   * Each call generates a fresh IV; never reuse one with the same key.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.dek, iv);
    cipher.setAAD(AAD);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION_PREFIX}${b64url(iv)}:${b64url(tag)}:${b64url(ct)}`;
  }

  /**
   * Decrypt an envelope produced by `encrypt`. Throws InternalError on
   * any structural or authenticity failure — callers must treat any
   * exception as a hard fault (caller in `webhook.delivery.ts` ABANDONS
   * the delivery rather than risk a forged signature).
   */
  decrypt(ciphertext: string): string {
    if (!this.isEncrypted(ciphertext)) {
      throw new InternalError('webhook secret ciphertext: missing v1 prefix');
    }
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      throw new InternalError('webhook secret ciphertext: malformed envelope');
    }
    const [version, ivB64u, tagB64u, ctB64u] = parts;
    // type-rationale: tuple destructuring with explicit length check above
    // proves these are strings; the assertion below silences strict null
    // narrowing without introducing `any`.
    if (
      version === undefined ||
      ivB64u === undefined ||
      tagB64u === undefined ||
      ctB64u === undefined
    ) {
      throw new InternalError('webhook secret ciphertext: malformed envelope');
    }
    if (!constantTimeEqStr(version, VERSION)) {
      throw new InternalError(`webhook secret ciphertext: unsupported version ${version}`);
    }

    let iv: Buffer;
    let tag: Buffer;
    let ct: Buffer;
    try {
      iv = fromB64url(ivB64u);
      tag = fromB64url(tagB64u);
      ct = fromB64url(ctB64u);
    } catch (err) {
      throw new InternalError('webhook secret ciphertext: invalid base64url', { cause: err });
    }
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new InternalError('webhook secret ciphertext: bad iv/tag length');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.dek, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    try {
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch (err) {
      // GCM auth-tag mismatch lands here — covers wrong DEK, tampered IV,
      // tampered ciphertext, tampered AAD-equivalent state.
      throw new InternalError('webhook secret ciphertext: authentication failed', { cause: err });
    }
  }

  /** Cheap version sniff used to keep the legacy plaintext branch alive. */
  isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(VERSION_PREFIX);
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64url(s: string): Buffer {
  // Buffer.from is permissive — empty strings decode to empty buffers.
  // Length checks at the call site catch zero-length inputs.
  return Buffer.from(s, 'base64url');
}

function constantTimeEqStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
