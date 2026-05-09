import { WorkOsAdapter, type WorkOsClientLike } from './workos.adapter';

function fakeWorkos(opts: {
  authResponse?: Awaited<ReturnType<WorkOsClientLike['authenticateSession']>> | Error;
  org?: Awaited<ReturnType<WorkOsClientLike['getOrganization']>>;
} = {}): WorkOsClientLike {
  return {
    authenticateSession: jest.fn(async () => {
      if (opts.authResponse instanceof Error) throw opts.authResponse;
      return opts.authResponse ?? { user: { id: 'u', email: 'a@b.co', emailVerified: true }, sessionId: 's', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    }),
    getOrganization: jest.fn(async () => opts.org ?? { id: 'org', name: 'Acme', domains: [{ domain: 'acme.com' }] }),
  };
}

function build(workos: WorkOsClientLike) {
  const prisma = {
    principal: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: { data: { id: string } }) => ({ id: data.id })) },
  };
  const redis = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
  const config = {};
  return new WorkOsAdapter(prisma as never, redis as never, config as never, workos);
}

describe('WorkOsAdapter.verifyAccessToken', () => {
  it('returns IdpUser on a valid sealed session', async () => {
    const a = build(fakeWorkos({
      authResponse: {
        user: { id: 'u_1', email: 'a@b.co', emailVerified: true, firstName: 'A', lastName: 'B', organizationId: 'org_1' },
        organizationId: 'org_1',
        roles: ['aegis:admin', 'role:not-aegis-prefixed'],
        mfaEnrolled: true,
        sessionId: 's_1',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      org: { id: 'org_1', name: 'Acme', domains: [{ domain: 'acme.com' }] },
    }));
    const r = await a.verifyAccessToken('cookie_xyz');
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.idpUserId).toBe('u_1');
    expect(r.idpOrganizationId).toBe('org_1');
    expect(r.idpDomain).toBe('acme.com');
    expect(r.email).toBe('a@b.co');
    expect(r.name).toBe('A B');
    // Only aegis:* roles propagate.
    expect(r.roles).toEqual(['aegis:admin']);
    expect(r.mfaSatisfied).toBe(true);
    expect(r.rawClaims.sessionId).toBe('s_1');
  });

  it('returns null when WorkOS session auth throws', async () => {
    const a = build(fakeWorkos({ authResponse: new Error('invalid session') }));
    expect(await a.verifyAccessToken('bad')).toBeNull();
  });

  it('returns null when session is expired', async () => {
    const a = build(fakeWorkos({
      authResponse: {
        user: { id: 'u', email: 'a@b.co', emailVerified: true },
        sessionId: 's', expiresAt: Math.floor(Date.now() / 1000) - 60, // already expired
      },
    }));
    expect(await a.verifyAccessToken('expired')).toBeNull();
  });

  it('uses Redis cache on second call', async () => {
    const cachedUser = { idpUserId: 'cached', idpOrganizationId: 'org_c', idpDomain: 'cached.com', email: 'c@b.co', emailVerified: true, name: 'C', roles: [], mfaSatisfied: false, rawClaims: {} };
    const workos = fakeWorkos();
    const prisma = { principal: { findFirst: jest.fn(), create: jest.fn() } };
    const redis = { get: jest.fn(async () => cachedUser), set: jest.fn(async () => undefined) };
    const a = new WorkOsAdapter(prisma as never, redis as never, {} as never, workos);
    const r = await a.verifyAccessToken('any');
    expect(r?.idpUserId).toBe('cached');
    expect(workos.authenticateSession).not.toHaveBeenCalled(); // cache hit short-circuited
  });

  it('handles missing organizationId by setting idpDomain to ""', async () => {
    const a = build(fakeWorkos({
      authResponse: {
        user: { id: 'u', email: 'a@b.co', emailVerified: true },
        sessionId: 's', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    }));
    const r = await a.verifyAccessToken('any');
    expect(r?.idpOrganizationId).toBe('');
    expect(r?.idpDomain).toBe('');
  });
});

describe('WorkOsAdapter.ensurePrincipalForOrg', () => {
  it('returns existing principal when found', async () => {
    const prisma = {
      principal: {
        findFirst: jest.fn(async () => ({ id: 'p_existing' })),
        create: jest.fn(),
      },
    };
    const a = new WorkOsAdapter(prisma as never, { get: async () => null, set: async () => undefined } as never, {} as never, fakeWorkos());
    const r = await a.ensurePrincipalForOrg({ idpOrganizationId: 'org', idpDomain: 'acme.com', email: 'a@b.co' });
    expect(r).toEqual({ principalId: 'p_existing', created: false });
    expect(prisma.principal.create).not.toHaveBeenCalled();
  });

  it('creates with stable derived id when not found', async () => {
    const a = build(fakeWorkos());
    const r = await a.ensurePrincipalForOrg({ idpOrganizationId: 'org_new', idpDomain: 'new.com', email: 'a@b.co' });
    expect(r.created).toBe(true);
    expect(r.principalId).toMatch(/^p_wo_[0-9a-f]{12}$/);
  });
});
