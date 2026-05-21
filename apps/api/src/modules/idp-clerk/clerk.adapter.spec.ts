// Paired tests for ClerkAdapter. These tests exercise the early-exit
// validation gates (alg/issuer/expiry/azp). The required-claim
// strict-rejection behavior is covered by the validator-helper spec at
// apps/api/src/modules/auth0/idp-claim-validators.spec.ts, which exercises
// the exact branches this adapter wires up — without needing to forge a
// real RS256 signature for every claim-coercion case.

import { ClerkAdapter } from './clerk.adapter';

const vi = { fn: jest.fn };

function makeAdapter(extraConfig: Record<string, unknown> = {}) {
  const prisma = { principal: { findFirst: vi.fn(), create: vi.fn() } };
  const redis = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
  const config = {
    clerkIssuer: 'https://clean-tiger-12.clerk.accounts.dev',
    ...extraConfig,
  };
  return new ClerkAdapter(prisma as never, redis as never, config as never);
}

describe('ClerkAdapter.verifyAccessToken', () => {
  beforeEach(() => {
    (globalThis as { fetch?: typeof fetch }).fetch = vi.fn(async () =>
      ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    );
  });

  it('rejects malformed tokens (not three segments)', async () => {
    const a = makeAdapter();
    expect(await a.verifyAccessToken('only.two')).toBeNull();
    expect(await a.verifyAccessToken('one')).toBeNull();
  });

  it('rejects tokens with non-JSON header or payload', async () => {
    const a = makeAdapter();
    expect(await a.verifyAccessToken('garbage.garbage.garbage')).toBeNull();
  });

  it('rejects unsupported alg', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'k' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user_x' })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects when kid is missing', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user_x' })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects wrong issuer', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://evil.example/',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects when issuer is not configured', async () => {
    const a = makeAdapter({ clerkIssuer: undefined });
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://clean-tiger-12.clerk.accounts.dev',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://clean-tiger-12.clerk.accounts.dev',
      exp: 1000,
    })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects when azp allow-list is configured and azp does not match', async () => {
    const a = makeAdapter({ clerkAllowedAzps: ['https://app.aegis.dev'] });
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://clean-tiger-12.clerk.accounts.dev',
      exp: Math.floor(Date.now() / 1000) + 3600,
      azp: 'https://attacker.example',
    })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });
});

describe('ClerkAdapter.ensurePrincipalForOrg', () => {
  it('returns existing principal when found', async () => {
    const prisma = {
      principal: {
        findFirst: vi.fn(async () => ({ id: 'p_existing' })),
        create: vi.fn(),
      },
    };
    const a = new ClerkAdapter(
      prisma as never,
      { get: async () => null, set: async () => undefined } as never,
      { clerkIssuer: 'https://x' } as never,
    );
    const r = await a.ensurePrincipalForOrg({
      idpOrganizationId: 'org_acme',
      idpDomain: 'acme',
      email: 'admin@acme.com',
      name: 'Acme Admin',
    });
    expect(r).toEqual({ principalId: 'p_existing', created: false });
    expect(prisma.principal.create).not.toHaveBeenCalled();
  });

  it('creates with stable derived id when not found', async () => {
    const prisma = {
      principal: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({ id: data.id })),
      },
    };
    const a = new ClerkAdapter(
      prisma as never,
      { get: async () => null, set: async () => undefined } as never,
      { clerkIssuer: 'https://x' } as never,
    );
    const r = await a.ensurePrincipalForOrg({
      idpOrganizationId: 'org_new',
      idpDomain: 'new',
      email: 'a@b.co',
    });
    expect(r.created).toBe(true);
    expect(r.principalId).toMatch(/^p_ck_[0-9a-f]{12}$/);
    // Same input → same id (idempotent).
    const r2 = await a.ensurePrincipalForOrg({
      idpOrganizationId: 'org_new',
      idpDomain: 'new',
      email: 'a@b.co',
    });
    expect(r2.principalId).toBe(r.principalId);
  });
});
