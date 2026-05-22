import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ScopeCategory {
  COMMERCE = 'commerce',
  DATA_READ = 'data-read',
  DATA_WRITE = 'data-write',
  COMMUNICATION = 'communication',
  SCHEDULING = 'scheduling',
}

export enum ScopeCurrency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

export class SpendLimitDto {
  @ApiProperty({ enum: ScopeCurrency })
  @IsEnum(ScopeCurrency)
  currency!: ScopeCurrency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPerTransaction?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPerDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPerMonth?: number;
}

export class PolicyScopeDto {
  @ApiProperty({ enum: ScopeCategory })
  @IsEnum(ScopeCategory)
  category!: ScopeCategory;

  @ApiPropertyOptional({ type: () => SpendLimitDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SpendLimitDto)
  spendLimit?: SpendLimitDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  merchantCategories?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  allowedDomains?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  dataScopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

export class CreatePolicyDto {
  @ApiPropertyOptional({ example: 'Buy flights under $500' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiProperty({ type: [PolicyScopeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PolicyScopeDto)
  scopes!: PolicyScopeDto[];

  @ApiProperty({ description: 'ISO-8601 expiration timestamp.' })
  @IsDateString()
  expiresAt!: string;
}

export class CreatePolicyResponseDto {
  @ApiProperty()
  policyId!: string;

  @ApiProperty({ description: 'OKORO-signed JWT carrying policy claims.' })
  signedToken!: string;

  @ApiProperty()
  expiresAt!: string;
}

export class PolicyResponseDto {
  @ApiProperty()
  policyId!: string;

  @ApiProperty()
  agentId!: string;

  @ApiPropertyOptional()
  label?: string | null;

  @ApiProperty({ type: [PolicyScopeDto] })
  scopes!: PolicyScopeDto[];

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'REVOKED'] })
  status!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  expiresAt!: string;
}
