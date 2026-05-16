// Nest DTOs for the /v1/intent surface. class-validator decorated for
// Nest's ValidationPipe; runtime contract mirrors packages/intent-manifest
// type shapes + ADR-0017 §"API surface".
//
// Zod schemas in packages/types remain the wire-contract source of truth;
// these DTOs are the Nest representation that ingests + emits them.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// ────────────────────────────────────────────────────────────────────────
// Request shapes
// ────────────────────────────────────────────────────────────────────────

/** Loose runtime shape — Zod-narrow validation lives in @aegis/intent-manifest
 *  on the algorithm side. We pass intent through as a JSON record and the
 *  algorithm validates the discriminator at reconcile time. */
class IntentClaimDto {
  @ApiProperty({ enum: ['http-call', 'commerce-action', 'tool-invocation'] })
  @IsIn(['http-call', 'commerce-action', 'tool-invocation'])
  kind!: 'http-call' | 'commerce-action' | 'tool-invocation';

  @ApiProperty()
  @IsInt()
  @Min(1)
  maxCalls!: number;

  // Per-shape fields are pass-through; the algorithm + kernel validate.
  // Documenting them here would duplicate ADR-0016 D1 without enforcement
  // benefit (class-validator can't express discriminator-conditional
  // requireds cleanly).
  [key: string]: unknown;
}

class ReconciliationPolicyDto {
  @ApiProperty({ enum: ['strict', 'advisory', 'graduated'] })
  @IsIn(['strict', 'advisory', 'graduated'])
  strictness!: 'strict' | 'advisory' | 'graduated';

  @ApiPropertyOptional({ description: 'Only meaningful when strictness=graduated. Default 20.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  tolerance?: number;
}

export class IssueIntentRequestDto {
  @ApiProperty()
  @IsString()
  agentId!: string;

  @ApiProperty({ description: 'jti claim of the verify token this intent binds to.' })
  @IsString()
  verifyTokenJti!: string;

  @ApiProperty({ description: 'Base64URL SHA-256 of the verify token bytes.' })
  @IsString()
  verifyTokenSha256B64Url!: string;

  @ApiProperty({ type: IntentClaimDto })
  @ValidateNested()
  @Type(() => IntentClaimDto)
  intent!: IntentClaimDto;

  @ApiPropertyOptional({ type: ReconciliationPolicyDto, description: "Defaults to { strictness: 'strict' }." })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReconciliationPolicyDto)
  reconciliation?: ReconciliationPolicyDto;

  @ApiPropertyOptional({ description: 'Seconds. Clamped to [30, 60] in Phase 2.' })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(60)
  ttlSeconds?: number;
}

export class ActualCallObservationDto {
  @ApiProperty({ description: 'Unix epoch seconds when the actual was observed.' })
  @IsInt()
  observedAt!: number;

  @ApiProperty({ enum: ['http-call', 'commerce-action', 'tool-invocation'] })
  @IsIn(['http-call', 'commerce-action', 'tool-invocation'])
  kind!: 'http-call' | 'commerce-action' | 'tool-invocation';

  @ApiProperty({ description: 'Verifier-side payload — matches intent.kind shape.' })
  @IsObject()
  payload!: Record<string, unknown>;
}

export class ReconcileRequestDto {
  @ApiProperty({ type: [ActualCallObservationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActualCallObservationDto)
  actuals!: ActualCallObservationDto[];
}

// ────────────────────────────────────────────────────────────────────────
// Response shapes
// ────────────────────────────────────────────────────────────────────────

export class IssueIntentResponseDto {
  @ApiProperty()
  manifestId!: string;

  @ApiProperty({ description: 'Signed envelope — { body, signingKeyId, signatureB64Url }.' })
  signedManifest!: Record<string, unknown>;

  @ApiProperty({ description: 'Unix epoch seconds when the manifest expires.' })
  expiresAt!: number;
}

export class IntentMismatchDto {
  @ApiProperty()
  kind!: string;

  @ApiProperty()
  detail!: string;

  @ApiProperty()
  detectedAt!: number;
}

export class ReconcileResponseDto {
  @ApiProperty()
  manifestId!: string;

  @ApiProperty()
  actualCount!: number;

  @ApiProperty({ type: [IntentMismatchDto] })
  mismatches!: IntentMismatchDto[];

  @ApiProperty({ nullable: true, description: 'INTENT_MISMATCH on strict/breached-graduated; null on clean/advisory.' })
  recommendedDenialReason!: 'INTENT_MISMATCH' | null;

  @ApiPropertyOptional({ description: 'True if this call replayed an existing idempotency-key.' })
  idempotencyReplay?: boolean;
}

export class GetIntentResponseDto {
  @ApiProperty()
  manifest!: Record<string, unknown>;

  @ApiProperty({ type: [ActualCallObservationDto] })
  actuals!: ActualCallObservationDto[];

  @ApiProperty({ nullable: true, type: ReconcileResponseDto })
  reconciliation!: ReconcileResponseDto | null;

  @ApiProperty({ enum: ['OPEN', 'RECONCILED', 'EXPIRED'] })
  status!: 'OPEN' | 'RECONCILED' | 'EXPIRED';
}
