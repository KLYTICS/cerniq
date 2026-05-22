// CircuitBreaker — hand-rolled three-state breaker for OKORO outbound calls.
//
// Why this exists: a slow Stripe API or wedged KMS endpoint would otherwise
// drag /v1/verify p99 down with it. Each outbound dependency wraps its
// callsite in a CircuitBreaker so a sustained burst of failures trips the
// breaker into OPEN, fast-failing subsequent calls until a single HALF_OPEN
// probe succeeds.
//
// No third-party deps, no NestJS, no DI — pure utility. Wire-up to metrics
// is optional via the `onStateChange` hook (kms.module + stripe.service do
// this through `wrapWithBreaker` below).

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Stable label used for metrics + log lines. Low cardinality. */
  name: string;
  /** Consecutive failures before CLOSED → OPEN. */
  failureThreshold: number;
  /** ms in OPEN before the next call probes (transition to HALF_OPEN). */
  resetTimeoutMs: number;
  /** Concurrent probes allowed in HALF_OPEN. Typically 1. */
  halfOpenMaxCalls: number;
  /** Fired on every state transition with the (from, to) tuple. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

const DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxCalls: 1,
} as const;

/** Thrown when the breaker rejects a call without invoking the wrapped fn. */
export class CircuitOpenError extends Error {
  override readonly name = 'CircuitOpenError';
  /**
   * Minifier-safe discriminator for `getCatalogEntry`. CircuitOpenError
   * does not extend OkoroError (kept framework-agnostic so workers/edge
   * can use the breaker), but we still want it to map cleanly to the
   * `upstream_unavailable` catalog entry after a tsup production build.
   * See peer review F-06.
   */
  static readonly catalogKey = 'CircuitOpenError';
  constructor(public readonly breaker: string) {
    super(`Circuit breaker "${breaker}" is OPEN`);
  }
}

export class CircuitBreaker<T = unknown> {
  private readonly opts: Required<Omit<CircuitBreakerOptions, 'onStateChange'>> &
    Pick<CircuitBreakerOptions, 'onStateChange'>;
  private _state: CircuitState = 'CLOSED';
  private failures = 0;
  /** ms timestamp at which the OPEN-window expires. */
  private openedUntil = 0;
  /** in-flight probes while in HALF_OPEN. */
  private halfOpenInFlight = 0;

  // type-rationale: the `T` parameter exists so callers can declare the
  // expected success-shape (e.g. `new CircuitBreaker<{Plaintext: Uint8Array}>`)
  // even though `exec<R>` overrides it per-call. Reference T in a method
  // signature below — no runtime field needed.

  constructor(options: Partial<CircuitBreakerOptions> & { name: string }) {
    this.opts = {
      name: options.name,
      failureThreshold: options.failureThreshold ?? DEFAULTS.failureThreshold,
      resetTimeoutMs: options.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs,
      halfOpenMaxCalls: options.halfOpenMaxCalls ?? DEFAULTS.halfOpenMaxCalls,
      onStateChange: options.onStateChange,
    };
  }

  get state(): CircuitState {
    return this._state;
  }

  get name(): string {
    return this.opts.name;
  }

  async exec<R = T>(fn: () => Promise<R>): Promise<R> {
    // Resolve OPEN → HALF_OPEN transition lazily on entry.
    if (this._state === 'OPEN' && Date.now() >= this.openedUntil) {
      this.transition('HALF_OPEN');
    }

    if (this._state === 'OPEN') {
      throw new CircuitOpenError(this.opts.name);
    }

    if (this._state === 'HALF_OPEN') {
      if (this.halfOpenInFlight >= this.opts.halfOpenMaxCalls) {
        throw new CircuitOpenError(this.opts.name);
      }
      this.halfOpenInFlight += 1;
      try {
        const result = await fn();
        this.onSuccess();
        return result;
      } catch (err) {
        this.onFailure();
        throw err;
      } finally {
        this.halfOpenInFlight -= 1;
      }
    }

    // CLOSED.
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this._state === 'HALF_OPEN') {
      this.transition('CLOSED');
    }
    this.failures = 0;
  }

  private onFailure(): void {
    if (this._state === 'HALF_OPEN') {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.opts.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.openedUntil = Date.now() + this.opts.resetTimeoutMs;
    this.failures = 0;
    this.transition('OPEN');
  }

  private transition(to: CircuitState): void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    if (this.opts.onStateChange) {
      try {
        this.opts.onStateChange(from, to);
      } catch {
        // Metrics hook must never poison the breaker.
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helper: wrap an async function in a breaker with optional metric wiring.
// Call sites in kms.module.ts and stripe.service.ts use this so we don't
// re-thread MetricsService into every closure.
// ─────────────────────────────────────────────────────────────────────────

/** Numeric label for the circuit breaker state gauge. */
export const CIRCUIT_STATE_NUMERIC: Record<CircuitState, 0 | 1 | 2> = {
  CLOSED: 0,
  HALF_OPEN: 1,
  OPEN: 2,
};

/** Minimal Prometheus surface — keeps this module DI-free. */
export interface BreakerMetricsSink {
  setState(name: string, numeric: 0 | 1 | 2): void;
  recordTrip(name: string): void;
}

/**
 * Build a breaker around `fn`. Returns the breaker instance and a wrapper
 * fn that callers can invoke directly. Metrics are wired transparently
 * when `metrics` is provided.
 */
export function wrapWithBreaker<R>(
  name: string,
  fn: () => Promise<R>,
  opts?: {
    failureThreshold?: number;
    resetTimeoutMs?: number;
    halfOpenMaxCalls?: number;
    metrics?: BreakerMetricsSink;
  },
): { breaker: CircuitBreaker<R>; call: () => Promise<R> } {
  const metrics = opts?.metrics;
  const breaker = new CircuitBreaker<R>({
    name,
    failureThreshold: opts?.failureThreshold ?? DEFAULTS.failureThreshold,
    resetTimeoutMs: opts?.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs,
    halfOpenMaxCalls: opts?.halfOpenMaxCalls ?? DEFAULTS.halfOpenMaxCalls,
    onStateChange: metrics
      ? (from, to) => {
          metrics.setState(name, CIRCUIT_STATE_NUMERIC[to]);
          if (to === 'OPEN' && from !== 'OPEN') {
            metrics.recordTrip(name);
          }
        }
      : undefined,
  });
  return { breaker, call: () => breaker.exec(fn) };
}
