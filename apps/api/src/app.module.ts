import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/config.service';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { CorrelationContext, CorrelationMiddleware, CorrelationModule } from './common/correlation';

import { AuthModule } from './modules/auth/auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { PolicyModule } from './modules/policy/policy.module';
import { VerifyModule } from './modules/verify/verify.module';
import { AuditModule } from './modules/audit/audit.module';
import { BateModule } from './modules/bate/bate.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { HealthModule } from './modules/health/health.module';
import { WellknownModule } from './modules/wellknown/wellknown.module';

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
            paths: ['req.headers["x-aegis-api-key"]', 'req.headers["x-aegis-verify-key"]', 'req.headers.authorization'],
            censor: '***',
          },
          customProps: () => {
            const ctx = CorrelationContext.current();
            return {
              service: 'aegis-api',
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
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
