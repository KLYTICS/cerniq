import { Module, OnModuleInit } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule implements OnModuleInit {
  constructor(private readonly audit: AuditService) {}
  async onModuleInit(): Promise<void> {
    await this.audit.initSigningKey();
  }
}
