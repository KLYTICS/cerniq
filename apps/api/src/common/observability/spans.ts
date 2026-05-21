// Manual OpenTelemetry span helper.
//
// `tracing.bootstrap.ts` wires auto-instrumentation (HTTP server, Prisma,
// Redis, BullMQ); the verify hot path, audit append, and KMS round-trips
// deserve manually-named spans so we can pivot on `agent.id`,
// `policy.id`, `denial.reason`, and `kid` in traces.
//
// SECURITY (CLAUDE.md invariant #4 + tracing.bootstrap.ts §SECURITY):
//   - Never set a span attribute to a JWT, an API key, a private key,
//     a webhook secret, or any other credential. The list of allowed
//     attribute *keys* below is documentation, not enforcement; reviewers
//     check call sites.
//   - Allowed attribute keys (low-cardinality, non-PII):
//       agent.id, policy.id, principal.id (cuid), denial.reason, decision,
//       kid, kms.provider, kms.op, audit.event_id, policy.engine,
//       error.kind
//
// PORTABILITY (CLAUDE.md invariant #2):
//   - DO NOT import this from `verify.algorithm.ts`. Spans wrap the SERVICE
//     layer that calls the algorithm. The algorithm itself stays
//     framework-free for the Cloudflare Worker import path.

import { trace, SpanStatusCode, type Span, type SpanOptions } from '@opentelemetry/api';

/** AEGIS tracer name. Single tracer per service is the OTel convention. */
const TRACER_NAME = 'aegis-api';

/** Allowed attribute key prefixes — for reviewer reference, not runtime enforcement. */
export const SPAN_ATTRIBUTE_KEYS = [
  'agent.id',
  'policy.id',
  'principal.id',
  'denial.reason',
  'decision',
  'kid',
  'kms.provider',
  'kms.op',
  'audit.event_id',
  'policy.engine',
  'error.kind',
] as const;

export type SpanAttributeValue = string | number | boolean;

/**
 * Run `fn` inside a manually named span.
 *
 * On success: `span.end()` is called and the result of `fn` is returned.
 * On thrown error: the span gets `setStatus({ code: ERROR })` and
 * `recordException(err)` before being ended; the original error is
 * re-thrown unchanged. NEVER swallows.
 *
 * The span is the active span for the duration of `fn` so any nested
 * `withSpan`, OTel auto-instrumentation, or manual `trace.getActiveSpan`
 * calls inherit the right parent.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attrs?: Record<string, SpanAttributeValue | undefined>,
  options?: SpanOptions,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return await tracer.startActiveSpan(name, options ?? {}, async (span) => {
    try {
      if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
          if (value !== undefined) span.setAttribute(key, value);
        }
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message ?? 'span fn threw',
      });
      span.setAttribute('error.kind', (err as Error).name ?? 'Error');
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Decorate the currently-active span with one or more attributes.
 * No-op when no span is active (auto-instrumentation off).
 *
 * Use this from inside an outer `withSpan` callback when intermediate
 * results need to be tagged (e.g. tagging the agent.id once it's
 * resolved, before the spend check runs).
 */
export function setActiveSpanAttributes(attrs: Record<string, SpanAttributeValue | undefined>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) span.setAttribute(key, value);
  }
}
