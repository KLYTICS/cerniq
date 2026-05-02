import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';

@Global()
@Module({
  providers: [ApiKeyService, ApiKeyGuard, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  exports: [ApiKeyService],
})
export class AuthModule {}
