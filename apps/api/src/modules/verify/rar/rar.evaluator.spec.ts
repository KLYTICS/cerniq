// rar.evaluator.spec.ts — RFC 9396 RAR promotion test.
//
// Locks the binding between the RFC 9396 wire shape and AEGIS's pure
// evaluator. If this passes in CI, the discovery doc may claim
// `standards_implemented: ['RFC-9396']`. If it fails, the claim is a
// CLAUDE.md invariant #4 violation (no fabricated data).

import { evaluateRar } from './rar.evaluator';
import type {
  AegisAuthorizationDetail,
  AgentActionAuthDetail,
  DataAccessAuthDetail,
  PaymentInitiationAuthDetail,
  TradingOrderAuthDetail,
} from './rar.types';

// Helpers
const buyOrder = (
  o: Partial<TradingOrderAuthDetail> = {},
): TradingOrderAuthDetail => ({
  type: 'trading_order',
  actions: ['buy'],
  ...o,
});

const TRADING_HOURS_TS = new Date('2026-06-08T14:00:00Z'); // Mon 10:00 ET — open
const OFF_HOURS_TS = new Date('2026-06-08T03:00:00Z'); // Sun 23:00 ET — closed
const SAT_TS = new Date('2026-06-13T15:00:00Z'); // Sat 11:00 ET — weekend

describe('evaluateRar — input contract', () => {
  it('empty array returns no_authorization_details', () => {
    const r = evaluateRar([], { type: 'trading_order', action: 'buy' });
    expect(r).toEqual({ ok: false, reason: 'no_authorization_details' });
  });

  it('candidate type not matching any detail returns type_unauthorized', () => {
    const details: AegisAuthorizationDetail[] = [buyOrder()];
    const r = evaluateRar(details, { type: 'payment_initiation', action: 'pay' });
    expect(r).toEqual({ ok: false, reason: 'type_unauthorized' });
  });

  it('first matching detail wins (multiple-detail support is roadmap)', () => {
    const details: AegisAuthorizationDetail[] = [
      buyOrder({ actions: ['buy'] }),
      buyOrder({ actions: ['sell'] }),
    ];
    // candidate is 'sell' — first detail (buy-only) wins by matched type,
    // and since 'sell' isn't in its actions, the result is action_unauthorized.
    // (NOT a fallback to the second detail.)
    const r = evaluateRar(details, { type: 'trading_order', action: 'sell' });
    expect(r).toEqual({ ok: false, reason: 'action_unauthorized' });
  });
});

describe('evaluateRar — trading_order', () => {
  it('happy: buy within limits, in trading hours', () => {
    const d = buyOrder({
      actions: ['buy', 'sell'],
      instruments: ['NASDAQ:AAPL'],
      limits: { per_order_usd: 50000 },
      trading_hours_only: true,
    });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      instrument: 'NASDAQ:AAPL',
      amount_usd: 49750,
      at: TRADING_HOURS_TS,
    });
    expect(r).toEqual({ ok: true, matched_detail_type: 'trading_order' });
  });

  it('rejects unauthorized action', () => {
    const d = buyOrder({ actions: ['buy'] });
    const r = evaluateRar([d], { type: 'trading_order', action: 'sell' });
    expect(r).toEqual({ ok: false, reason: 'action_unauthorized' });
  });

  it('rejects instrument not in whitelist', () => {
    const d = buyOrder({ instruments: ['NASDAQ:AAPL'] });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      instrument: 'NYSE:GE',
    });
    expect(r).toEqual({ ok: false, reason: 'instrument_not_whitelisted' });
  });

  it('accepts wildcard instrument whitelist (NASDAQ:*)', () => {
    const d = buyOrder({ instruments: ['NASDAQ:*'] });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      instrument: 'NASDAQ:MSFT',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects per-order limit exceeded', () => {
    const d = buyOrder({ limits: { per_order_usd: 50000 } });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 50001,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('limit_exceeded');
      expect(r.detail).toContain('per_order_usd=50000');
    }
  });

  it('rejects per-day limit exceeded (spent_today + amount > limit)', () => {
    const d = buyOrder({ limits: { per_day_usd: 100000 } });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 60000,
      spent_today_usd: 50000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('limit_exceeded');
  });

  it('per_day_usd: edge — exactly at limit allows', () => {
    const d = buyOrder({ limits: { per_day_usd: 100000 } });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 50000,
      spent_today_usd: 50000,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects per-order qty cap', () => {
    const d = buyOrder({ limits: { per_order_qty: 100 } });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      qty: 101,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('limit_exceeded');
  });

  it('rejects action outside trading hours when trading_hours_only=true', () => {
    const d = buyOrder({ trading_hours_only: true });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      at: OFF_HOURS_TS,
    });
    expect(r).toEqual({ ok: false, reason: 'outside_trading_hours' });
  });

  it('rejects action on Saturday when trading_hours_only=true', () => {
    const d = buyOrder({ trading_hours_only: true });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      at: SAT_TS,
    });
    expect(r).toEqual({ ok: false, reason: 'outside_trading_hours' });
  });

  it('allows action when trading_hours_only is unset (no schedule constraint)', () => {
    const d = buyOrder({ actions: ['buy'] });
    const r = evaluateRar([d], {
      type: 'trading_order',
      action: 'buy',
      at: SAT_TS,
    });
    expect(r.ok).toBe(true);
  });
});

describe('evaluateRar — payment_initiation', () => {
  const baseDetail = (
    o: Partial<PaymentInitiationAuthDetail> = {},
  ): PaymentInitiationAuthDetail => ({
    type: 'payment_initiation',
    actions: ['transfer'],
    ...o,
  });

  it('happy: transfer within limit + allowed destination', () => {
    const d = baseDetail({
      destinations: ['acct_vendor_x'],
      limits: { per_transaction_usd: 10000 },
    });
    const r = evaluateRar([d], {
      type: 'payment_initiation',
      action: 'transfer',
      destination: 'acct_vendor_x',
      amount_usd: 5000,
    });
    expect(r).toEqual({ ok: true, matched_detail_type: 'payment_initiation' });
  });

  it('rejects destination not whitelisted', () => {
    const d = baseDetail({ destinations: ['acct_a'] });
    const r = evaluateRar([d], {
      type: 'payment_initiation',
      action: 'transfer',
      destination: 'acct_b',
      amount_usd: 100,
    });
    expect(r).toEqual({ ok: false, reason: 'destination_not_whitelisted' });
  });

  it('rejects currency outside allowed list', () => {
    const d = baseDetail({ currencies: ['USD'] });
    const r = evaluateRar([d], {
      type: 'payment_initiation',
      action: 'transfer',
      amount_usd: 100,
      currency: 'EUR',
    });
    expect(r).toEqual({ ok: false, reason: 'currency_unauthorized' });
  });

  it('rejects per_transaction_usd cap', () => {
    const d = baseDetail({ limits: { per_transaction_usd: 5000 } });
    const r = evaluateRar([d], {
      type: 'payment_initiation',
      action: 'transfer',
      amount_usd: 5001,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('limit_exceeded');
  });

  it('refund is a separate action and must be explicitly listed', () => {
    const d = baseDetail({ actions: ['transfer'] }); // refund missing
    const r = evaluateRar([d], {
      type: 'payment_initiation',
      action: 'refund',
      amount_usd: 100,
    });
    expect(r).toEqual({ ok: false, reason: 'action_unauthorized' });
  });
});

describe('evaluateRar — data_access', () => {
  const baseDetail = (
    o: Partial<DataAccessAuthDetail> = {},
  ): DataAccessAuthDetail => ({
    type: 'data_access',
    actions: ['read'],
    ...o,
  });

  it('happy: read of whitelisted resource', () => {
    const d = baseDetail({ resources: ['banking/accounts/*'] });
    const r = evaluateRar([d], {
      type: 'data_access',
      action: 'read',
      resource: 'banking/accounts/acct_123',
    });
    expect(r).toEqual({ ok: true, matched_detail_type: 'data_access' });
  });

  it('rejects resource not in whitelist', () => {
    const d = baseDetail({ resources: ['banking/accounts/*'] });
    const r = evaluateRar([d], {
      type: 'data_access',
      action: 'read',
      resource: 'trading/positions/pos_1',
    });
    expect(r).toEqual({ ok: false, reason: 'resource_not_whitelisted' });
  });

  it('rejects PII access when pii_allowed unset (strict default)', () => {
    const d = baseDetail({ resources: ['kyc/*'] });
    const r = evaluateRar([d], {
      type: 'data_access',
      action: 'read',
      resource: 'kyc/customer_xyz',
      is_pii: true,
    });
    expect(r).toEqual({ ok: false, reason: 'pii_disallowed' });
  });

  it('rejects PII access when pii_allowed=false explicitly', () => {
    const d = baseDetail({ resources: ['kyc/*'], pii_allowed: false });
    const r = evaluateRar([d], {
      type: 'data_access',
      action: 'read',
      resource: 'kyc/customer_xyz',
      is_pii: true,
    });
    expect(r.ok).toBe(false);
  });

  it('allows PII access when pii_allowed=true', () => {
    const d = baseDetail({ resources: ['kyc/*'], pii_allowed: true });
    const r = evaluateRar([d], {
      type: 'data_access',
      action: 'read',
      resource: 'kyc/customer_xyz',
      is_pii: true,
    });
    expect(r.ok).toBe(true);
  });
});

describe('evaluateRar — agent_action (generic)', () => {
  it('happy: action in whitelist', () => {
    const d: AgentActionAuthDetail = {
      type: 'agent_action',
      actions: ['compose_email', 'send_email'],
    };
    const r = evaluateRar([d], {
      type: 'agent_action',
      action: 'compose_email',
    });
    expect(r).toEqual({ ok: true, matched_detail_type: 'agent_action' });
  });

  it('rejects action outside whitelist', () => {
    const d: AgentActionAuthDetail = {
      type: 'agent_action',
      actions: ['compose_email'],
    };
    const r = evaluateRar([d], {
      type: 'agent_action',
      action: 'delete_email',
    });
    expect(r).toEqual({ ok: false, reason: 'action_unauthorized' });
  });
});

describe('evaluateRar — FAPI 2.0 demo scenario (wedge §5)', () => {
  // The demo flow named in `AEGIS_WEDGE_FINANCIAL_STANDARDS_2026-05-15.md` §5:
  // ai_pm_v1 has a trading_order detail; broker submits a $49,750 BUY of
  // NASDAQ:AAPL during trading hours. Lock this exact scenario.

  it('locks the wedge demo: $49,750 BUY NASDAQ:AAPL during trading hours allows', () => {
    const policy: AegisAuthorizationDetail[] = [
      {
        type: 'trading_order',
        actions: ['buy', 'sell'],
        instruments: ['NYSE:*', 'NASDAQ:*'],
        limits: { per_order_usd: 50000, per_day_usd: 250000 },
        trading_hours_only: true,
      },
    ];
    const candidate = {
      type: 'trading_order',
      action: 'buy',
      instrument: 'NASDAQ:AAPL',
      amount_usd: 49750,
      qty: 100,
      at: TRADING_HOURS_TS,
      spent_today_usd: 0,
    };
    expect(evaluateRar(policy, candidate)).toEqual({
      ok: true,
      matched_detail_type: 'trading_order',
    });
  });

  it('locks the wedge demo: $50,001 BUY rejects with per_order_usd', () => {
    const policy: AegisAuthorizationDetail[] = [
      {
        type: 'trading_order',
        actions: ['buy'],
        limits: { per_order_usd: 50000 },
      },
    ];
    const r = evaluateRar(policy, {
      type: 'trading_order',
      action: 'buy',
      instrument: 'NASDAQ:AAPL',
      amount_usd: 50001,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('limit_exceeded');
      expect(r.detail).toContain('50000');
    }
  });

  it('locks the wedge demo: $200K daily-cap rejects 4th $60K order', () => {
    const policy: AegisAuthorizationDetail[] = [
      {
        type: 'trading_order',
        actions: ['buy'],
        limits: { per_day_usd: 200000 },
      },
    ];
    // After three $60K orders, the spent-today total is $180K. The 4th
    // $60K would push to $240K > $200K cap.
    const r = evaluateRar(policy, {
      type: 'trading_order',
      action: 'buy',
      amount_usd: 60000,
      spent_today_usd: 180000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('limit_exceeded');
  });
});
