// Auth0 implementation of IdpAdapter (ADR-0009).
//
// Verifies Auth0 access tokens via the issuer's JWKS endpoint. Caches
// JWKS in Redis with the TTL from `Cache-Control: max-age` (or 1 hour
// default). RS256 today — when Auth0 GAs EdDSA, swap the alg whitelist;
// the rest of this code is alg-agnostic.

import { createHash, createPublicKey, verify as verifyAsymmetric } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppConfigService } from '../../config/config.service';

import type { IdpAdapter, IdpUser } from './idp.adapter';

const ALLOWED_ALGS = new Set(['RS256', 'RS384', 'RS512']); // Auth0 default; EdDSA when GA.
const JWKS_CACHE_TTL_S = 3600;

interface Jwk {
  kty: 'RSA';
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

@Injectable()
export class Auth0Adapter implements IdpAdapter {
  readonly provider = 'auth0' as const;
  private readonly logger = new Logger(Auth0Adapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  async verifyAccessToken(token: string): Promise<IdpUser | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    let header: { alg?: string; kid?: string; typ?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!header.alg || !ALLOWED_ALGS.has(header.alg) || !header.kid) return null;

    // Issuer + audience check — these come from operator config.
    const expectedIss = this.config.auth0Issuer; // e.g. https://aegis.us.auth0.com/
    const expectedAud = this.config.auth0Audience; // e.g. https://api.aegis.dev
    if (claims.iss !== expectedIss) return null;
    if (Array.isArray(claims.aud) ? !claims.aud.includes(expectedAud) : claims.aud !== expectedAud) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;

    const jwk = await this.getJwk(header.kid);
    if (!jwk) return null;

    // type-rationale: our `Jwk` interface is RSA-shaped and matches `JsonWebKey`
    // structurally, but lacks the `[index: string]: unknown` signature node:crypto
    // requires. The cast is safe — `createPublicKey` reads `kty/n/e` and ignores
    // the rest, and we've already validated `kty: 'RSA'` upstream.
    const pubKey = createPublicKey({ key: jwk as unknown as import('node:crypto').JsonWebKey, format: 'jwk' });
    const data = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    const sig = Buffer.from(sigB64, 'base64url');
    const algoOid = header.alg === 'RS512' ? 'RSA-SHA512' : header.alg === 'RS384' ? 'RSA-SHA384' : 'RSA-SHA256';
    if (!verifyAsymmetric(algoOid, data, pubKey, sig)) return null;

    return {
      idpUserId: typeof claims.sub === 'string' ? claims.sub : '',
      idpOrganizationId:
        typeof claims.org_id === 'string'
          ? claims.org_id
          : typeof claims.organization === 'string'
            ? claims.organization
            : '',
      idpDomain:
        typeof claims['https://aegis.dev/domain'] === 'string'
          ? claims['https://aegis.dev/domain']
          : '',
      email: typeof claims.email === 'string' ? claims.email : '',
      emailVerified: Boolean(claims.email_verified),
      name: typeof claims.name === 'string' ? claims.name : null,
      roles: Array.isArray(claims['https://aegis.dev/roles']) ? (claims['https://aegis.dev/roles'] as string[]) : [],
      mfaSatisfied: Array.isArray(claims.amr) && (claims.amr as string[]).includes('mfa'),
      rawClaims: claims,
    };
  }

  async ensurePrincipalForOrg(args: {
    idpOrganizationId: string;
    idpDomain: string;
    email: string;
    name?: string | null;
  }): Promise<{ principalId: string; created: boolean }> {
    // Lookup by IdP fields. If absent, create a principal whose id is
    // derived from a stable hash of the IdP org id (so a re-create is
    // idempotent and discoverable from operational logs).
    const existing = await this.prisma.principal.findFirst({
      where: { idpProvider: 'auth0', idpOrganizationId: args.idpOrganizationId },
      select: { id: true },
    });
    if (existing) return { principalId: existing.id, created: false };

    const fingerprint = createHash('sha256').update(`auth0:${args.idpOrganizationId}`).digest('hex').slice(0, 12);
    const principal = await this.prisma.principal.create({
      data: {
        id: `p_a0_${fingerprint}`,
        email: args.email,
        name: args.name ?? args.idpDomain,
        idpProvider: 'auth0',
        idpOrganizationId: args.idpOrganizationId,
        idpDomain: args.idpDomain,
      },
      select: { id: true },
    });
    return { principalId: principal.id, created: true };
  }

  private async getJwk(kid: string): Promise<Jwk | null> {
    const cacheKey = `idp:auth0:jwk:${kid}`;
    const cached = await this.redis.get<Jwk>(cacheKey);
    if (cached) return cached;

    const jwksUrl = `${this.config.auth0Issuer}.well-known/jwks.json`;
    const res = await fetch(jwksUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      this.logger.warn(`auth0 jwks fetch failed status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { keys?: Jwk[] };
    const match = body.keys?.find((k) => k.kid === kid);
    if (!match) return null;
    await this.redis.set(cacheKey, match, JWKS_CACHE_TTL_S);
    return match;
  }
}
