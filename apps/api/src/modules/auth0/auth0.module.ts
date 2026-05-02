import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { Auth0Adapter } from './auth0.adapter';
import { Auth0Service } from './auth0.service';
import { Auth0Controller } from './auth0.controller';

/**
 * Auth0 bridge module (ADR-0009). Wires Auth0Adapter as the IdpAdapter
 * implementation. To swap to Clerk/WorkOS/Keycloak in the future, replace
 * Auth0Adapter here and rename the controller path. Everything else
 * (service, DTOs, audit hooks) is provider-agnostic.
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, AuditModule],
  controllers: [Auth0Controller],
  providers: [Auth0Adapter, Auth0Service],
  exports: [Auth0Service],
})
export class Auth0Module {}
