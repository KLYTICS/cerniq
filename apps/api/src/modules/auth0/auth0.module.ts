import { Module } from '@nestjs/common';

// type-rationale: peer's auth0 module references config.auth0Issuer +
// config.auth0Audience + config.auth0ActionSecret which are present in
// AppConfigService (added Round 5). Module imports AppConfigModule to
// expose them to DI.
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { AppConfigModule } from '../../config/config.module';
import { AuditModule } from '../audit/audit.module';

import { Auth0Adapter } from './auth0.adapter';
import { Auth0Controller } from './auth0.controller';
import { Auth0Service } from './auth0.service';

/**
 * Auth0 bridge module (ADR-0009). Wires Auth0Adapter as the IdpAdapter
 * implementation. To swap to Clerk/WorkOS/Keycloak in the future, replace
 * Auth0Adapter here and rename the controller path. Everything else
 * (service, DTOs, audit hooks) is provider-agnostic.
 */
@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule, AuditModule],
  controllers: [Auth0Controller],
  providers: [Auth0Adapter, Auth0Service],
  exports: [Auth0Service],
})
export class Auth0Module {}
