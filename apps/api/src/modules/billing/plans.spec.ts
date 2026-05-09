import { PLANS, getPlan, isVerifyCallAllowed, overageToCents } from './plans';

describe('Pricing plans (OD-003 default)', () => {
  it('exposes one definition per PlanTier', () => {
    expect(Object.keys(PLANS).sort()).toEqual(['DEVELOPER', 'ENTERPRISE', 'FREE', 'GROWTH']);
  });

  it('FREE delegates the gate to TrialService (UsageGuard short-circuited)', () => {
    // Round-19 / peer-review F-08: FREE.monthlyVerifyQuota is
    // Number.POSITIVE_INFINITY so `isVerifyCallAllowed` never fires
    // PLAN_LIMIT_EXCEEDED for FREE tier. The canonical FREE-tier denial
    // is `TRIAL_EXHAUSTED` from `TrialService` at TRIAL_LIFETIME_CAP.
    const plan = getPlan('FREE');
    expect(plan.monthlyVerifyQuota).toBe(Number.POSITIVE_INFINITY);
    expect(isVerifyCallAllowed(plan, 999_999)).toEqual({ allowed: true, remaining: Number.POSITIVE_INFINITY });
  });

  it('DEVELOPER permits metered overage', () => {
    const plan = getPlan('DEVELOPER');
    const r = isVerifyCallAllowed(plan, plan.monthlyVerifyQuota + 100);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('ENTERPRISE has no quota wall', () => {
    const r = isVerifyCallAllowed(getPlan('ENTERPRISE'), 10_000_000);
    expect(r.allowed).toBe(true);
  });

  describe('overage rate field (peer review F-03)', () => {
    it('paid tiers store $0.0008/verify as 8 in the E4 (10⁻⁴ USD) field', () => {
      expect(getPlan('DEVELOPER').overagePerCallE4).toBe(8);
      expect(getPlan('GROWTH').overagePerCallE4).toBe(8);
    });

    it('FREE and ENTERPRISE are hard-stop / custom (overagePerCallE4 === null)', () => {
      expect(getPlan('FREE').overagePerCallE4).toBeNull();
      expect(getPlan('ENTERPRISE').overagePerCallE4).toBeNull();
    });

    it('overageToCents converts E4 → cents (÷100): 8 → 0.08', () => {
      // $0.0008/verify = 0.08 cents/verify. The historical landmine: a
      // naive consumer reading `8` from a `*Cents`-suffixed field would
      // bill 100× too much. `overageToCents` is the audited conversion.
      expect(overageToCents(8)).toBe(0.08);
      expect(overageToCents(100)).toBe(1);
      expect(overageToCents(0)).toBe(0);
    });
  });

  describe('verifyRateLimit (OD-006)', () => {
    it('FREE permits 20 calls in a 1s window', () => {
      expect(getPlan('FREE').verifyRateLimit).toEqual({ limit: 20, ttlMs: 1_000 });
    });

    it('DEVELOPER permits 200 calls in a 1s window', () => {
      expect(getPlan('DEVELOPER').verifyRateLimit).toEqual({ limit: 200, ttlMs: 1_000 });
    });

    it('GROWTH permits 1_000 calls in a 1s window', () => {
      expect(getPlan('GROWTH').verifyRateLimit).toEqual({ limit: 1_000, ttlMs: 1_000 });
    });

    it('ENTERPRISE uses POSITIVE_INFINITY sentinel for unlimited', () => {
      const e = getPlan('ENTERPRISE').verifyRateLimit;
      expect(e.limit).toBe(Number.POSITIVE_INFINITY);
      expect(e.ttlMs).toBe(1_000);
    });
  });
});
