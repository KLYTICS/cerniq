import { PLANS, getPlan, isVerifyCallAllowed } from './plans';

describe('Pricing plans (OD-003 default)', () => {
  it('exposes one definition per PlanTier', () => {
    expect(Object.keys(PLANS).sort()).toEqual(['DEVELOPER', 'ENTERPRISE', 'FREE', 'GROWTH']);
  });

  it('FREE hard-stops at quota', () => {
    const plan = getPlan('FREE');
    expect(isVerifyCallAllowed(plan, 999)).toEqual({ allowed: true, remaining: 1 });
    expect(isVerifyCallAllowed(plan, 1_000)).toEqual({
      allowed: false,
      remaining: 0,
      reason: 'PLAN_LIMIT_EXCEEDED',
    });
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
});
