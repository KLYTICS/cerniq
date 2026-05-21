import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { AppConfigModule } from '../../config/config.module';

import { ClerkAdapter } from './clerk.adapter';

/**
 * Clerk IdP module (ADR-0009-A) — second `IdpAdapter` implementation.
 *
 * To switch the dashboard's identity provider from Auth0 to Clerk, change
 * the `IdpAdapter` provider binding in `app.module.ts`:
 *
 *   { provide: 'IdpAdapter', useExisting: ClerkAdapter }
 *
 * No other code change is required — the rest of the codebase imports
 * the abstract `IdpAdapter` interface, never `Auth0Adapter` directly.
 */
@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule],
  providers: [ClerkAdapter],
  exports: [ClerkAdapter],
})
export class IdpClerkModule {}
