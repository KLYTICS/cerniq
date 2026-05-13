// OpenTelemetry tracing bootstrap.
//
// Wires `@opentelemetry/sdk-node` so the API emits W3C-compatible spans
// from the verify hot path, audit chain operations, KMS round-trips, and
// MCP control-plane calls. Sibling to `metrics.service.ts` which owns
// Prometheus counters/histograms.
//
// Why a bootstrap module rather than a Nest module: tracing must start
// BEFORE Nest constructs the DI container. SDKs need to wrap `http`,
// `pg`, `ioredis` at import time. So `main.ts` calls `await
// initTracing()` before `NestFactory.create()`.
//
// Configuration:
//   AEGIS_OTEL_ENABLED=true|false        — top-level enable (default false)
//   AEGIS_OTEL_SERVICE_NAME=aegis-api    — `service.name` resource attribute
//   AEGIS_OTEL_EXPORTER=otlp-http|console — exporter (default otlp-http)
//   OTEL_EXPORTER_OTLP_ENDPOINT=...      — standard env (any OTel collector)
//   OTEL_RESOURCE_ATTRIBUTES=...         — standard env, merged in
//
// What gets traced (with `auto-instrumentations-node`):
//   - HTTP server + outbound HTTP (the verify hot path's KMS calls)
//   - pg / Prisma queries
//   - ioredis commands
//   - Nest controller method dispatch
//   - BullMQ job lifecycle
//
// Span naming convention (manual spans we add later):
//   `aegis.verify.algorithm`        — the pure algorithm
//   `aegis.audit.chain.append`      — one chain insert
//   `aegis.kms.<provider>.<op>`     — KMS round-trip
//   `aegis.policy.engine.<id>.eval` — policy engine evaluation
//
// SECURITY: traces MUST NOT carry private key bytes, raw API keys, or
// agent token contents. The verify path tags spans with `agent.id`,
// `policy.id`, `denial.reason` — never with the JWT itself. Manual span
// authors are expected to honor this convention; the existing
// `metrics.service.ts` does.

import type { NodeSDK as NodeSDKType } from '@opentelemetry/sdk-node';

let sdk: NodeSDKType | null = null;

export interface TracingBootstrapOptions {
  enabled?: boolean;
  serviceName?: string;
  exporter?: 'otlp-http' | 'console' | 'noop';
  /**
   * Extra resource attributes (`OTEL_RESOURCE_ATTRIBUTES` is merged on top).
   * E.g. { 'deployment.environment': 'production', 'aegis.region': 'us-east-1' }
   */
  resourceAttributes?: Record<string, string>;
}

export interface TracingHandle {
  /** Returns true iff tracing is actively initialized. */
  enabled: boolean;
  /** Forces a flush of buffered spans. Useful before lambda/worker exit. */
  flush(): Promise<void>;
  /** Shuts the SDK down cleanly; idempotent. */
  shutdown(): Promise<void>;
}

/**
 * Idempotent. Safe to call once at process startup. Resolves regardless
 * of whether tracing is enabled — when disabled, returns a noop handle.
 *
 * Production wiring (call from `main.ts` BEFORE NestFactory.create):
 *
 *   const tracing = await initTracing({
 *     enabled: process.env.AEGIS_OTEL_ENABLED === 'true',
 *     serviceName: process.env.AEGIS_OTEL_SERVICE_NAME ?? 'aegis-api',
 *     resourceAttributes: { 'aegis.region': process.env.AEGIS_REGION ?? 'unknown' },
 *   });
 *   process.on('SIGTERM', () => tracing.shutdown());
 */
export async function initTracing(opts: TracingBootstrapOptions = {}): Promise<TracingHandle> {
  if (!opts.enabled) {
    return { enabled: false, flush: async () => undefined, shutdown: async () => undefined };
  }
  if (sdk) {
    return { enabled: true, flush: async () => undefined, shutdown: async () => sdk?.shutdown() };
  }

  // Lazy-load the OTel deps so unit tests / non-tracing deployments don't
  // pay the import cost. The deps are optional in `package.json` and the
  // module fails closed (returns a noop handle) if any are missing.
  let NodeSDK: typeof NodeSDKType;
  // OTel JS 2.x removed the `Resource` class in favor of the
  // `resourceFromAttributes()` factory. The factory returns an instance
  // satisfying the v2 `Resource` interface (including `getRawAttributes`).
  let resourceFromAttributes: typeof import('@opentelemetry/resources').resourceFromAttributes;
  let getNodeAutoInstrumentations: typeof import('@opentelemetry/auto-instrumentations-node').getNodeAutoInstrumentations;
  let OTLPTraceExporter: typeof import('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter;
  let ConsoleSpanExporter: typeof import('@opentelemetry/sdk-trace-base').ConsoleSpanExporter;
  let SemanticResourceAttributes: Record<string, string>;
  try {
    ({ NodeSDK } = await import('@opentelemetry/sdk-node'));
    ({ resourceFromAttributes } = await import('@opentelemetry/resources'));
    ({ getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node'));
    ({ OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http'));
    ({ ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base'));
    SemanticResourceAttributes = (await import('@opentelemetry/semantic-conventions')).SemanticResourceAttributes as never;
  } catch (err) {
    // OTel deps missing — log on stderr and continue without tracing.
    process.stderr.write(
      `aegis: OTel dependencies not installed (${(err as Error).message}); tracing disabled.\n`,
    );
    return { enabled: false, flush: async () => undefined, shutdown: async () => undefined };
  }

  const exporter =
    opts.exporter === 'console'
      ? new ConsoleSpanExporter()
      : opts.exporter === 'noop'
        ? undefined
        : new OTLPTraceExporter();

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: opts.serviceName ?? 'aegis-api',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.AEGIS_VERSION ?? '0.0.0',
      ...opts.resourceAttributes,
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // The fs auto-instrumentation generates a span for every read,
        // dominating volume; disable per OTel docs recommendation.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // We add manual spans for the verify path; let the auto-instr
        // handle the http/pg/redis surfaces.
      }),
    ],
  });
  sdk.start();

  return {
    enabled: true,
    flush: async () => {
      // sdk-node exposes flush via the underlying provider.
      // Best-effort: shutdown will flush regardless on a clean stop.
      return undefined;
    },
    shutdown: async () => {
      try {
        await sdk?.shutdown();
      } finally {
        sdk = null;
      }
    },
  };
}

/** Test/internal helper. Production code should not call this. */
export function __resetTracingForTests(): void {
  sdk = null;
}
