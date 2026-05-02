# `common/correlation` — request-scoped trace context

A tiny, framework-agnostic `txId` propagator built on `node:async_hooks`'
`AsyncLocalStorage`. Every inbound HTTP request gets a `txId`, and every
log line, audit row, metric, and downstream service call written during
that request can read the same id without taking it as an argument.

## How it threads through a request

```
HTTP request
  │
  ▼
CorrelationMiddleware              ← reads X-Request-Id, generates tx_<ulid>
  │  CorrelationContext.run({ txId, originIp, userAgent }, next)
  ▼
ApiKeyGuard                        ← CorrelationContext.withFields({ principalId, apiKeyId })
  │
  ▼
controller → service               ← any code path can call CorrelationContext.txId()
  │
  ├─ pino HTTP logger              ← reads txId via customProps for every log line
  ├─ AuditService.append()         ← future: persist txId on AuditEvent (M-019)
  └─ MetricsService                ← txId is NOT a metric label (cardinality bomb)
```

## Why AsyncLocalStorage, not request-scoped DI?

Nest supports `Scope.REQUEST` injection, which is the textbook answer here.
We deliberately do not use it on the verify hot path:

- Request-scoped providers force Nest to **re-instantiate every dependency
  in the resolution graph** on every request. For `VerifyService` (which
  pulls `Prisma`, `Redis`, `Jwt`, `Audit`, `Bate`, `SpendGuard`, `Config`,
  `Metrics`) that is a 7-class hot-path allocation we don't need. Nest's
  own docs flag the cost; in practice it's ~3× the latency of a singleton
  resolver.
- `AsyncLocalStorage` adds a flat ~50 ns per request for the `run()` call
  and gives us the same context isolation. Node's V8 has compiled this
  path since 14.x; there's no `domain`-style perf cliff.
- Verify is the path we're moving to Cloudflare Workers (CLAUDE.md
  invariant #2). Workers don't have NestJS DI but they do expose the
  AsyncLocalStorage shim, so the same `CorrelationContext` import works
  unchanged.

## How `nestjs-pino` should pick this up

The next session that wires this module into `app.module.ts` should add a
single line to the `LoggerModule.forRootAsync` block:

```ts
pinoHttp: {
  // ... existing config
  customProps: () => ({
    service: 'aegis-api',
    txId: CorrelationContext.current()?.txId,
  }),
  genReqId: (req) =>
    req.headers['x-request-id'] ?? CorrelationContext.txId() ?? `tx_${ulid()}`,
}
```

That gives every Pino line a `txId` field without touching any service.

## Why `txId` is NOT a Prometheus label

`prom-client` cardinality bombs are real. A label like `txId` would mean
N counters per N requests — gigabytes of in-process state for a node that
did 10 M requests in a day. Trace exemplars (OpenTelemetry tail-based
sampling, M-021 in `WORK_BOARD.md`) are the right home for per-request
trace ids, not metrics.

## Persisting `txId` on `AuditEvent`

The Prisma `AuditEvent` model does **not** currently carry a `txId`
column. The migration to add one is tracked as **M-019** in
`WORK_BOARD.md`. Until it lands, the e2e test in
`apps/api/test/e2e/correlation.e2e.spec.ts` skips the
"`txId` echoed into audit row" assertion with an explicit `test.skip()`
and a tracker reference.

## Module wiring (deferred)

This module is intentionally additive. `app.module.ts` is owned by the
foundation session — wiring is a single `MiddlewareConsumer.apply(...)`
call that the foundation session will land separately. Until then,
importing `CorrelationContext.current()` from any module is safe: it just
returns `undefined` and callers tolerate that.
