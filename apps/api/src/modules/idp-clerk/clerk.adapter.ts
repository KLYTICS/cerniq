// ClerkAdapter — second implementation of IdpAdapter (ADR-0009-A).
//
// Clerk uses RS256 JWTs with a JWKS endpoint at
// `https://<frontend-api>/.well-known/jwks.json`. Tokens are short-lived
// (60s by default) and carry an `org_id` claim when the user is acting
// within a Clerk Organization.
//
// This adapter mirrors Auth0Adapter's contract bit-for-bit — it implements
// the same `IdpAdapter` interface so swapping is one DI binding change in
// `app.module.ts` (or the dashboard side, depending on which surface).
//
// Why ship a second adapter NOW: it's the proof that the interface holds.
// Without a second implementation, `IdpAdapter` is just an aspiration.
// With Clerk, every line of code that imports `IdpAdapter` instead of
// `Auth0Adapter` is verifiably swappable.

import { createHash, createPublicKey, verify as verifyAsymmetric } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppConfigService } from '../../config/config.service';
import type { IdpAdapter, IdpUser } from '../auth0/idp.adapter';

const ALLOWED_ALGS = new Set(['RS256', 'RS384', 'RS512']);
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
export class ClerkAdapter implements IdpAdapter {
  readonly provider = 'clerk' as const;
  private readonly logger = new Logger(ClerkAdapter.name);

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

    const expectedIss = (this.config as unknown as { clerkIssuer?: string }).clerkIssuer;
    if (!expectedIss || claims.iss !== expectedIss) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;

    // Clerk's `azp` claim (authorized party) holds the application/origin.
    // Clerk does NOT use `aud` for application-level audience the way
    // Auth0 does — instead operators verify by `iss` + a list of allowed
    // `azp` values. Skip strict aud check; verify azp if configured.
    const allowedAzps = (this.config as unknown as { clerkAllowedAzps?: string[] }).clerkAllowedAzps;
    if (allowedAzps && allowedAzps.length > 0) {
      if (typeof claims.azp !== 'string' || !allowedAzps.includes(claims.azp)) return null;
    }

    const jwk = await this.getJwk(header.kid);
    if (!jwk) return null;

    const pubKey = createPublicKey({
      key: jwk as unknown as import('node:crypto').JsonWebKey,
      format: 'jwk',
    });
    const data = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    const sig = Buffer.from(sigB64, 'base64url');
    const algoOid = header.alg === 'RS512' ? 'RSA-SHA512' : header.alg === 'RS384' ? 'RSA-SHA384' : 'RSA-SHA256';
    if (!verifyAsymmetric(algoOid, data, pubKey, sig)) return null;

    return {
      idpUserId: typeof claims.sub === 'string' ? claims.sub : '',
      // Clerk's organization id lives at `org_id` (active org) or `o.id`
      // depending on the Clerk version.
      idpOrganizationId:
        typeof claims.org_id === 'string'
          ? claims.org_id
          : (() => {
              const o = claims.o as Record<string, unknown> | undefined;
              return typeof o?.id === 'string' ? o.id : '';
            })(),
      idpDomain: typeof claims.org_slug === 'string' ? claims.org_slug : '',
      email: typeof claims.email === 'string' ? claims.email : '',
      emailVerified: Boolean(claims.email_verified),
      name: typeof claims.name === 'string' ? claims.name : null,
      // Clerk roles arrive as `org_role` (single string for active org) or
      // a custom claim. We normalize: only `okoro:*` roles propagate.
      roles: typeof claims.org_role === 'string' && claims.org_role.startsWith('okoro:')
        ? [claims.org_role]
        : Array.isArray(claims['https://okoro.dev/roles'])
          ? (claims['https://okoro.dev/roles'] as string[]).filter((r) => r.startsWith('okoro:'))
          : [],
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
    const existing = await this.prisma.principal.findFirst({
      where: { idpProvider: 'clerk', idpOrganizationId: args.idpOrganizationId },
      select: { id: true },
    });
    if (existing) return { principalId: existing.id, created: false };

    const fingerprint = createHash('sha256').update(`clerk:${args.idpOrganizationId}`).digest('hex').slice(0, 12);
    const principal = await this.prisma.principal.create({
      data: {
        id: `p_ck_${fingerprint}`,
        email: args.email,
        name: args.name ?? args.idpDomain,
        idpProvider: 'clerk',
        idpOrganizationId: args.idpOrganizationId,
        idpDomain: args.idpDomain,
      },
      select: { id: true },
    });
    return { principalId: principal.id, created: true };
  }

  private async getJwk(kid: string): Promise<Jwk | null> {
    const cacheKey = `idp:clerk:jwk:${kid}`;
    const cached = await this.redis.get<Jwk>(cacheKey);
    if (cached) return cached;

    const issuer = (this.config as unknown as { clerkIssuer?: string }).clerkIssuer;
    if (!issuer) return null;
    const jwksUrl = `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
    const res = await fetch(jwksUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      this.logger.warn(`clerk jwks fetch failed status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { keys?: Jwk[] };
    const match = body.keys?.find((k) => k.kid === kid);
    if (!match) return null;
    await this.redis.set(cacheKey, match, JWKS_CACHE_TTL_S);
    return match;
  }
}
