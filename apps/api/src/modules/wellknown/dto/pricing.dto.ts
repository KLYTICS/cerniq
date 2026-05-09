import { ApiProperty } from '@nestjs/swagger';

/**
 * `/.well-known/pricing.json` — public, no-auth view of the ADR-0014 tier
 * table derived from `apps/api/src/modules/billing/plans.ts`.
 *
 * Part of the I-9.5 discovery surface alongside `retention-policy.json`.
 * Stable, additive-only within a major `spec_version`. Removing or
 * renaming a key is a breaking change requiring an ADR + 90-day notice.
 *
 * The body is computed in-process from `getPlan(tier)` for every
 * `PlanTier` enum value. The endpoint never hits the database.
 *
 * JSON-shape special cases:
 *   - `monthly_price_cents: null` for ENTERPRISE (custom pricing).
 *   - `monthly_verify_quota: null` when `plans.ts` uses
 *     `Number.POSITIVE_INFINITY` (FREE post-Round-19 + ENTERPRISE).
 *     JSON has no native Infinity so we encode it as `null`.
 *   - `lifetime_verify_quota: 10000` for FREE (`TRIAL_LIFETIME_CAP`),
 *     `null` for all paid tiers.
 *   - `overage_per_call_e4` exposes the raw E4 value (ten-thousandths
 *     of a dollar); `null` for hard-stop tiers (FREE, ENTERPRISE).
 */
export class PricingTierDto {
  @ApiProperty({ description: 'Stable tier id (matches PlanTier enum).', example: 'DEVELOPER' })
  tier!: string;

  @ApiProperty({ description: 'Customer-facing display name.', example: 'Developer' })
  display_name!: string;

  @ApiProperty({
    description: 'Monthly base price in USD cents. `null` for custom (Enterprise).',
    example: 4900,
    nullable: true,
  })
  monthly_price_cents!: number | null;

  @ApiProperty({
    description:
      'Monthly verify quota. `null` when the underlying plan uses an unbounded sentinel (FREE uses a lifetime cap; Enterprise is uncapped).',
    example: 50000,
    nullable: true,
  })
  monthly_verify_quota!: number | null;

  @ApiProperty({
    description: 'Lifetime verify cap (FREE only — ADR-0014 `TRIAL_LIFETIME_CAP`). `null` for paid tiers.',
    example: 10000,
    nullable: true,
  })
  lifetime_verify_quota!: number | null;

  @ApiProperty({
    description:
      'Per-call overage rate in USD × 10⁻⁴ (ten-thousandths of a dollar). `8` = $0.0008/verify. `null` = hard-stop tier.',
    example: 8,
    nullable: true,
  })
  overage_per_call_e4!: number | null;

  @ApiProperty({
    description: 'Maximum concurrently-registered agents. `null` when unbounded (Enterprise).',
    example: 10,
    nullable: true,
  })
  agent_cap!: number | null;

  @ApiProperty({ description: 'Audit log retention window in days.', example: 90 })
  audit_retention_days!: number;

  @ApiProperty({ description: 'Whether BATE trust scores are exposed for this tier.', example: true })
  bate_access!: boolean;

  @ApiProperty({ description: 'Whether webhook subscriptions are available.', example: true })
  webhooks!: boolean;

  @ApiProperty({ description: 'Informational p99 verify latency target (ms).', example: 200 })
  verify_p99_target_ms!: number;
}

export class PricingBillingEndpointsDto {
  @ApiProperty({ example: '/v1/billing/checkout' })
  checkout!: string;

  @ApiProperty({ example: '/v1/billing/portal' })
  portal!: string;

  @ApiProperty({ example: '/v1/billing/plan' })
  plan!: string;
}

export class PricingDto {
  @ApiProperty({ description: 'Doc schema version. Bumped on breaking change to this shape.', example: '1.0.0' })
  spec_version!: string;

  @ApiProperty({
    description: 'ISO-8601 generation timestamp. Captured per request — informational, not a cache validator.',
    example: '2026-05-06T00:00:00.000Z',
  })
  generated_at!: string;

  @ApiProperty({
    description:
      'ISO-4217 currency code. Hardcoded to USD; operator may localize via env in a future spec_version.',
    example: 'USD',
  })
  currency!: string;

  @ApiProperty({
    description:
      'Per-tier pricing definition. Keys are canonical PlanTier enum values (FREE, DEVELOPER, GROWTH, ENTERPRISE).',
    type: () => PricingTierDto,
    isArray: false,
  })
  tiers!: Record<string, PricingTierDto>;

  @ApiProperty({
    description: 'Plain-English unit explanation for `overage_per_call_e4`.',
    example: 'USD × 10⁻⁴ (i.e. ten-thousandths of a dollar)',
  })
  currency_overage_unit!: string;

  @ApiProperty({ description: 'ADR that locks this tier table.', example: 'ADR-0014' })
  adr!: string;

  @ApiProperty({
    description: 'Authenticated billing endpoints (relative paths under the issuer).',
    type: () => PricingBillingEndpointsDto,
  })
  billing_endpoints!: PricingBillingEndpointsDto;
}
