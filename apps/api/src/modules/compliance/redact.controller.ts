import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RedactService } from './redact.service';
import type {
  RedactAuditByAgentDto,
  RedactAuditByAgentResultDto,
  RedactAuditEventDto,
  RedactAuditEventResultDto,
} from './redact.dto';

/**
 * GDPR Art. 17 surface.
 *
 *   POST /v1/compliance/audit/redact-event   — redact one event
 *   POST /v1/compliance/audit/redact-by-agent — redact every event for an agent
 *
 * Both require ApiKeyGuard. Per-principal isolation enforced inside the
 * service via the WHERE clause. The chain remains tamper-evident: a
 * redacted row still verifies because the signature commits to hashes,
 * not raw values (ADR-0006).
 */
@Controller('compliance/audit')
export class RedactController {
  constructor(private readonly redact: RedactService) {}

  @Post('redact-event')
  @HttpCode(200)
  async redactEvent(
    @Req() req: Request,
    @Body() dto: RedactAuditEventDto,
  ): Promise<RedactAuditEventResultDto> {
    const principalId = (req as unknown as { principalId?: string }).principalId;
    if (!principalId) throw new Error('principal_missing');
    return this.redact.redactEvent(principalId, dto);
  }

  @Post('redact-by-agent')
  @HttpCode(200)
  async redactByAgent(
    @Req() req: Request,
    @Body() dto: RedactAuditByAgentDto,
  ): Promise<RedactAuditByAgentResultDto> {
    const principalId = (req as unknown as { principalId?: string }).principalId;
    if (!principalId) throw new Error('principal_missing');
    return this.redact.redactByAgent(principalId, dto);
  }
}
