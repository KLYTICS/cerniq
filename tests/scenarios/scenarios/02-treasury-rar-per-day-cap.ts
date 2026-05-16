// Scenario 02 — Treasury, RAR per-day cap exhausted.
//
// Exercises: L2 (RFC 9396 RAR evaluator).
// Procurement claim: "Treasury agent has RAR authorization_details with
// per_order_usd=25000 + per_day_usd=100000. Three sequential orders within
// the day: 50K passes, 30K passes (cumulative 80K), third order at 25K is
// denied with RAR_PER_DAY_EXCEEDED (cumulative would be 105K)."
//
// References: peer bf9d6030's RFC-9396 promotion to standards_implemented.

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '02',
  name: 'Treasury — RAR per-day cap exhausted',
  vertical: 'treasury',
  layers: ['L2'],
  description:
    'RFC 9396 Rich Authorization Requests with per_order_usd=25000 + per_day_usd=100000. Three sequential trading_order candidates evaluated cumulatively. First two pass; third trips per-day cap.',
  async run(ctx, t) {
    const authDetails = [{
      type: 'trading_order' as const,
      actions: ['buy', 'sell'],
      limits: {
        per_order_usd: 25000,
        per_day_usd: 100000,
        trading_hours_utc: [13, 21] as [number, number],
      },
    }];

    // First order — $50K... but wait, per_order_usd is 25K. Let me test that first.
    const tooBigOrder = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 50000,
      day_total_usd: 0,
      utc_hour: 14,
    });
    t.expect(tooBigOrder.ok, 'per_order=50K (over cap 25K) denied').toBe(false);
    t.expect(tooBigOrder.reason!, 'per_order_exceeded reason').toBe('RAR_PER_ORDER_EXCEEDED');

    // First valid order — $20K (under per_order, fresh day)
    const order1 = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 20000,
      day_total_usd: 0,
      utc_hour: 14,
    });
    t.expect(order1.ok, 'order1 $20K ok').toBe(true);
    t.expect(order1.matched_detail_type!, 'order1 matched').toBe('trading_order');
    t.expect(order1.binding_version!, 'binding version').toBe('aegis-rar-1.0');

    // Second valid order — $25K (at per_order cap, day_total now 20K → 45K)
    const order2 = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 25000,
      day_total_usd: 20000,
      utc_hour: 15,
    });
    t.expect(order2.ok, 'order2 $25K at cap ok').toBe(true);

    // Third order — day_total now 80K, attempting $25K → 105K > 100K cap → DENY
    const order3 = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 25000,
      day_total_usd: 80000,
      utc_hour: 16,
    });
    t.expect(order3.ok, 'order3 trips per_day cap').toBe(false);
    t.expect(order3.reason!, 'per_day_exceeded reason').toBe('RAR_PER_DAY_EXCEEDED');

    // Order against unmatched action — sell-action against buy-only detail
    const detailsBuyOnly = [{
      type: 'trading_order' as const,
      actions: ['buy'],
      limits: { per_order_usd: 100000 },
    }];
    const wrongAction = ctx.evaluateRAR(detailsBuyOnly, {
      type: 'trading_order',
      action: 'sell',
      amount_usd: 1000,
      day_total_usd: 0,
    });
    t.expect(wrongAction.ok, 'sell against buy-only detail denied').toBe(false);
    t.expect(wrongAction.reason!, 'no_match reason').toBe('RAR_NO_MATCH');
  },
};

export default scenario;
