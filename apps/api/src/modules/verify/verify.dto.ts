import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class VerifyRequestDto {
  @ApiProperty({ description: 'Agent-signed JWT.' })
  @IsString()
  @MaxLength(2048)
  token!: string;

  @ApiPropertyOptional({ example: 'commerce.purchase' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ example: 347.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: 'delta-airlines' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchantId?: string;

  @ApiPropertyOptional({ example: 'delta.com' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  merchantDomain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Per-call minimum trust score the relying party requires.', minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minTrustScore?: number;
}

/**
 * Denial reasons returned by /v1/verify.
 *
 * `PLAN_LIMIT_EXCEEDED` is a pre-algorithm billing gate — it fires before the
 * 10-step denial-precedence chain (AGENT_NOT_FOUND → … → ANOMALY_FLAGGED) and
 * is therefore NOT part of that chain (see CLAUDE.md § "Denial precedence").
 * Relying parties should handle it separately: it means the calling principal
 * has exhausted their plan's monthly verify quota and must upgrade.
 *
 * `TRIAL_EXHAUSTED` (added 2026-05-05 per ADR-0014) sits inside the chain
 * between SCOPE_NOT_GRANTED and SPEND_LIMIT_EXCEEDED. It fires when a
 * free-trial principal has used their lifetime 10K-verify cap.
 */
export type DenialReason =
  | 'PLAN_LIMIT_EXCEEDED'       // billing gate — fires before algorithm
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_REVOKED'
  | 'POLICY_EXPIRED'
  | 'SCOPE_NOT_GRANTED'
  | 'TRIAL_EXHAUSTED'           // ADR-0014: free-trial lifetime cap
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED';

export class VerifyResponseDto {
  @ApiProperty()
  valid!: boolean;

  @ApiProperty({ nullable: true })
  agentId!: string | null;

  @ApiProperty({ nullable: true })
  principalId!: string | null;

  @ApiProperty({ minimum: 0, maximum: 1000 })
  trustScore!: number;

  @ApiProperty({ enum: ['PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED'], nullable: true })
  trustBand!: string | null;

  @ApiProperty({ type: [String] })
  scopesGranted!: string[];

  @ApiPropertyOptional({ nullable: true })
  denialReason?: DenialReason | null;

  @ApiProperty()
  verifiedAt!: string;

  @ApiProperty({ description: 'Seconds the relying party may cache this result.' })
  ttl!: number;

  @ApiProperty({ nullable: true, description: 'ID of the audit row this decision generated. Use it to reference the decision in support tickets.' })
  auditEventId!: string | null;
}
