import { Module } from '@nestjs/common';
import { VerifyController } from './verify.controller';
import { VerifyService } from './verify.service';
import { SpendGuardService } from './spend-guard.service';
import { ReplayCacheService } from './replay-cache.service';
import { BateModule } from '../bate/bate.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [BateModule, AuditModule],
  controllers: [VerifyController],
  providers: [VerifyService, SpendGuardService, ReplayCacheService],
  exports: [VerifyService],
})
export class VerifyModule {}
