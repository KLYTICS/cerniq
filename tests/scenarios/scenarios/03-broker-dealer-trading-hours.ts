// Scenario 03 — Broker-dealer, RAR trading-hours constraint.
//
// Exercises: L2 (RAR temporal binding).
// Procurement claim: "Broker-dealer agent has RAR with trading_hours_utc=[13,21]
// (covers US market hours 09:30-16:00 ET). Order at 14:00 UTC passes; order
// at 22:00 UTC is denied with RAR_OUTSIDE_TRADING_HOURS. FINRA-relevant:
// supervisory evidence that out-of-hours trades cannot be authorized."

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '03',
  name: 'Broker-dealer — RAR trading-hours constraint',
  vertical: 'broker-dealer',
  layers: ['L2'],
  description:
    'FINRA-aligned trading-hours constraint via RFC 9396 RAR. Orders within 13:00-21:00 UTC pass; orders outside are denied with typed reason. Auditable from the discovery profile.',
  async run(ctx, t) {
    const authDetails = [{
      type: 'trading_order' as const,
      actions: ['buy', 'sell'],
      limits: {
        per_order_usd: 1_000_000,
        trading_hours_utc: [13, 21] as [number, number], // 13:00 UTC - 21:00 UTC
      },
    }];

    // 10:00 UTC — before market open
    const preMarket = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 50000,
      utc_hour: 10,
    });
    t.expect(preMarket.ok, '10:00 UTC denied (pre-market)').toBe(false);
    t.expect(preMarket.reason!, 'pre-market reason').toBe('RAR_OUTSIDE_TRADING_HOURS');

    // 14:00 UTC — within market hours
    const intraday = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 50000,
      utc_hour: 14,
    });
    t.expect(intraday.ok, '14:00 UTC ok').toBe(true);

    // 13:00 UTC — boundary inclusive (market open)
    const openBoundary = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'sell',
      amount_usd: 100000,
      utc_hour: 13,
    });
    t.expect(openBoundary.ok, '13:00 UTC boundary ok').toBe(true);

    // 21:00 UTC — boundary exclusive (after close)
    const closeBoundary = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'sell',
      amount_usd: 100000,
      utc_hour: 21,
    });
    t.expect(closeBoundary.ok, '21:00 UTC boundary denied').toBe(false);

    // 22:00 UTC — after market close
    const postMarket = ctx.evaluateRAR(authDetails, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 1000,
      utc_hour: 22,
    });
    t.expect(postMarket.ok, '22:00 UTC denied (post-market)').toBe(false);
    t.expect(postMarket.reason!, 'post-market reason').toBe('RAR_OUTSIDE_TRADING_HOURS');
  },
};

export default scenario;
