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

export type DenialReason =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_EXPIRED'
  | 'POLICY_REVOKED'
  | 'SCOPE_NOT_GRANTED'
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
