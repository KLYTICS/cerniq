import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum AgentRuntimeDto {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  GOOGLE = 'GOOGLE',
  HUGGINGFACE = 'HUGGINGFACE',
  CUSTOM = 'CUSTOM',
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
