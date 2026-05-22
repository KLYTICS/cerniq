import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { CorrelationContext, CorrelationMiddleware, CorrelationModule } from './common/correlation';
import { CryptoModule } from './common/crypto/crypto.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { PolicyEngineModule } from './common/policy-engine/policy-engine.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/config.service';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { Auth0Module } from './modules/auth0/auth0.module';
import { BateModule } from './modules/bate/bate.module';
import { BillingModule } from './modules/billing/billing.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IdpClerkModule } from './modules/idp-clerk/idp-clerk.module';
import { IdpWorkOsModule } from './modules/idp-workos/idp-workos.module';
import { KmsModule } from './modules/kms/kms.module';
import { McpModule } from './modules/mcp/mcp.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { PolicyModule } from './modules/policy/policy.module';
import { VerifyModule } from './modules/verify/verify.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WellknownModule } from './modules/wellknown/wellknown.module';

// Round 5–8 modules (enterprise backbone — wired here so AppModule
// instantiates them at boot. Each module is imported individually so
// operators can selectively disable via a fork without surgery.)

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          autoLogging: config.nodeEnv !== 'test',
          transport:
            config.nodeEnv === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
          redact: {
            paths: ['req.headers["x-okoro-api-key"]', 'req.headers["x-okoro-verify-key"]', 'req.headers.authorization'],
            censor: '***',
          },
          customProps: () => {
            const ctx = CorrelationContext.current();
            return {
              service: 'okoro-api',
              ...(ctx?.txId ? { txId: ctx.txId } : {}),
              ...(ctx?.principalId ? { principalId: ctx.principalId } : {}),
              ...(ctx?.agentId ? { agentId: ctx.agentId } : {}),
            };
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        { name: 'default', ttl: 60_000, limit: config.throttleDefaultPerMin },
        { name: 'verify', ttl: 60_000, limit: config.throttleVerifyPerMin },
      ],
    }),
    ScheduleModule.forRoot(),
    CorrelationModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    ObservabilityModule,
    OutboxModule,
    AuthModule,
    HealthModule,
    WellknownModule,
    IdentityModule,
    PolicyModule,
    VerifyModule,
    AuditModule,
    BateModule,
    WebhooksModule,
    // Round 5–8 enterprise backbone:
    KmsModule,
    PolicyEngineModule, // registers Cedar+OPA WASM evaluators per OKORO_POLICY_ENGINES env
    Auth0Module,
    IdpClerkModule,
    IdpWorkOsModule,
    McpModule,
    ComplianceModule,
    OnboardingModule,
    BillingModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
