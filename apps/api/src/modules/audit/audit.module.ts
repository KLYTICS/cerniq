import { Global, Module, OnModuleInit } from '@nestjs/common';

import { AuditSignerService } from '../../common/crypto/audit-signer.service';

import { AuditEventsController } from './audit-events.controller';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';


// Global so any feature module (verify, billing, identity, mcp) gets the
// shared `AuditService` without re-importing AuditModule everywhere.
// Mirrors PrismaModule / RedisModule / CryptoModule which are also @Global.
@Global()
@Module({
  controllers: [AuditController, AuditEventsController],
  // M-037: AuditSignerService is exported so /.well-known/audit-signing-key
  // and any future verifier can resolve the active kid + pubkey from a
  // single source of truth.
  providers: [AuditService, AuditSignerService],
  exports: [AuditService, AuditSignerService],
})
export class AuditModule implements OnModuleInit {
  constructor(
    private readonly audit: AuditService,
    private readonly signer: AuditSignerService,
  ) {}
  async onModuleInit(): Promise<void> {
    // Init the KMS-backed signer first so audit.service.append can
    // pick it up immediately; then initialize the legacy env-derived
    // path as a fallback for any code still reading auditPrivateKey
    // directly.
    await this.signer.init();
    await this.audit.initSigningKey();
  }
}
