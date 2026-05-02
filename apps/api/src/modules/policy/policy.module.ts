import { Logger, Module, OnModuleInit } from '@nestjs/common';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import { decodeBase64Url, Ed25519Util, encodeBase64Url } from '../../common/crypto/ed25519.util';
import { AppConfigService } from '../../config/config.service';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

// Wire sha512 for noble v2 sync API in case it's reached during boot derivation.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

@Module({
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule implements OnModuleInit {
  private readonly logger = new Logger(PolicyModule.name);

  constructor(
    private readonly policy: PolicyService,
    private readonly ed25519: Ed25519Util,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Boot the policy-token signing key. Three configuration modes:
   *
   *   1. Both env vars set       — load both, verify they match.
   *   2. Only PRIVATE_B64 set    — derive PUBLIC_B64 from the private key
   *                                (the prior bug here generated a fresh
   *                                random keypair and broadcast a public
   *                                key that did not match the configured
   *                                private key, so every signed policy
   *                                failed verification).
   *   3. Neither set             — generate an ephemeral keypair (dev only;
   *                                refused in production).
   */
  async onModuleInit(): Promise<void> {
    const privB64 = this.config.jwtEd25519PrivateB64;
    const explicitPubB64 = this.config.jwtEd25519PublicB64;

    let priv: Uint8Array;
    let pubB64: string;

    if (privB64) {
      priv = decodeBase64Url(privB64);
      const derivedPubB64 = encodeBase64Url(await ed.getPublicKeyAsync(priv));

      if (explicitPubB64 && explicitPubB64 !== derivedPubB64) {
        // Loud failure — wrong public key in env is worse than no key.
        throw new Error(
          'JWT_ED25519_PUBLIC_KEY_B64 does not match the public key derived from JWT_ED25519_PRIVATE_KEY_B64. ' +
            'Either remove the public env var (it will be derived) or rotate to a matching pair.',
        );
      }

      pubB64 = derivedPubB64;
    } else {
      if (this.config.nodeEnv === 'production') {
        throw new Error(
          'JWT_ED25519_PRIVATE_KEY_B64 missing in production. Refusing to mint a one-shot ephemeral key.',
        );
      }
      const kp = await this.ed25519.generateKeypair();
      priv = kp.privateKey;
      pubB64 = encodeBase64Url(kp.publicKey);
      this.logger.warn(
        'Generated ephemeral JWT signing key (dev only). Issued policies will not verify after process restart.',
      );
    }

    this.policy.setSigningMaterial(priv, pubB64);
  }
}
