import { Auth0Adapter } from './auth0.adapter';

// Spec was originally authored against vitest; map the small surface used
// (`vi.fn`) to its jest equivalent.
const vi = { fn: jest.fn };

// We mock just enough of PrismaService + RedisService + AppConfigService
// to drive the adapter. Real fetch is replaced via globalThis.fetch stub.

interface FakeJwk { kty: 'RSA'; kid: string; alg: string; n: string; e: string; }

const SAMPLE_JWK: FakeJwk = {
  kty: 'RSA',
  kid: 'test-kid',
  alg: 'RS256',
  // 2048-bit modulus + e=AQAB. Crypto verify will fail because we have no
  // matching private key — but the adapter exits early on alg/kid/iss
  // mismatch, so the JWKS-fetch path is the testable surface.
  n: 'sXchDaQebHnPiGvyDOAT4saGEUetSyo9MKLOoWFsueri23bOdgWp4Dy1WlUzewbgBHod5pcM9H95GQRV3JDXboIRROSBigeC5yjU1hGzHHyXss8UDprecbAYxknTcQkhslANGRUZmdTOQ5ZTsHLrlrCnfLYy0_Wgs9z9aKgUNWTW7XjLPKBfZelpO-AMgyWVwlLYfPK6XAHX-OWevJOWmzAU8Hkfx5UDxv8oU_Y9X3Xn4xX7T0Cz5JU_eOmF1CWa6cvXc8H7uGaC9PjAYHcZqUlBnJznuU-Vhc6P_RkeGnH9z9bTC9rE5oc4P3iJa6yYx0FJD3uNV5G7g7iuG5wfSsw',
  e: 'AQAB',
};

function makeAdapter() {
  const prisma = { principal: { findFirst: vi.fn(), create: vi.fn() } };
  const redis = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
  const config = { auth0Issuer: 'https://aegis.us.auth0.com/', auth0Audience: 'https://api.aegis.dev' };
  return new Auth0Adapter(prisma as never, redis as never, config as never);
}

// `describe`/`it`/`expect`/`beforeEach` are jest globals; nothing to import.

describe('Auth0Adapter.verifyAccessToken', () => {
  beforeEach(() => {
    (globalThis as { fetch?: typeof fetch }).fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ keys: [SAMPLE_JWK] }) }) as Response,
    );
  });

  it('rejects malformed tokens (not three segments)', async () => {
    const a = makeAdapter();
    expect(await a.verifyAccessToken('only.two')).toBeNull();
  });

  it('rejects unsupported alg', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'test-kid' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'auth0|abc' })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects wrong issuer', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-kid' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'https://evil.example/', exp: Date.now() / 1000 + 3600 })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-kid' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://aegis.us.auth0.com/',
      aud: 'https://api.aegis.dev',
      exp: 1000,
    })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects mismatched audience', async () => {
    const a = makeAdapter();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-kid' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://aegis.us.auth0.com/',
      aud: 'https://other.example/',
      exp: Date.now() / 1000 + 3600,
    })).toString('base64url');
    expect(await a.verifyAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });
});

describe('Auth0Adapter.ensurePrincipalForOrg', () => {
  it('returns existing principal when found', async () => {
    const prisma = {
      principal: {
        findFirst: vi.fn(async () => ({ id: 'p_existing' })),
        create: vi.fn(),
      },
    };
    const a = new Auth0Adapter(prisma as never, { get: async () => null, set: async () => undefined } as never, {} as never);
    const r = await a.ensurePrincipalForOrg({ idpOrganizationId: 'org_acme', idpDomain: 'acme.com', email: 'admin@acme.com', name: 'Acme Admin' });
    expect(r).toEqual({ principalId: 'p_existing', created: false });
    expect(prisma.principal.create).not.toHaveBeenCalled();
  });

  it('creates a new principal with stable derived id when not found', async () => {
    const prisma = {
      principal: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({ id: data.id })),
      },
    };
    const a = new Auth0Adapter(prisma as never, { get: async () => null, set: async () => undefined } as never, {} as never);
    const r = await a.ensurePrincipalForOrg({ idpOrganizationId: 'org_acme', idpDomain: 'acme.com', email: 'admin@acme.com', name: 'Acme Admin' });
    expect(r.created).toBe(true);
    expect(r.principalId).toMatch(/^p_a0_[0-9a-f]{12}$/);
    // Same input → same id (idempotent).
    const r2 = await a.ensurePrincipalForOrg({ idpOrganizationId: 'org_acme', idpDomain: 'acme.com', email: 'admin@acme.com', name: 'Acme Admin' });
    expect(r2.principalId).toBe(r.principalId);
  });
});
