import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsService } from './metrics.service';
import { DEFAULT_GRACEFUL_SHUTDOWN_MS, ShutdownService } from './shutdown.service';

// ShutdownService takes `number` in its constructor with a TS default; Nest
// DI can't read TS defaults at runtime so it tries to resolve `Number` as a
// provider and fails. Wire it explicitly via useFactory.
@Global()
@Module({
  providers: [
    MetricsService,
    {
      provide: ShutdownService,
      useFactory: () => new ShutdownService(DEFAULT_GRACEFUL_SHUTDOWN_MS),
    },
  ],
  exports: [MetricsService, ShutdownService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
