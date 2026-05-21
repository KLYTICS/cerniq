import { Global, Module } from '@nestjs/common';

import { AuditChainUtil } from './audit-chain.util';
import { Ed25519Util } from './ed25519.util';
import { JwtUtil } from './jwt.util';

@Global()
@Module({
  providers: [Ed25519Util, JwtUtil, AuditChainUtil],
  exports: [Ed25519Util, JwtUtil, AuditChainUtil],
})
export class CryptoModule {}
