import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * Query params for `GET /v1/audit-events` (principal-wide audit list).
 * Extends `AuditQueryDto` with the `stripeEventId` filter so operators
 * can reconcile a Stripe activity item to the matching audit row(s)
 * without fanning out across agents.
 */
export class AuditEventsQueryDto extends AuditQueryDto {
  @ApiPropertyOptional({
    description:
      "Filter to audit events whose `policySnapshot.stripeEventId` equals the given Stripe event id (e.g. 'evt_1Q8…'). " +
      'Used for forensic reconciliation between Stripe activity and the AEGIS audit chain. Postgres-only — relies on a JSON path filter.',
  })
  @IsOptional()
  @IsString()
  stripeEventId?: string;
}

export class AuditEventDto {
  @ApiProperty()
  eventId!: string;

  @ApiProperty({ nullable: true, description: 'Real agent FK; null when the verify call denied with AGENT_NOT_FOUND.' })
  agentId!: string | null;

  @ApiProperty({ nullable: true, description: 'Agent ID exactly as it was claimed in the verify request.' })
  claimedAgentId?: string | null;

  @ApiProperty()
  principalId!: string;

  @ApiProperty()
  timestamp!: string;

  @ApiProperty({ nullable: true, description: 'Null after Art. 17 redaction; verify integrity via actionHash.' })
  action!: string | null;

  @ApiProperty({ description: 'base64url(sha256(action)) — committed to in the signed chain payload.' })
  actionHash!: string;

  @ApiPropertyOptional()
  relyingParty?: string | null;

  @ApiProperty({ enum: ['APPROVED', 'DENIED', 'FLAGGED'] })
  decision!: string;

  @ApiPropertyOptional()
  decisionReason?: string | null;

  @ApiProperty()
  trustScoreAtEvent!: number;

  @ApiProperty()
  signature!: string;
}

export class AuditLogResponseDto {
  @ApiProperty({ type: [AuditEventDto] })
  events!: AuditEventDto[];

  @ApiPropertyOptional()
  nextCursor?: string | null;

  @ApiProperty()
  count!: number;
}
