import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../auth/api-key.service';
import { AuditService } from './audit.service';
import { AuditLogResponseDto, AuditQueryDto } from './audit.dto';

@ApiTags('Audit')
@ApiSecurity('ApiKeyAuth')
@Controller('agents/:agentId/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated audit log for an agent.' })
  list(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Query() query: AuditQueryDto,
  ): Promise<AuditLogResponseDto> {
    return this.audit.list(auth.principalId, agentId, query);
  }

  /**
   * NDJSON streaming export. Used for SOC2/FINRA evidence collection and
   * "give me the last 90 days" data-portability requests.
   *
   * Streams one event per line; auditors can pipe through `jq` or similar.
   * The chain signature on each row plus the public key at
   * `/.well-known/audit-signing-key` lets a third party verify integrity
   * without contacting AEGIS at audit-review time.
   *
   * Server-side TTL on the route is the request timeout; we paginate
   * internally in 1k-row chunks so memory use is bounded.
   */
  @Get('export.ndjson')
  @Header('Content-Type', 'application/x-ndjson')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Stream the audit log as newline-delimited JSON for offline review.' })
  @ApiProduces('application/x-ndjson')
  async exportNdjson(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Query() query: AuditQueryDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    // ndjson-v2 — canonical shape consumable by @aegis/audit-verifier without
    // remapping. v1 (legacy flat shape with `aegisSignature` at top level
    // and payload fields un-nested) was un-verifiable in practice because
    // the runtime kid was never stamped at append time, so JWKS lookups
    // always failed. No customer code could have been depending on v1
    // working with the public verifier.
    res.setHeader('X-AEGIS-Export-Format', 'ndjson-v2');

    for await (const row of this.audit.exportStream(auth.principalId, agentId, query)) {
      // Backpressure-aware write — wait for drain if the socket buffer fills.
      if (!res.write(`${JSON.stringify(row)}\n`)) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  }
}
