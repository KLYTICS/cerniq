// CorrelationModule exists so app.module.ts can mount the middleware via
// `MiddlewareConsumer.apply(CorrelationMiddleware).forRoutes('*')`.
//
// The module is intentionally empty — `CorrelationContext` is a static
// singleton (AsyncLocalStorage) and does not participate in DI. We export
// the middleware class so consumers don't need to import from the
// middleware file directly.

import { Module } from '@nestjs/common';

import { CorrelationMiddleware } from './correlation.middleware';

@Module({
  providers: [CorrelationMiddleware],
  exports: [CorrelationMiddleware],
})
export class CorrelationModule {}
