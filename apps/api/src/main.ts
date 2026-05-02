import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
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

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: '/', method: RequestMethod.ALL },
      { path: '.well-known/(.*)', method: RequestMethod.ALL },
    ],
  });
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
      .setTitle('AEGIS — Agent Gateway & Identity Stack')
      .setDescription('Cryptographic identity, scoped policy, and behavioral attestation for AI agents.')
      .setVersion('1.0.0')
      .addApiKey({ type: 'apiKey', name: 'X-AEGIS-API-Key', in: 'header' }, 'ApiKeyAuth')
      .addApiKey({ type: 'apiKey', name: 'X-AEGIS-Verify-Key', in: 'header' }, 'PublicVerifyKey')
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port, '0.0.0.0');

  const url = await app.getUrl();
  // eslint-disable-next-line no-console
  console.log(`AEGIS API listening on ${url}  (env=${config.nodeEnv})`);
}

void bootstrap();
