import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { initTracing, type TracingHandle } from './common/observability/tracing.bootstrap';
import { AppConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  // OTel must initialize BEFORE NestFactory so auto-instrumentation can
  // wrap http / pg / ioredis at import time. See ADR-0011 §6.
  const tracing: TracingHandle = await initTracing({
    enabled: process.env.OKORO_OTEL_ENABLED === 'true',
    serviceName: process.env.OKORO_OTEL_SERVICE_NAME ?? 'okoro-api',
    exporter: (process.env.OKORO_OTEL_EXPORTER as 'otlp-http' | 'console' | 'noop' | undefined) ?? 'otlp-http',
    resourceAttributes: {
      'deployment.environment': process.env.NODE_ENV ?? 'development',
      ...(process.env.OKORO_REGION ? { 'okoro.region': process.env.OKORO_REGION } : {}),
    },
  });

  // Flush + shutdown OTel cleanly on SIGTERM (Railway / k8s graceful drain).
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      void tracing.shutdown();
    });
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  // URI versioning is the single source of `/v1/` — `setGlobalPrefix('v1')`
  // is removed because it stacked with versioning to produce `/v1/v1/...`.
  // `.well-known/*` controllers are marked `VERSION_NEUTRAL` so they remain
  // at `/.well-known/*` without a v1 prefix.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableShutdownHooks();

  if (config.enableSwagger) {
    const swagger = new DocumentBuilder()
      .setTitle('OKORO — Agent Gateway & Identity Stack')
      .setDescription('Cryptographic identity, scoped policy, and behavioral attestation for AI agents.')
      .setVersion('1.0.0')
      .addApiKey({ type: 'apiKey', name: 'X-OKORO-API-Key', in: 'header' }, 'ApiKeyAuth')
      .addApiKey({ type: 'apiKey', name: 'X-OKORO-Verify-Key', in: 'header' }, 'PublicVerifyKey')
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port, '0.0.0.0');

  const url = await app.getUrl();
  // eslint-disable-next-line no-console
  console.log(`OKORO API listening on ${url}  (env=${config.nodeEnv})`);
}

void bootstrap();
