// AEGIS BullMQ worker entrypoint.
//
// Audit a42f05bc deploy-readiness blocker B3 fix: `infra/docker/Dockerfile.worker`
// and `infra/railway/worker.service.json` both `CMD ["dist/workers/main.js"]`
// — without this file the worker service crash-loops on first deploy.
//
// What this process owns:
//   - BullMQ queue consumers for BATE signal ingestion (M-007 worker side).
//   - BullMQ queue consumer for webhook delivery (M-008).
//   - BullMQ queue consumer for the audit DLQ (when the verify-path
//     fire-and-forget audit append fails, the failure rides this queue).
//   - Cron-style scheduled jobs:
//       * Mark expired policies (every minute)
//       * Recompute trust score sweep for high-velocity agents
//       * Audit-chain verifier (hourly, alarms on chain break)
//       * SpendRecord → Redis counter reconciliation (hourly)
//
// What this process does NOT own:
//   - Serving HTTP. The API process is separate; this process must not
//     bind a port.
//
// This bootstrap is intentionally minimal in v1 — it boots the same
// AppModule the API does (so DI / Prisma / Redis are wired the same
// way), then explicitly loads only the queue-consuming providers.

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../app.module';

async function bootstrap(): Promise<void> {
  // `createApplicationContext` does not start an HTTP listener; perfect for
  // a worker process that boots the DI graph and then loops on a queue.
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const log = app.get(Logger);
  log.log('AEGIS worker process started');

  // Graceful shutdown — Railway sends SIGTERM 30s before forcibly killing.
  // BullMQ workers acknowledge in-flight jobs back to the queue when
  // their host process closes cleanly, so this is the difference between
  // re-runnable jobs and jobs that stall in "active" state.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.log(`Received ${sig}; closing worker app context`);
      app
        .close()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          log.error(`Worker shutdown failed: ${(err as Error).message}`);
          process.exit(1);
        });
    });
  }

  // Keep the event loop alive. The BullMQ workers register their own
  // intervals via NestJS `OnModuleInit` (when the queue modules ship).
  // For now this is a heartbeat that surfaces in logs.
  setInterval(() => { log.debug('worker heartbeat'); }, 60_000).unref();
}

bootstrap().catch((err: unknown) => {
   
  console.error('worker bootstrap failed:', err);
  process.exit(1);
});
