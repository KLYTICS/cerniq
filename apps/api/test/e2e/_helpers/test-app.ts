// Boots the real AppModule against a real Postgres + Redis. Mirrors the
// global pipe / filter / prefix wiring from apps/api/src/main.ts so
// behavior under test matches production.

import { randomBytes } from 'node:crypto';

import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import type request from 'supertest';

/**
 * Concrete supertest agent type — `@types/supertest@6` doesn't export
 * `TestAgent` by name. `ReturnType<typeof request>` is the documented way
 * to get a typed agent without inventing a stale alias.
 */
export type SupertestHttp = ReturnType<typeof request>;

import { AppModule } from '../../../src/app.module';
import { encodeBase64Url } from '../../../src/common/crypto/ed25519.util';
import { HttpExceptionFilter } from '../../../src/common/filters/http-exception.filter';
import { PrismaService } from '../../../src/common/prisma/prisma.service';

// WellknownService boot-throws without AEGIS_SIGNING_PUBLIC_KEY. Test setup
// (`apps/api/test/setup-env.ts`) is owned by another session — populate a
// deterministic-but-test-only key here so the e2e suite is self-contained.
// The bytes are not cryptographically meaningful (they're not paired with
// a private key); they only have to round-trip through base64url and be
// 32 bytes. Audit chain signing uses a separate, ephemeral keypair from
// AuditService.initSigningKey() in dev.
process.env.AEGIS_SIGNING_PUBLIC_KEY ??= encodeBase64Url(randomBytes(32));
process.env.AEGIS_SIGNING_KEY_ROTATED_AT ??= '2026-01-01T00:00:00.000Z';

/**
 * Tables truncated between specs. Order matters — children before parents
 * so FK constraints don't fire. Synced manually with prisma/schema.prisma.
 */
const TRUNCATE_ORDER = [
  '"WebhookDelivery"',
  '"WebhookSubscription"',
  '"BateSignal"',
  '"TrustScoreHistory"',
  '"SpendRecord"',
  '"AuditEvent"',
  '"AgentDelegation"',
  '"AgentPolicy"',
  '"AgentIdentity"',
  '"ApiKey"',
  '"RelyingParty"',
  '"Principal"',
] as const;

export interface TestAppHandle {
  app: INestApplication;
  prisma: PrismaService;
  baseUrl: string;
  close(): Promise<void>;
  resetDatabase(): Promise<void>;
}

/**
 * Build, configure, and listen on an ephemeral port. Apply every global
 * middleware/pipe/filter that main.ts applies (minus Swagger — irrelevant
 * for tests).
 */
export async function createTestApp(): Promise<TestAppHandle> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });

  app.use(helmet());
  // URI versioning is the single source of `/v1/` — mirrors main.ts. An
  // earlier revision of this helper also called `setGlobalPrefix('v1')`,
  // which stacked with versioning and produced `/v1/v1/...` mounts, so
  // every test that hit `/v1/...` was a 404. Keep these in lockstep with
  // src/main.ts.
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

  await app.init();
  await app.listen(0, '127.0.0.1');

  const url = await app.getUrl();
  const prisma = app.get(PrismaService);

  const handle: TestAppHandle = {
    app,
    prisma,
    baseUrl: url,
    close: async () => {
      await app.close();
    },
    resetDatabase: async () => {
      // TRUNCATE … RESTART IDENTITY CASCADE is the right shape here — fast,
      // re-seeds sequences, and respects FK ordering inside the single
      // statement. We still pass the explicit order so a misconfigured
      // schema (no CASCADE) surfaces a clear error instead of a silent
      // partial wipe.
      const list = TRUNCATE_ORDER.join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
    },
  };

  return handle;
}
