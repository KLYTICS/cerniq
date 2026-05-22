// Centralized SIGTERM coordinator for OKORO.
//
// Why this exists:
// Today, a Railway redeploy fires SIGTERM at the API. NestJS 11 turns that
// signal into `onModuleDestroy` / `onApplicationShutdown` callbacks _per_
// provider, but the order is undefined and a slow drain in one provider can
// stall others. Worse, a provider that forgets to await its async cleanup
// silently abandons in-flight work (BullMQ jobs, in-flight HTTP calls).
//
// `ShutdownService` is a single place where modules can register a named
// `drain()` function. On SIGTERM:
//   1. Log the signal we received.
//   2. Run every registered drain in PARALLEL (Promise.allSettled).
//   3. Log each drain's name + duration + result.
//   4. If any drain exceeds `gracefulShutdownTimeoutMs`, log a `slow_drain`
//      warn but DO NOT block — Nest will still proceed to its own teardown.
//
// We deliberately do NOT race the drains against the timeout with
// `Promise.race(timeout)` because that would orphan the slow promise; it
// just runs to completion in the background while Nest tears down. Logging
// is enough for observability — the operator can decide whether to bump
// the timeout next deploy.

import {
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';

export type DrainFn = () => Promise<void>;

interface RegisteredDrain {
  readonly name: string;
  readonly fn: DrainFn;
}

interface DrainResult {
  readonly name: string;
  readonly durationMs: number;
  readonly status: 'ok' | 'failed' | 'slow';
  readonly error?: string;
}

/** Default grace window — Railway's SIGTERM→SIGKILL gap is ~30s. */
export const DEFAULT_GRACEFUL_SHUTDOWN_MS = 30_000;

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private readonly drains: RegisteredDrain[] = [];
  private shuttingDown = false;

  constructor(
    private readonly gracefulShutdownTimeoutMs: number = DEFAULT_GRACEFUL_SHUTDOWN_MS,
  ) {}

  /**
   * Register a drain hook. Call from `onModuleInit` of any module that has
   * long-running work to flush on shutdown (BullMQ workers, in-flight HTTP
   * calls, batched DB writes). Drains run in parallel — order is irrelevant.
   *
   * `name` is used in logs; pick something searchable
   * (e.g. 'webhook-delivery-worker', 'outbox-worker').
   */
  register(name: string, drainFn: DrainFn): void {
    if (this.shuttingDown) {
      this.logger.warn(
        `register('${name}') called after shutdown began — drain will not run`,
      );
      return;
    }
    this.drains.push({ name, fn: drainFn });
  }

  /**
   * Visible for testing. Returns the registered drain count.
   */
  get registeredCount(): number {
    return this.drains.length;
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const sig = signal ?? 'unknown';
    this.logger.log(
      `shutdown signal=${sig} — draining ${this.drains.length} hook(s)`,
    );

    const results = await Promise.all(this.drains.map((d) => this.runOne(d)));

    const slow = results.filter((r) => r.status === 'slow').map((r) => r.name);
    const failed = results.filter((r) => r.status === 'failed');

    if (slow.length > 0) {
      this.logger.warn(
        `slow_drain signal=${sig} drains=${slow.join(',')} — exceeded gracefulShutdownTimeoutMs=${this.gracefulShutdownTimeoutMs}`,
      );
    }
    for (const f of failed) {
      this.logger.error(
        `drain_failed name=${f.name} durationMs=${f.durationMs} error=${f.error ?? 'unknown'}`,
      );
    }
    this.logger.log(
      `shutdown complete signal=${sig} drains_ok=${results.filter((r) => r.status === 'ok').length} drains_slow=${slow.length} drains_failed=${failed.length}`,
    );
  }

  private async runOne(d: RegisteredDrain): Promise<DrainResult> {
    const started = Date.now();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
    }, this.gracefulShutdownTimeoutMs);
    if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();

    try {
      await d.fn();
      const durationMs = Date.now() - started;
      clearTimeout(timeoutHandle);
      const status: DrainResult['status'] = timedOut ? 'slow' : 'ok';
      this.logger.log(
        `drain name=${d.name} durationMs=${durationMs} status=${status}`,
      );
      return { name: d.name, durationMs, status };
    } catch (err) {
      const durationMs = Date.now() - started;
      clearTimeout(timeoutHandle);
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: d.name,
        durationMs,
        status: 'failed',
        error: message,
      };
    }
  }
}
