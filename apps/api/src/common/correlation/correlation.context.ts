// AsyncLocalStorage-based per-request context. Threads `txId` and friends
// through the call stack without coupling every method signature to a
// request-scoped DI container (which is ~3x slower in Nest because every
// dependency is reinstantiated on each call — see ./README.md).
//
// CLAUDE.md invariant #4 (no silent failures): the context is the carrier
// for `txId` so audit-row writes, pino log lines, and metrics all reference
// the SAME id even when fired from background work spawned mid-request.

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Fields the AEGIS request context carries. Each field is optional because
 * the context is populated incrementally:
 *
 *   middleware → guard → service → audit / metrics / pino
 *
 * `txId` is set by the middleware (always present once `run()` is entered).
 * Auth fields (`principalId`, `apiKeyId`) are set by `api-key.guard.ts`
 * after the key resolves. `agentId` is set per-request inside the verify
 * adapter once the JWT is decoded.
 */
export interface CorrelationState {
  /** Request-scoped trace id. Format `tx_<26-char-ulid>`. */
  txId: string;
  /** Set by ApiKeyGuard once the key is resolved. */
  principalId?: string;
  /** Set by ApiKeyGuard. */
  apiKeyId?: string;
  /** Set by verify/identity flows once the agent is identified. */
  agentId?: string;
  /** Best-effort client IP (from `req.ip` or socket). */
  originIp?: string;
  /** UA string, trimmed. */
  userAgent?: string;
  /** Public-key id used by the verify path (when present). */
  verifyKid?: string;
}

const storage = new AsyncLocalStorage<CorrelationState>();

/**
 * Public surface for per-request correlation. All members are static so
 * call sites don't need to inject anything — the AsyncLocalStorage is a
 * module-level singleton scoped to the Node process.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class CorrelationContext {
  /**
   * Run `fn` with `state` bound to the current async chain. Nested `run`
   * calls create a fresh, isolated state — the outer state is restored
   * automatically when the inner callback resolves.
   */
  static run<T>(state: CorrelationState, fn: () => T): T {
    // Shallow clone so mutations via `withFields` don't leak to the caller's
    // reference if they reuse it across runs.
    return storage.run({ ...state }, fn);
  }

  /**
   * Returns the current state, or `undefined` if called outside a `run()`.
   * Callers in fire-and-forget paths (e.g. recordAudit) MUST tolerate
   * `undefined` — the audit adapter writes a synthetic txId in that case.
   */
  static current(): CorrelationState | undefined {
    return storage.getStore();
  }

  /**
   * Merge `patch` into the current state in place. No-op when called
   * outside a `run()` (e.g. from CLI scripts or unit tests). The merge is
   * single-step (atomic from the caller's perspective) — partial visibility
   * of half-written fields is impossible because the JS engine doesn't
   * preempt mid-statement.
   */
  static withFields(patch: Partial<CorrelationState>): void {
    const current = storage.getStore();
    if (!current) return;
    Object.assign(current, patch);
  }

  /**
   * Convenience getter for the txId. Returns `undefined` outside a run.
   */
  static txId(): string | undefined {
    return storage.getStore()?.txId;
  }
}
