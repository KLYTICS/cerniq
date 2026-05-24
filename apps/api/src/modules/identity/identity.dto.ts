import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum AgentRuntimeDto {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  GOOGLE = 'GOOGLE',
  HUGGINGFACE = 'HUGGINGFACE',
  CUSTOM = 'CUSTOM',
}

export class RevokeAgentDto {
  @ApiPropertyOptional({
    description: 'Free-form operator-supplied reason captured for the audit trail.',
    example: 'Compromised key',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RegisterAgentDto {
  @ApiProperty({ description: 'Ed25519 public key, base64url encoded.' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  publicKey!: string;

  @ApiProperty({ enum: AgentRuntimeDto })
  @IsEnum(AgentRuntimeDto)
  runtime!: AgentRuntimeDto;

  @ApiPropertyOptional({ example: 'claude-sonnet-4-5' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({ example: 'Shopping agent for alice@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class AgentResponseDto {
  @ApiProperty()
  agentId!: string;

  @ApiProperty()
  publicKey!: string;

  @ApiProperty()
  principalId!: string;

  @ApiProperty({ enum: AgentRuntimeDto })
  runtime!: AgentRuntimeDto;

  @ApiPropertyOptional()
  model?: string | null;

  @ApiPropertyOptional()
  label?: string | null;

  @ApiProperty({ enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED'] })
  status!: string;

  @ApiProperty()
  trustScore!: number;

  @ApiProperty({ enum: ['PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED'] })
  trustBand!: string;

  @ApiProperty()
  registeredAt!: string;

  @ApiPropertyOptional()
  lastSeenAt?: string | null;
}

export enum AgentStatusFilter {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REVOKED = 'REVOKED',
}

export class ListAgentsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor (agent id of the last item in previous page).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({ enum: AgentStatusFilter })
  @IsOptional()
  @IsEnum(AgentStatusFilter)
  status?: AgentStatusFilter;

  @ApiPropertyOptional({ enum: AgentRuntimeDto })
  @IsOptional()
  @IsEnum(AgentRuntimeDto)
  runtime?: AgentRuntimeDto;

  @ApiPropertyOptional({ description: 'Substring match on id, label, or model.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AgentListResponseDto {
  @ApiProperty({ type: () => [AgentResponseDto] })
  agents!: AgentResponseDto[];

  @ApiPropertyOptional({ description: 'Cursor for the next page; null when no more rows.' })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Total agents owned by this principal (across all pages).' })
  total!: number;
}

// ── Handshake (M-003 — proof-of-possession) ────────────────────────────────

export class IssueChallengeRequestDto {
  // Body intentionally empty — challenge issuance only takes the agentId
  // from the URL path. Kept as a class so future protocol versions can add
  // optional client-supplied entropy without a breaking change.
}

export class HandshakeChallengeDto {
  @ApiProperty({ description: 'The agent the challenge was issued for.' })
  agentId!: string;

  @ApiProperty({
    description:
      'Cryptographically-random 256-bit nonce, base64url-encoded. Single-use, 5 min TTL.',
  })
  challenge!: string;

  @ApiProperty({ description: 'Seconds until the challenge becomes invalid.' })
  expiresIn!: number;

  @ApiProperty({
    description: 'Domain-separator + protocol version. Bumping requires SDK coordination.',
    example: 'cerniq-handshake-v1',
  })
  protocolVersion!: string;

  @ApiProperty({
    description:
      'The exact UTF-8 string the SDK must Ed25519-sign with the agent private key. Format: "<protocolVersion>::<agentId>::<challenge>".',
  })
  message!: string;
}

export class VerifyHandshakeDto {
  @ApiProperty({
    description: 'Ed25519 signature over the handshake message, base64url-encoded (64 raw bytes).',
  })
  @IsString()
  @MinLength(80)
  @MaxLength(120)
  signature!: string;
}

export class HandshakeStatusDto {
  @ApiProperty()
  agentId!: string;

  @ApiProperty({
    description: 'true once the agent has proven private-key possession via /verify-handshake.',
  })
  verified!: boolean;

  @ApiPropertyOptional({ description: 'Server clock at the most recent successful handshake.' })
  verifiedAt?: string;

  @ApiPropertyOptional({ description: 'Protocol version of the recorded handshake.' })
  protocolVersion?: string;
}

export class HandshakeVerifiedDto {
  @ApiProperty()
  agentId!: string;

  @ApiProperty({ description: 'When the handshake record was created (server clock).' })
  verifiedAt!: string;

  @ApiProperty()
  protocolVersion!: string;

  @ApiProperty({
    description:
      'Trust score after the handshake. Successful proof-of-possession lifts to at least 600 (the cold-start acceptance threshold).',
  })
  trustScore!: number;

  @ApiProperty({ description: 'Seconds the handshake record is retained in cache.' })
  recordTtlSeconds!: number;
}

export class AgentStatusDto {
  @ApiProperty()
  agentId!: string;

  @ApiProperty({ enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED'] })
  status!: string;

  @ApiProperty()
  trustScore!: number;

  @ApiProperty({ enum: ['PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED'] })
  trustBand!: string;

  @ApiPropertyOptional()
  lastSeenAt?: string | null;
}
