import { FIAT_CURRENCIES, STABLECOIN_CURRENCIES, type Currency } from '@cerniq/types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
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

// Currency accepted set is sourced from `@cerniq/types` Currency union
// (9 fiat + 4 stablecoin = 13 codes). Previously this DTO hard-coded
// USD/EUR/GBP only via a local `ScopeCurrency` enum, which rejected
// valid wire requests (e.g. `currency: "AUD"`) at class-validator
// before the request ever reached the service — a real contract-drift
// bug surfaced by swarm-2 type-design-analyzer 2026-05-27.
//
// Frozen tuple is the union of FIAT + STABLECOIN; `as const` preserves
// literal-type narrowing for the `Currency` cast in IsIn's type param.
const ALL_CURRENCIES = [...FIAT_CURRENCIES, ...STABLECOIN_CURRENCIES] as const;

export class SpendLimitDto {
  @ApiProperty({ enum: ALL_CURRENCIES, example: 'USD' })
  @IsIn(ALL_CURRENCIES as readonly string[])
  currency!: Currency;

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

  @ApiProperty({ description: 'CERNIQ-signed JWT carrying policy claims.' })
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
