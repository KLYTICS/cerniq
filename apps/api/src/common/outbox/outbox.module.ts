import { Global, Module } from '@nestjs/common';

import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';

/**
 * Transactional outbox + drain (ADR-0007).
 *
 * `OutboxService` is the producer surface (`enqueueInTx`, etc.).
 * `OutboxWorker` is the consumer loop that drains the table.
 *
 * Producer modules (bate, webhooks) inject `OutboxWorker` and call
 * `register(kind, handler)` from their own `onModuleInit` — that keeps
 * the outbox module from depending on every producer.
 */
@Global()
@Module({
  providers: [OutboxService, OutboxWorker],
  exports: [OutboxService, OutboxWorker],
})
export class OutboxModule {}
