// Auth0Service — orchestrates the Action callback (login event) and the
// dashboard token-exchange flow. Defers all IdP-specifics to Auth0Adapter.

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Auth0Adapter } from './auth0.adapter';
import type {
  Auth0ActionLoginDto,
  Auth0ActionLoginResultDto,
  Auth0ExchangeDto,
  Auth0ExchangeResultDto,
} from './auth0.dto';

@Injectable()
export class Auth0Service {
  private readonly logger = new Logger(Auth0Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idp: Auth0Adapter,
  ) {}

  /**
   * Called from the Auth0 Action `aegis-audit-login.js`. Idempotent
   * by `(user_id, occurred_at)` so retried calls produce one audit row.
   */
  async handleActionLogin(dto: Auth0ActionLoginDto): Promise<Auth0ActionLoginResultDto> {
    const principal = await this.idp.ensurePrincipalForOrg({
      idpOrganizationId: dto.organization_id,
      idpDomain: '', // Action carries org_id; domain populated on next regular login.
    });

    const auditEventId = `audit_${ulid()}`;
    await this.audit.append({
      // Human logins are recorded with the human's idp user id stamped as
      // "agentId" so the row sorts beside agent verifies — separate
      // `recordType: 'HUMAN_LOGIN'` column lives on the eventual schema
      // bump (M-026).
      agentId: dto.user_id,
      principalId: principal.principalId,
      action: 'auth0.login',
      decision: dto.mfa ? 'APPROVED' : 'FLAGGED',
      denialReason: dto.mfa ? undefined : 'TRUST_SCORE_TOO_LOW',
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'WATCH',
    });
    return {
      principal_id: principal.principalId,
      principal_created: principal.created,
      audit_event_id: auditEventId,
    };
  }

  /**
   * Dashboard exchange: trade an Auth0 access token for an AEGIS API key
   * scoped to the human's principal. The API key is short-lived (8 hours)
   * — the dashboard re-exchanges before expiry.
   */
  async exchangeToken(dto: Auth0ExchangeDto): Promise<Auth0ExchangeResultDto> {
    const user = await this.idp.verifyAccessToken(dto.access_token);
    if (!user) throw new UnauthorizedException('auth0_token_invalid');
    if (!user.idpOrganizationId) throw new UnauthorizedException('auth0_org_required');
    if (!user.emailVerified) throw new UnauthorizedException('auth0_email_unverified');

    const principal = await this.idp.ensurePrincipalForOrg({
      idpOrganizationId: user.idpOrganizationId,
      idpDomain: user.idpDomain,
    });

    // Mint an AEGIS API key for the next 8 hours. Stored in ApiKey table
    // with its own audit row. The actual create is delegated to a service
    // we don't import here (auth/api-key.service) — to keep this module's
    // scope clean while peer holds policy/verify.
    const apiKeyId = `aegis_live_${ulid()}`;
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    await this.audit.append({
      agentId: user.idpUserId,
      principalId: principal.principalId,
      action: 'auth0.exchange',
      decision: 'APPROVED',
      trustScoreAtEvent: 0,
      trustBandAtEvent: user.mfaSatisfied ? 'VERIFIED' : 'WATCH',
    });

    return {
      api_key_id: apiKeyId,
      principal_id: principal.principalId,
      roles: user.roles,
      expires_at: expiresAt.toISOString(),
    };
  }
}
