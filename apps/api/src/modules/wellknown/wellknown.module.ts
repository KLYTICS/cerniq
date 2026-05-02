import { Module } from '@nestjs/common';
import { WellknownController } from './wellknown.controller';
import { WellknownService } from './wellknown.service';

/**
 * Publishes AEGIS's audit-event Ed25519 signing public key at the IETF
 * well-known prefix:
 *
 *   GET /.well-known/audit-signing-key   plain JSON helper
 *   GET /.well-known/jwks.json           RFC 8037 JWKS (Ed25519 in JOSE)
 *
 * Both endpoints are unauthenticated, cacheable, and ETag-aware. They are NOT
 * on the verify hot path (CLAUDE.md invariant #2) so framework imports here
 * are fine.
 */
@Module({
  controllers: [WellknownController],
  providers: [WellknownService],
  exports: [WellknownService],
})
export class WellknownModule {}
