// WorkOsAdapter — third implementation of IdpAdapter (ADR-0009-B).
//
// WorkOS is the enterprise-SSO standard for B2B SaaS in 2026. Unlike
// Auth0 / Clerk which are general identity providers, WorkOS specializes
// in SAML / OIDC federation to corporate IdPs (Okta, Microsoft Entra,
// Google Workspace, ADFS, OneLogin, JumpCloud). WorkOS issues its own
// short-lived sealed sessions (`workos_session_<base64>`) that the
// dashboard hands to OKORO for verification.
//
// Why ship this NOW: ADR-0009 §6 commits to `IdpAdapter` swappability.
// Two adapters (Auth0 + Clerk) prove the contract holds for the same
// shape (RS256 JWT issuers). WorkOS proves it holds for a fundamentally
// different shape (sealed sessions + introspection API), which is a
// stronger validation. After this, adding Okta-direct / Entra-direct /
// Keycloak is a 1-day exercise.
//
// Trust model: OKORO trusts WorkOS to authenticate the human, then maps
// WorkOS Organizations → OKORO Principals via `idpProvider='workos'` +
// `idpOrganizationId=<workos_org_id>`. WorkOS Roles are propagated as
// `okoro:*` claims via the WorkOS Directory Sync custom-claims feature.

import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppConfigService } from '../../config/config.service';
import type { IdpAdapter, IdpUser } from '../auth0/idp.adapter';

const SESSION_CACHE_TTL_S = 60; // WorkOS sessions are short-lived; cache mirrors that.

/**
 * Minimal WorkOS client surface. Production wiring uses the official
 * `@workos-inc/node` SDK; tests and unit verifier-rp builds inject
 * a fake. Keeping this shape isolates us from SDK version churn.
 */
export interface WorkOsClientLike {
  /** WorkOS `userManagement.authenticateWithSessionCookie` equivalent. */
  authenticateSession(sessionCookie: string): Promise<{
    user: {
      id: string;
      email: string;
      emailVerified: boolean;
      firstName?: string;
      lastName?: string;
      organizationId?: string;
    };
    organizationId?: string;
    roles?: string[];
    /** Whether MFA was satisfied this session. */
    mfaEnrolled?: boolean;
    sessionId: string;
    expiresAt: number; // unix seconds
  }>;
  /** Fetch organization metadata for principal-bind (org domain → idpDomain). */
  getOrganization(orgId: string): Promise<{ id: string; name: string; domains?: { domain: string }[] }>;
}

@Injectable()
export class WorkOsAdapter implements IdpAdapter {
  readonly provider = 'workos' as const;
  private readonly logger = new Logger(WorkOsAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    _config: AppConfigService,
    private readonly workos: WorkOsClientLike,
  ) {
    void _config; // currently unused; reserved for runtime knob toggles.
  }

  async verifyAccessToken(token: string): Promise<IdpUser | null> {
    // WorkOS access tokens are "sealed sessions" — opaque to OKORO.
    // Verification == calling WorkOS's introspection. Cache aggressively
    // (per session) so we don't spam WorkOS on every verify.
    const cacheKey = `idp:workos:session:${createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
    const cached = await this.redis.get<IdpUser>(cacheKey);
    if (cached) return cached;

    let session: Awaited<ReturnType<WorkOsClientLike['authenticateSession']>>;
    try {
      session = await this.workos.authenticateSession(token);
    } catch (err) {
      this.logger.debug(`workos session auth failed: ${(err as Error).message}`);
      return null;
    }
    if (session.expiresAt * 1000 < Date.now()) return null;

    const orgId = session.organizationId ?? session.user.organizationId ?? '';
    const orgDomain = orgId ? await this.lookupOrgDomain(orgId) : '';

    const user: IdpUser = {
      idpUserId: session.user.id,
      idpOrganizationId: orgId,
      idpDomain: orgDomain,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      name: [session.user.firstName, session.user.lastName].filter(Boolean).join(' ') || null,
      // WorkOS roles propagate verbatim from the corporate IdP. We filter
      // to `okoro:*` so customer-side IdP role names don't leak in.
      roles: (session.roles ?? []).filter((r) => typeof r === 'string' && r.startsWith('okoro:')),
      mfaSatisfied: Boolean(session.mfaEnrolled),
      rawClaims: {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        organizationId: orgId,
      },
    };

    // Cache for the lesser of (session TTL, default cap). WorkOS sessions
    // are typically 1 hour; we cap aggressive at 60s so revocation
    // (`api/v1/sessions/{id}/revoke`) propagates within a minute.
    const remainingS = Math.max(1, session.expiresAt - Math.floor(Date.now() / 1000));
    await this.redis.set(cacheKey, user, Math.min(SESSION_CACHE_TTL_S, remainingS));
    return user;
  }

  async ensurePrincipalForOrg(args: {
    idpOrganizationId: string;
    idpDomain: string;
    email: string;
    name?: string | null;
  }): Promise<{ principalId: string; created: boolean }> {
    const existing = await this.prisma.principal.findFirst({
      where: { idpProvider: 'workos', idpOrganizationId: args.idpOrganizationId },
      select: { id: true },
    });
    if (existing) return { principalId: existing.id, created: false };

    const fingerprint = createHash('sha256').update(`workos:${args.idpOrganizationId}`).digest('hex').slice(0, 12);
    const principal = await this.prisma.principal.create({
      data: {
        id: `p_wo_${fingerprint}`,
        email: args.email,
        name: args.name ?? args.idpDomain,
        idpProvider: 'workos',
        idpOrganizationId: args.idpOrganizationId,
        idpDomain: args.idpDomain,
      },
      select: { id: true },
    });
    return { principalId: principal.id, created: true };
  }

  private async lookupOrgDomain(orgId: string): Promise<string> {
    const cacheKey = `idp:workos:org:${orgId}`;
    const cached = await this.redis.get<string>(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    try {
      const org = await this.workos.getOrganization(orgId);
      const primary = org.domains?.[0]?.domain ?? '';
      // Cache org domain for an hour — they rarely change.
      await this.redis.set(cacheKey, primary, 3600);
      return primary;
    } catch (err) {
      this.logger.warn(`workos getOrganization failed for ${orgId}: ${(err as Error).message}`);
      return '';
    }
  }
}
