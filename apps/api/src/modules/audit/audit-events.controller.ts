// Tenant-wide audit-events surface (M-006 finalisation).
//
// Sister to `audit.controller.ts` (`/agents/:agentId/audit`) — this one
// scopes by principal only and is mounted at `/audit-events` so SOC2
// evidence pulls don't have to fan out per-agent.
//
// CLAUDE.md invariant #5 — every query is scoped to `auth.principalId`.
// The endpoint cannot leak cross-tenant rows; the streaming generator in
// AuditService takes principalId as the first arg.

import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../auth/api-key.service';
import { AuditService } from './audit.service';
import { AuditEventsQueryDto, AuditLogResponseDto, AuditQueryDto } from './audit.dto';

@ApiTags('Audit')
@ApiSecurity('ApiKeyAuth')
@Controller('audit-events')
export class AuditEventsController {
  constructor(private readonly audit: AuditService) {}

  /**
   * GET /v1/audit-events
   *
   * Principal-wide paginated audit list. Round 24 Lane B added the
   * `?stripeEventId=` filter so operators can reconcile Stripe webhook
   * activity to the matching audit row(s) without fanning out across
   * agents. Other filters: `from`/`to` (ISO timestamps), `limit`, `cursor`.
   *
   * Same wire shape as `GET /v1/agents/:agentId/audit` so dashboards can
   * reuse rendering without branching by scope.
   */
  @Get()
  @ApiOperation({
    summary: 'Paginated principal-wide audit log.',
    description:
      'Returns audit events for the calling principal, newest first. Use ' +
      '`?stripeEventId=evt_…` to reconcile a Stripe activity item with the ' +
      'AEGIS audit chain (Round 24 Lane B). Other filters: from, to, limit, cursor.',
  })
  list(
    @Auth() auth: AuthenticatedKey,
    @Query() query: AuditEventsQueryDto,
  ): Promise<AuditLogResponseDto> {
    return this.audit.listTenant(auth.principalId, query);
  }

  /**
   * GET /v1/audit-events/export
   *
   * Streams `application/x-ndjson` of every audit event the calling
   * principal owns, in chronological order so chain verifiers can walk
   * forward. The stream is paginated internally in 1k-row blocks; memory
   * is bounded regardless of tenant size. The chain signature on each
   * row + the `/.well-known/audit-signing-key` JWKS lets a third party
   * verify the chain offline.
   */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Stream the tenant-wide audit log as newline-delimited JSON.',
    description:
      'NDJSON export of every audit event for the calling principal. ' +
      'Use `?from=<iso>&to=<iso>` to bound by timestamp. The export is ' +
      'memory-bounded via internal cursor pagination; consumers can pipe ' +
      'directly through `jq` or `xsv` without buffering.',
  })
  @ApiProduces('application/x-ndjson')
  async exportNdjson(
    @Auth() auth: AuthenticatedKey,
    @Query() query: AuditQueryDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AEGIS-Export-Format', 'ndjson-v1');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="aegis-audit-${auth.principalId}-${today}.ndjson"`,
    );

    for await (const row of this.audit.exportTenantStream(auth.principalId, query)) {
      if (!res.write(`${JSON.stringify(row)}\n`)) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  }
}
