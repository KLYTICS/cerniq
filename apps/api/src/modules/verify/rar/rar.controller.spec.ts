// rar.controller.spec.ts — HTTP-layer test for /v1/verify/rar/evaluate.
//
// The evaluator itself is exhaustively tested in rar.evaluator.spec.ts;
// this spec locks the controller's wire contract: response shape,
// binding_version, evaluated_at presence, end-to-end happy + sad paths
// through the DTO coercion, AND the observability emission (Prometheus
// counters + structured log).

import type { AuthenticatedKey } from '../../auth/api-key.service';
import type { MetricsService } from '../../../common/observability/metrics.service';
import { RarController } from './rar.controller';
import { RarEvaluateRequestDto } from './rar.dto';

/** Minimal stub recording `inc` + `observe` calls so the spec can
 *  assert observability emission without depending on prom-client. */
function buildMetricsStub() {
  const incCalls: Array<Record<string, string>> = [];
  const observeCalls: Array<{ labels: Record<string, string>; value: number }> = [];
  return {
    incCalls,
    observeCalls,
    stub: {
      rarEvaluationsTotal: {
        inc: (labels: Record<string, string>) => incCalls.push(labels),
      },
      rarEvaluationLatency: {
        observe: (labels: Record<string, string>, value: number) =>
          observeCalls.push({ labels, value }),
      },
    } as unknown as MetricsService,
  };
}

const AUTH: AuthenticatedKey = {
  principalId: 'prn_test',
  apiKeyId: 'key_test',
  scopes: ['verify'],
} as unknown as AuthenticatedKey;

describe('RarController', () => {
  let ctrl: RarController;
  let m: ReturnType<typeof buildMetricsStub>;

  beforeEach(() => {
    m = buildMetricsStub();
    ctrl = new RarController(m.stub);
  });

  function run(body: RarEvaluateRequestDto) {
    return ctrl.evaluate(AUTH, body);
  }

  describe('response shape', () => {
    it('returns ok=true with matched_detail_type on allow', () => {
      const res = run({
        authorization_details: [
          { type: 'agent_action', actions: ['compose_email'] },
        ],
        candidate: { type: 'agent_action', action: 'compose_email' },
      });
      expect(res.ok).toBe(true);
      expect(res.matched_detail_type).toBe('agent_action');
      expect(res.reason).toBeNull();
      expect(res.detail).toBeNull();
    });

    it('returns ok=false with typed reason on deny', () => {
      const res = run({
        authorization_details: [
          { type: 'trading_order', actions: ['buy'], limits: { per_order_usd: 1000 } },
        ],
        candidate: {
          type: 'trading_order',
          action: 'buy',
          amount_usd: 1001,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.matched_detail_type).toBeNull();
      expect(res.reason).toBe('limit_exceeded');
      expect(res.detail).toContain('per_order_usd=1000');
    });

    it('stamps binding_version on every response', () => {
      const res = run({
        authorization_details: [],
        candidate: { type: 'agent_action', action: 'x' },
      });
      expect(res.binding_version).toBe('aegis-rar-1.0');
    });

    it('stamps evaluated_at as ISO 8601 on every response', () => {
      const res = run({
        authorization_details: [
          { type: 'agent_action', actions: ['x'] },
        ],
        candidate: { type: 'agent_action', action: 'x' },
      });
      expect(res.evaluated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('DTO coercion', () => {
    it('parses ISO 8601 `at` into a Date for trading_hours_only checks', () => {
      const res = run({
        authorization_details: [
          {
            type: 'trading_order',
            actions: ['buy'],
            trading_hours_only: true,
          },
        ],
        candidate: {
          type: 'trading_order',
          action: 'buy',
          // 2026-06-13 (Saturday) 15:00 UTC ≈ 11:00 ET — closed
          at: '2026-06-13T15:00:00Z',
        },
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('outside_trading_hours');
    });

    it('empty authorization_details returns no_authorization_details', () => {
      const res = run({
        authorization_details: [],
        candidate: { type: 'trading_order', action: 'buy' },
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('no_authorization_details');
    });

    it('unknown candidate type returns type_unauthorized (graceful, not throw)', () => {
      const res = run({
        authorization_details: [
          { type: 'trading_order', actions: ['buy'] },
        ],
        candidate: { type: 'unknown_type_xyz', action: 'buy' },
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('type_unauthorized');
    });
  });

  describe('FAPI 2.0 demo scenario lock', () => {
    // The exact demo flow from AEGIS_WEDGE_FINANCIAL_STANDARDS_2026-05-15.md §5,
    // exercised through the HTTP DTO surface so a buyer's curl matches.

    it('AI portfolio manager rebalances $49,750 NASDAQ:AAPL — ALLOW', () => {
      const res = run({
        authorization_details: [
          {
            type: 'trading_order',
            actions: ['buy', 'sell'],
            instruments: ['NYSE:*', 'NASDAQ:*'],
            limits: { per_order_usd: 50000, per_day_usd: 250000 },
            trading_hours_only: true,
          },
        ],
        candidate: {
          type: 'trading_order',
          action: 'buy',
          instrument: 'NASDAQ:AAPL',
          amount_usd: 49750,
          qty: 100,
          at: '2026-06-08T14:00:00Z', // Mon 10:00 ET
          spent_today_usd: 0,
        },
      });
      expect(res.ok).toBe(true);
      expect(res.matched_detail_type).toBe('trading_order');
    });

    it('over-cap $50,001 BUY rejects with detail "per_order_usd=50000"', () => {
      const res = run({
        authorization_details: [
          {
            type: 'trading_order',
            actions: ['buy'],
            limits: { per_order_usd: 50000 },
          },
        ],
        candidate: {
          type: 'trading_order',
          action: 'buy',
          amount_usd: 50001,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('limit_exceeded');
      expect(res.detail).toContain('per_order_usd=50000');
    });
  });

  describe('observability emission', () => {
    // Locks the production-readiness contract: every evaluate() call
    // emits exactly one counter increment + one latency observation
    // with bounded labels. Cardinality regressions (e.g. a future change
    // adding free-form labels like principal_id) break the build here.

    it('emits result=allow with matched detail_type on allow', () => {
      run({
        authorization_details: [
          { type: 'agent_action', actions: ['x'] },
        ],
        candidate: { type: 'agent_action', action: 'x' },
      });
      expect(m.incCalls).toHaveLength(1);
      expect(m.incCalls[0]).toEqual({
        result: 'allow',
        detail_type: 'agent_action',
        deny_reason: 'allow',
      });
    });

    it('emits result=deny with detail_type=none + typed deny_reason on deny', () => {
      run({
        authorization_details: [
          { type: 'trading_order', actions: ['buy'] },
        ],
        candidate: { type: 'trading_order', action: 'sell' },
      });
      expect(m.incCalls).toHaveLength(1);
      expect(m.incCalls[0]).toEqual({
        result: 'deny',
        detail_type: 'none',
        deny_reason: 'action_unauthorized',
      });
    });

    it('emits result=deny with deny_reason=no_authorization_details on empty input', () => {
      run({
        authorization_details: [],
        candidate: { type: 'agent_action', action: 'x' },
      });
      expect(m.incCalls[0]).toEqual({
        result: 'deny',
        detail_type: 'none',
        deny_reason: 'no_authorization_details',
      });
    });

    it('emits exactly one latency observation per evaluate()', () => {
      run({
        authorization_details: [{ type: 'agent_action', actions: ['x'] }],
        candidate: { type: 'agent_action', action: 'x' },
      });
      expect(m.observeCalls).toHaveLength(1);
      expect(m.observeCalls[0]?.labels).toEqual({ result: 'allow' });
      expect(m.observeCalls[0]?.value).toBeGreaterThanOrEqual(0);
      expect(m.observeCalls[0]?.value).toBeLessThan(1); // pure fn must be sub-second
    });

    it('label cardinality is bounded — no free-form labels (principal_id, ips, etc.)', () => {
      // CLAUDE.md observability rule: do not add free-form labels to
      // Prometheus metrics. This test fails if a future change adds
      // anything beyond {result, detail_type, deny_reason}.
      run({
        authorization_details: [{ type: 'agent_action', actions: ['x'] }],
        candidate: { type: 'agent_action', action: 'x' },
      });
      const labels = Object.keys(m.incCalls[0] ?? {});
      expect(labels.sort()).toEqual(['deny_reason', 'detail_type', 'result']);
    });
  });
});
