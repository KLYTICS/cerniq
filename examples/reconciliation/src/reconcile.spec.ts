import { describe, it, expect } from 'vitest';

import { reconcile, type CerniqAuditRow, type UnderlyingSystemRow } from './reconcile.js';

const cerniqRow = (id: string, decision: CerniqAuditRow['decision']): CerniqAuditRow => ({
  endToEndId: id,
  eventId: `evt_${id}`,
  decision,
  denialReason: decision === 'DENIED' ? 'INVALID_SIGNATURE' : null,
  agentId: 'ag_x',
  principalId: 'pri_x',
  timestamp: '2026-05-05T00:00:00.000Z',
});

const sysRow = (
  id: string,
  status: UnderlyingSystemRow['status'],
  extras: Partial<UnderlyingSystemRow> = {},
): UnderlyingSystemRow => ({
  endToEndId: id,
  systemId: `ch_${id}`,
  status,
  amount: 100,
  currency: 'USD',
  timestamp: '2026-05-05T00:00:01.000Z',
  ...extras,
});

describe('reconcile — happy path', () => {
  it('matches settled rows and totals by currency', () => {
    const r = reconcile(
      [cerniqRow('e1', 'APPROVED'), cerniqRow('e2', 'APPROVED')],
      [sysRow('e1', 'settled'), sysRow('e2', 'settled', { amount: 250 })],
    );
    expect(r.approvedMissing).toBe(0);
    expect(r.deniedPresent).toBe(0);
    expect(r.matchedTotalsByCurrency.USD).toBe(350);
  });
});

describe('reconcile — approved_missing', () => {
  it('flags CERNIQ-approved rows with no system record', () => {
    const r = reconcile(
      [cerniqRow('e1', 'APPROVED'), cerniqRow('e2', 'APPROVED')],
      [sysRow('e1', 'settled')],
    );
    expect(r.approvedMissing).toBe(1);
    expect(r.entries.find((e) => e.class === 'approved_missing')?.endToEndId).toBe('e2');
  });

  it('does NOT flag denied CERNIQ rows as missing (denied is the expected outcome)', () => {
    const r = reconcile([cerniqRow('e1', 'DENIED')], []);
    expect(r.approvedMissing).toBe(0);
  });
});

describe('reconcile — denied_present (the bypass case)', () => {
  it('flags CERNIQ-denied rows that the system charged anyway', () => {
    const r = reconcile([cerniqRow('e1', 'DENIED')], [sysRow('e1', 'settled')]);
    expect(r.deniedPresent).toBe(1);
    expect(r.entries[0]?.class).toBe('denied_present');
    expect(r.entries[0]?.cerniq?.decision).toBe('DENIED');
  });

  it('flags system rows that have NO matching CERNIQ row at all', () => {
    const r = reconcile([], [sysRow('e1', 'settled')]);
    expect(r.deniedPresent).toBe(1);
    expect(r.entries[0]?.cerniq).toBeNull();
  });
});

describe('reconcile — reversed → BATE feedback', () => {
  it('classifies chargebacks as fraud_confirmed', () => {
    const r = reconcile(
      [cerniqRow('e1', 'APPROVED')],
      [sysRow('e1', 'reversed', { reversalCause: 'chargeback' })],
    );
    expect(r.reversed).toBe(1);
    expect(r.entries[0]?.bateFeedback).toBe('fraud_confirmed');
  });

  it('classifies NACHA R03 / R05 as fraud_confirmed', () => {
    const r1 = reconcile(
      [cerniqRow('e1', 'APPROVED')],
      [sysRow('e1', 'reversed', { reversalCause: 'r03' })],
    );
    expect(r1.entries[0]?.bateFeedback).toBe('fraud_confirmed');
    const r2 = reconcile(
      [cerniqRow('e1', 'APPROVED')],
      [sysRow('e1', 'reversed', { reversalCause: 'r05' })],
    );
    expect(r2.entries[0]?.bateFeedback).toBe('fraud_confirmed');
  });

  it('classifies refunds as false_positive', () => {
    const r = reconcile(
      [cerniqRow('e1', 'APPROVED')],
      [sysRow('e1', 'reversed', { reversalCause: 'refund' })],
    );
    expect(r.entries[0]?.bateFeedback).toBe('false_positive');
  });

  it('defaults unknown causes to false_positive (conservative)', () => {
    const r = reconcile([cerniqRow('e1', 'APPROVED')], [sysRow('e1', 'reversed')]);
    expect(r.entries[0]?.bateFeedback).toBe('false_positive');
  });
});

describe('reconcile — pending / failed do not flag', () => {
  it('skips pending system rows (they resolve later)', () => {
    const r = reconcile([cerniqRow('e1', 'APPROVED')], [sysRow('e1', 'pending')]);
    expect(r.approvedMissing).toBe(0);
    expect(r.deniedPresent).toBe(0);
    expect(r.reversed).toBe(0);
  });

  it('skips failed system rows (no money moved)', () => {
    const r = reconcile([cerniqRow('e1', 'APPROVED')], [sysRow('e1', 'failed')]);
    expect(r.deniedPresent).toBe(0);
  });
});

describe('reconcile — includeMatched controls report size', () => {
  it('omits matched_settled entries by default', () => {
    const r = reconcile([cerniqRow('e1', 'APPROVED')], [sysRow('e1', 'settled')]);
    expect(r.entries.find((e) => e.class === 'matched_settled')).toBeUndefined();
  });
  it('includes them when requested', () => {
    const r = reconcile([cerniqRow('e1', 'APPROVED')], [sysRow('e1', 'settled')], {
      includeMatched: true,
    });
    expect(r.entries.find((e) => e.class === 'matched_settled')).toBeDefined();
  });
});
