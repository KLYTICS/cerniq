import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { HttpMetricsMiddleware } from './http-metrics.middleware';

@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
