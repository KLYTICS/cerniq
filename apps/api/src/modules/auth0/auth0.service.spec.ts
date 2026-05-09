// Spec was originally authored against vitest; `apps/api` runs jest. Map
// the small surface (`vi.fn`) to its jest equivalent so this file runs in
// the project's existing test runner without pulling in vitest.
const vi = { fn: jest.fn };
import { UnauthorizedException } from '@nestjs/common';
import { Auth0Service } from './auth0.service';

function build(opts: {
  verifyResult?: unknown;
  ensureResult?: { principalId: string; created: boolean };
} = {}) {
  const audit = { append: vi.fn(async () => 'evt_test') };
  const idp = {
    verifyAccessToken: vi.fn(async () => opts.verifyResult ?? null),
    ensurePrincipalForOrg: vi.fn(async () => opts.ensureResult ?? { principalId: 'p_x', created: false }),
  };
  const svc = new Auth0Service(audit as never, idp as never);
  return { svc, audit, idp };
}

describe('Auth0Service.handleActionLogin', () => {
  it('writes APPROVED audit when MFA satisfied', async () => {
    const { svc, audit } = build({ ensureResult: { principalId: 'p_acme', created: false } });
    const r = await svc.handleActionLogin({
      user_id: 'auth0|abc', organization_id: 'org_acme',
      email: 'a@b.co', email_verified: true,
      mfa: true, roles: ['aegis:admin'],
      occurred_at: '2026-05-02T00:00:00Z', ip: '1.2.3.4', user_agent: 'curl',
    });
    expect(r.principal_id).toBe('p_acme');
    const args = ((audit.append as unknown as jest.Mock).mock.calls[0]?.[0] ?? {}) as { decision?: string };
    expect(args.decision).toBe('APPROVED');
  });

  it('writes FLAGGED audit when MFA missing', async () => {
    const { svc, audit } = build();
    await svc.handleActionLogin({
      user_id: 'u', organization_id: 'org', email: 'a@b.co', email_verified: true,
      mfa: false, roles: [], occurred_at: '2026-05-02T00:00:00Z', ip: '', user_agent: '',
    });
    const args = ((audit.append as unknown as jest.Mock).mock.calls[0]?.[0] ?? {}) as { decision?: string; denialReason?: string };
    expect(args.decision).toBe('FLAGGED');
    expect(args.denialReason).toBe('TRUST_SCORE_TOO_LOW');
  });
});

describe('Auth0Service.exchangeToken', () => {
  it('rejects when adapter returns null (bad token)', async () => {
    const { svc } = build({ verifyResult: null });
    await expect(svc.exchangeToken({ access_token: 'bad' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when org_id is missing', async () => {
    const { svc } = build({
      verifyResult: { idpUserId: 'u', idpOrganizationId: '', idpDomain: '', email: 'a@b.co', emailVerified: true, name: null, roles: [], mfaSatisfied: true, rawClaims: {} },
    });
    await expect(svc.exchangeToken({ access_token: 't' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when email is unverified', async () => {
    const { svc } = build({
      verifyResult: { idpUserId: 'u', idpOrganizationId: 'org', idpDomain: '', email: 'a@b.co', emailVerified: false, name: null, roles: [], mfaSatisfied: true, rawClaims: {} },
    });
    await expect(svc.exchangeToken({ access_token: 't' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns API key with VERIFIED band when MFA satisfied', async () => {
    const { svc, audit } = build({
      verifyResult: { idpUserId: 'u', idpOrganizationId: 'org', idpDomain: 'acme.com', email: 'a@b.co', emailVerified: true, name: 'A', roles: ['aegis:admin'], mfaSatisfied: true, rawClaims: {} },
      ensureResult: { principalId: 'p_acme', created: false },
    });
    const r = await svc.exchangeToken({ access_token: 't' });
    expect(r.api_key_id).toMatch(/^aegis_live_/);
    expect(r.principal_id).toBe('p_acme');
    expect(r.roles).toEqual(['aegis:admin']);
    const args = ((audit.append as unknown as jest.Mock).mock.calls[0]?.[0] ?? {}) as { trustBandAtEvent?: string };
    expect(args.trustBandAtEvent).toBe('VERIFIED');
  });
});
