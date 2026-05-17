// RAR endpoint DTOs — wire shape for POST /v1/verify/rar/evaluate.
//
// Loose at the validator layer (IsArray + IsObject each element) because
// the rich shape is a discriminated union the evaluator handles. A bad
// shape returns a typed failure reason rather than a 400 — this matches
// the FAPI 2.0 introspection-style contract where the server tells the
// client *why* the authorization is denied, not just that it's malformed.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class RarCandidateInputDto {
  @ApiProperty({ description: 'RAR detail type identifier the candidate falls under.' })
  @IsString()
  @MaxLength(80)
  type!: string;

  @ApiProperty({ description: 'Action verb to authorize.' })
  @IsString()
  @MaxLength(80)
  action!: string;

  @ApiPropertyOptional({ description: 'USD amount for monetary candidates.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount_usd?: number;

  @ApiPropertyOptional({ description: 'ISO 4217 currency code (defaults to USD).' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ description: 'Quantity / unit count for non-monetary candidates.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  qty?: number;

  @ApiPropertyOptional({ description: 'Instrument identifier — match against trading_order.instruments.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instrument?: string;

  @ApiPropertyOptional({ description: 'Destination — match against payment_initiation.destinations.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string;

  @ApiPropertyOptional({ description: 'Resource URI — match against data_access.resources.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  resource?: string;

  @ApiPropertyOptional({ description: 'Whether the data being accessed is PII.' })
  @IsOptional()
  @IsBoolean()
  is_pii?: boolean;

  @ApiPropertyOptional({ description: 'Wall-clock timestamp of the action (ISO 8601). Used for trading_hours_only.' })
  @IsOptional()
  @IsDateString()
  at?: string;

  @ApiPropertyOptional({ description: 'Caller-supplied running total spent today for the day window the limits apply to. Omit if caller does not track day windows.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  spent_today_usd?: number;
}

export class RarEvaluateRequestDto {
  @ApiProperty({
    description:
      'RFC 9396 `authorization_details` array. Each element is one detail object; AEGIS evaluates the candidate against the FIRST element whose `type` matches `candidate.type` (multiple-detail OR-semantics is roadmap).',
  })
  @IsArray()
  @IsObject({ each: true })
  authorization_details!: Array<Record<string, unknown>>;

  @ApiProperty({
    description: 'Candidate action to authorize. Schema is type-dependent; see /docs/spec/05_FAPI_2_0_PROFILE for the per-type fields.',
  })
  @IsObject()
  candidate!: RarCandidateInputDto;
}

export class RarEvaluateResponseDto {
  @ApiProperty({ description: 'True iff at least one detail matched AND every constraint passed.' })
  ok!: boolean;

  @ApiPropertyOptional({
    description: 'When ok=true, names the detail type that matched.',
    nullable: true,
  })
  matched_detail_type?: string | null;

  @ApiPropertyOptional({
    description: 'When ok=false, typed denial reason from the RAR taxonomy.',
    nullable: true,
  })
  reason?: string | null;

  @ApiPropertyOptional({
    description: 'When ok=false, machine-parseable detail (e.g. "per_order_usd=50000 amount=50001").',
    nullable: true,
  })
  detail?: string | null;

  @ApiProperty({
    description: 'ISO 8601 timestamp of the evaluation. AEGIS-clocked.',
  })
  evaluated_at!: string;

  @ApiProperty({
    description: 'RFC 9396 binding version this evaluator implements.',
    example: 'aegis-rar-1.0',
  })
  binding_version!: string;
}
