import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditModule } from '../audit/audit.module';

import { ApiKeyRotationController } from './api-key-rotation.controller';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';


@Global()
@Module({
  imports: [AuditModule],
  controllers: [ApiKeyRotationController],
  providers: [ApiKeyService, ApiKeyGuard, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  exports: [ApiKeyService],
})
export class AuthModule {}
