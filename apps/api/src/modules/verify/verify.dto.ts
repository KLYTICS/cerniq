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
 * 11-step denial-precedence chain (AGENT_NOT_FOUND → … → INTENT_MISMATCH) and
 * is therefore NOT part of that chain (see CLAUDE.md § "Denial precedence").
 * Relying parties should handle it separately: it means the calling principal
 * has exhausted their plan's monthly verify quota and must upgrade.
 *
 * `TRIAL_EXHAUSTED` (added 2026-05-05 per ADR-0014) sits inside the chain
 * between SCOPE_NOT_GRANTED and SPEND_LIMIT_EXCEEDED. It fires when a
 * free-trial principal has used their lifetime 10K-verify cap.
 *
 * `INTENT_MISMATCH` (added 2026-05-15 per ADR-0016) sits at the end of the
 * chain. It fires when the agent's actual call deviates from a signed
 * intent manifest issued alongside the verify token, under STRICT or
 * breached-tolerance GRADUATED reconciliation. See @aegis/intent-manifest.
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
  | 'ANOMALY_FLAGGED'
  | 'INTENT_MISMATCH';          // ADR-0016: intent-bound attestation

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

  /**
   * RFC 6749 §5.2 — OAuth-canonical error code. Populated whenever
   * `denialReason` is set; null on approval. Mapped via the closed
   * table in `oauth-error-mapping.ts` (parity-tested). Lets buyers
   * with existing OAuth review playbooks handle AEGIS denials without
   * learning AEGIS-specific reason codes — the `denialReason` field
   * remains the source of truth for AEGIS-internal logic.
   */
  @ApiPropertyOptional({
    nullable: true,
    description: 'RFC 6749 §5.2 canonical error code. Set iff denialReason is set.',
    example: 'invalid_token',
  })
  error?: string | null;

  /**
   * RFC 6749 §5.2 — Human-readable description for the `error` value.
   * Public-safe wording; no internal jargon or stack details.
   */
  @ApiPropertyOptional({
    nullable: true,
    description: 'RFC 6749 §5.2 error_description. Set iff denialReason is set.',
    example: 'Agent signature failed verification.',
  })
  error_description?: string | null;

  /**
   * Public-safe denial discriminator. Round-10 addition: lets operators
   * + integrators differentiate the five INVALID_SIGNATURE rejection
   * conditions (signature / aud / iss / iat / replay) and the nine RAR
   * sub-reasons (action_unauthorized / limit_exceeded / etc.) without
   * growing the locked ADR-0004 denial-precedence enum (which would
   * require a 90-day customer notice + major version bump).
   *
   * Shape is intentionally minimal: `{ kind: '<closed-enum-value>' }`.
   * Specifics (expected aud, max-age threshold, etc.) are NOT carried
   * here — those flow to operator-side structured logs only. See
   * `docs/spec/05_FAPI_2_0_PROFILE.md` §2.6 for the threat-model split.
   *
   * Closed-enum values: see `DenialContextKind` in
   * `apps/api/src/modules/verify/algorithm/verify.ports.ts`. Stable
   * additive evolution applies — adding a kind is non-breaking;
   * removing or renaming requires a major version bump.
   */
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Public-safe denial discriminator. Set iff denialReason is set. ' +
      'See FAPI 2.0 profile §2.6 for threat model.',
    example: { kind: 'jar_aud_mismatch' },
  })
  denialContext?: { kind: string } | null;
}
