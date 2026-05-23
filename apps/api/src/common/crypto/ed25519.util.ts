// Side-effect import: bootstraps `ed.etc.sha512Sync` exactly once across
// the API process. See `crypto.bootstrap.ts` for details — this replaces
// the inline `ed.etc.sha512Sync = ...` that used to live in three places.
import './crypto.bootstrap.js';
import { Injectable } from '@nestjs/common';
import * as ed from '@noble/ed25519';

const enc = new TextEncoder();

@Injectable()
export class Ed25519Util {
  /**
   * Generate a fresh keypair. Used in dev/sandbox flows; real production
   * keypairs are generated client-side and never transit the CERNIQ API.
   */
  async generateKeypair(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    return { privateKey, publicKey };
  }

  /**
   * Verify a detached signature.
   *
   * @param message UTF-8 string or raw bytes that were signed
   * @param signatureB64Url base64url-encoded signature
   * @param publicKeyB64Url base64url-encoded public key
   */
  async verify(
    message: string | Uint8Array,
    signatureB64Url: string,
    publicKeyB64Url: string,
  ): Promise<boolean> {
    try {
      const msg = typeof message === 'string' ? enc.encode(message) : message;
      const sig = decodeBase64Url(signatureB64Url);
      const pub = decodeBase64Url(publicKeyB64Url);
      return await ed.verifyAsync(sig, msg, pub);
    } catch {
      return false;
    }
  }

  /**
   * Sign a message with the supplied private key. Test/dev helper — production
   * agents sign with the SDK on the client side.
   */
  async sign(message: string | Uint8Array, privateKey: Uint8Array): Promise<string> {
    const msg = typeof message === 'string' ? enc.encode(message) : message;
    const sig = await ed.signAsync(msg, privateKey);
    return encodeBase64Url(sig);
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function decodeBase64Url(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, 'base64url'));
}
