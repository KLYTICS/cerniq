// Shadow-mode comparison utility for the CF Worker edge verify path.
//
// Why this exists: edge decisions MUST agree with origin decisions
// before we trust the edge with live traffic. Shadow mode runs both,
// returns the origin response (so users see no behavior change), and
// records whether the edge agreed. Operators flip
// `CERNIQ_EDGE_VERIFY_ENABLED=true` only after observing N days of high
// agreement (target ≥ 99.9% over 1M+ comparable verifies).
//
// Three modes:
//   - off: pure origin (default). Edge code never executes.
//   - shadow: edge AND origin run; origin response is served; divergence
//     is recorded on the response header `X-CERNIQ-Edge-Divergence` and
//     emitted to a Workers Analytics Engine dataset (when configured).
//   - live: edge serves cache hits; origin handles misses.
//
// Mode selection:
//   CERNIQ_EDGE_VERIFY_ENABLED=true       → live
//   CERNIQ_EDGE_VERIFY_SHADOW_MODE=true   → shadow (only when not-live)
//   neither                              → off
//
// We DO NOT compare unstructured fields like `verifiedAt` (timestamps
// will trivially differ). Comparison is on the decision tuple
// (valid, denialReason, agentId, principalId, trustBand, scopesGranted)
// — the bits a relying party actually relies on.

import type { VerifyResponse } from '@cerniq/types';

export type ShadowMode = 'off' | 'shadow' | 'live';

export function shadowMode(env: {
  CERNIQ_EDGE_VERIFY_ENABLED?: string;
  CERNIQ_EDGE_VERIFY_SHADOW_MODE?: string;
}): ShadowMode {
  if (env.CERNIQ_EDGE_VERIFY_ENABLED === 'true') return 'live';
  if (env.CERNIQ_EDGE_VERIFY_SHADOW_MODE === 'true') return 'shadow';
  return 'off';
}

export interface DivergenceReport {
  divergent: boolean;
  /** Fields that differed. Empty when divergent=false. */
  fields: string[];
  /** True iff one side decided and the other forwarded — rarer + more interesting. */
  outcomeDifference?: boolean;
}

/**
 * Compare two verify responses on the decision-relevant tuple. Returns
 * `{ divergent: true, fields: [...] }` when ANY of the cared-about
 * fields differ. Used for the shadow-mode header.
 */
export function compareVerifyResponses(
  edge: VerifyResponse,
  origin: VerifyResponse,
): DivergenceReport {
  const fields: string[] = [];
  if (edge.valid !== origin.valid) fields.push('valid');
  if (edge.denialReason !== origin.denialReason) fields.push('denialReason');
  if (edge.agentId !== origin.agentId) fields.push('agentId');
  if (edge.principalId !== origin.principalId) fields.push('principalId');
  if (edge.trustBand !== origin.trustBand) fields.push('trustBand');
  if (!arraysEqual(edge.scopesGranted, origin.scopesGranted)) fields.push('scopesGranted');
  return { divergent: fields.length > 0, fields };
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Encode a divergence report into a single-line header value. We
 * deliberately keep it short + ASCII so it survives proxies.
 *
 *   "agree"
 *   "diverge:valid,denialReason"
 *   "edge-forward:no-edge-decision"
 *
 * Operators query Cloudflare logs for `X-CERNIQ-Edge-Divergence: diverge:*`
 * to spot disagreements. With shadow mode active for 7 days at production
 * traffic we expect to see a clear pass/fail signal.
 */
export function divergenceHeader(report: DivergenceReport | { edgeForwarded: true }): string {
  if ('edgeForwarded' in report) return 'edge-forward:no-edge-decision';
  if (!report.divergent) return 'agree';
  return `diverge:${report.fields.join(',')}`;
}

/**
 * Optional: emit divergence to Workers Analytics Engine. Stub kept here
 * so the worker can wire it up without restructuring. Set
 * CERNIQ_DIVERGENCE_DATASET_BINDING in env to enable.
 */
export interface AnalyticsEngineLike {
  writeDataPoint(p: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export function recordDivergence(
  ae: AnalyticsEngineLike | undefined,
  report: DivergenceReport | { edgeForwarded: true },
  ctx: { agentId: string | null; denialReason: string | null },
): void {
  if (!ae) return;
  if ('edgeForwarded' in report) {
    ae.writeDataPoint({
      blobs: ['edge-forward', ctx.agentId ?? '', ctx.denialReason ?? ''],
      doubles: [0],
      indexes: ['cf-verify-shadow'],
    });
    return;
  }
  ae.writeDataPoint({
    blobs: [
      report.divergent ? 'diverge' : 'agree',
      report.fields.join(','),
      ctx.agentId ?? '',
      ctx.denialReason ?? '',
    ],
    doubles: [report.divergent ? 1 : 0],
    indexes: ['cf-verify-shadow'],
  });
}
