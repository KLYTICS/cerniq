import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BateSignalType, SignalSeverity } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

import { Auth } from '../../common/decorators/auth.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedKey } from '../auth/api-key.service';

import { BateService } from './bate.service';

class ReportRequestDto {
  @ApiProperty({ enum: ['fraud_confirmed', 'anomaly', 'policy_violation', 'suspicious_behavior', 'false_positive'] })
  @IsString()
  eventType!: 'fraud_confirmed' | 'anomaly' | 'policy_violation' | 'suspicious_behavior' | 'false_positive';

  @ApiProperty({ enum: ['low', 'medium', 'high', 'critical'], required: false })
  @IsOptional()
  @IsEnum({ low: 'low', medium: 'medium', high: 'high', critical: 'critical' })
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionId?: string;

  @ApiProperty({ required: false, type: Object, additionalProperties: true })
  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;
}

const EVENT_TO_SIGNAL: Record<ReportRequestDto['eventType'], BateSignalType> = {
  fraud_confirmed: 'RELYING_PARTY_FRAUD_REPORT',
  anomaly: 'VELOCITY_ANOMALY',
  policy_violation: 'POLICY_VIOLATION_ATTEMPT',
  suspicious_behavior: 'SPEND_PATTERN_DEVIATION',
  false_positive: 'CLEAN_TRANSACTION',
};

const SEVERITY_MAP: Record<NonNullable<ReportRequestDto['severity']>, SignalSeverity> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  critical: 'CRITICAL',
};

@ApiTags('Reporting')
@Controller('agents/:agentId/report')
export class BateController {
  constructor(
    private readonly bate: BateService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary: 'Behavioral signal report — feeds BATE.',
    description:
      'Phase-1 authorization model: only the principal that *owns* the agent may file reports against it. ' +
      'This is the fail-closed default — it intentionally prevents cross-tenant fraud reports until the ' +
      'verified-relying-party path lands (M-019, see WORK_BOARD.md). Self-reports (e.g. false_positive) ' +
      'and internal monitoring still work.',
  })
  async report(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Body() dto: ReportRequestDto,
  ): Promise<{ accepted: true }> {
    // Multi-tenant isolation per CLAUDE.md invariant #5: principalId is the
    // first thing we check, every time. The audit (a38b6fd6) flagged this
    // endpoint as a cross-tenant score-manipulation vector — any API key
    // could drop any agent's score by -500 prior to this fix.
    const owns = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId: auth.principalId },
      select: { id: true },
    });
    if (!owns) {
      // 404, not 403 — leaks no information about whether the agent exists
      // under a different principal.
      throw new NotFoundException({
        error: 'AGENT_NOT_FOUND',
        message: 'Agent not found.',
      });
    }

    // Verify-only API keys must NEVER write BATE signals. Fail-closed.
    if (auth.scope === 'VERIFY_ONLY') {
      throw new ForbiddenException({
        error: 'WRONG_KEY_SCOPE',
        message: 'Verify-only keys cannot file behavioral reports.',
      });
    }

    await this.bate.ingestSignal({
      agentId,
      signalType: EVENT_TO_SIGNAL[dto.eventType],
      severity: SEVERITY_MAP[dto.severity ?? 'medium'],
      // Tag source as 'principal' for self-reports — distinguishes from
      // future verified-relying-party reports which will carry weight=1.0.
      // Self-reports default to weight=0.5 in the BATE scorer to prevent
      // a principal artificially boosting their own agent via false_positive
      // floods.
      source: `principal:${auth.principalId}`,
      payload: {
        eventType: dto.eventType,
        description: dto.description,
        transactionId: dto.transactionId,
        evidence: dto.evidence ?? null,
        reporterApiKeyId: auth.apiKeyId,
      },
    });
    return { accepted: true };
  }
}
