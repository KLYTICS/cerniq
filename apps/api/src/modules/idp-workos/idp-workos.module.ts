import { Module, Provider } from '@nestjs/common';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/config.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisModule } from '../../common/redis/redis.module';
import { RedisService } from '../../common/redis/redis.service';
import { WorkOsAdapter, type WorkOsClientLike } from './workos.adapter';

const WORKOS_CLIENT = 'AEGIS_WORKOS_CLIENT';

const workosClientProvider: Provider = {
  provide: WORKOS_CLIENT,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): WorkOsClientLike => {
    const apiKey = (config as unknown as { workosApiKey?: string }).workosApiKey;
    if (!apiKey) {
      throw new Error('WORKOS_API_KEY required when WorkOS adapter is enabled');
    }
    // Lazy require so the SDK isn't pulled into unit-test bundles.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { WorkOS } = require('@workos-inc/node') as { WorkOS: new (key: string) => unknown };
    const sdk = new WorkOS(apiKey) as {
      userManagement: {
        authenticateWithSessionCookie: (args: { sessionData: string; cookiePassword: string }) => Promise<unknown>;
      };
      organizations: { getOrganization: (id: string) => Promise<unknown> };
    };
    return {
      authenticateSession: async (cookie) => {
        const cookiePassword = (config as unknown as { workosCookiePassword?: string }).workosCookiePassword ?? '';
        const out = (await sdk.userManagement.authenticateWithSessionCookie({
          sessionData: cookie,
          cookiePassword,
        })) as { user: { id: string; email: string; emailVerified: boolean; firstName?: string; lastName?: string; organizationId?: string }; organizationId?: string; roles?: string[]; mfaEnrolled?: boolean; sessionId: string; expiresAt: number };
        return out;
      },
      getOrganization: async (id) => {
        const out = (await sdk.organizations.getOrganization(id)) as { id: string; name: string; domains?: Array<{ domain: string }> };
        return out;
      },
    };
  },
};

const workosAdapterProvider: Provider = {
  provide: WorkOsAdapter,
  // Class references — string tokens 'PrismaService' / 'RedisService' don't
  // resolve in Nest DI; the providers are bound by class identity.
  inject: [PrismaService, RedisService, AppConfigService, WORKOS_CLIENT],
  useFactory: (prisma, redis, config, client) => new WorkOsAdapter(prisma, redis, config, client),
};

/**
 * WorkOS IdP module (ADR-0009-B). Third `IdpAdapter` implementation.
 * Validates the interface holds across fundamentally different IdP
 * shapes (sealed sessions vs. JWT). Switching from Auth0 → WorkOS is
 * a single DI binding change.
 */
@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule],
  providers: [workosClientProvider, workosAdapterProvider],
  exports: [WorkOsAdapter],
})
export class IdpWorkOsModule {}
