import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

import { AuditRetentionService } from './audit-retention.service';
import { RedactController } from './redact.controller';
import { RedactService } from './redact.service';

/**
 * ComplianceModule — GDPR Art. 17 surfaces.
 *
 * Lives behind `/v1/compliance/...`. Imports `AuditModule` so it can
 * append redaction meta-events without bypassing the chain.
 *
 * `AuditRetentionService` is wired here too: it self-arms a `setInterval`
 * sweep on module init (no `@nestjs/schedule` dependency) and registers
 * with the global `ShutdownService` for graceful drain on SIGTERM.
 * Exported so `scripts/run-audit-retention.ts` can pull it from a
 * Nest standalone application context.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [RedactController],
  providers: [RedactService, AuditRetentionService],
  exports: [RedactService, AuditRetentionService],
})
export class ComplianceModule {}
