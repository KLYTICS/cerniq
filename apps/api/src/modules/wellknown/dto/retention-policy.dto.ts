import { ApiProperty } from '@nestjs/swagger';

/**
 * `/.well-known/retention-policy.json` — public, no-auth view of the
 * per-tier audit retention windows derived from
 * `apps/api/src/modules/billing/plans.ts`.
 *
 * This is part of the I-9.5 discovery surface: stable, additive-only
 * within a major `spec_version`. Removing or renaming a key is a
 * breaking change requiring an ADR + 90-day notice (mirrors the
 * CerniqConfigurationDto contract).
 *
 * The body is computed in-process from `getPlan(tier)` for every
 * `PlanTier` enum value. The endpoint never hits the database.
 */
export class RetentionPolicyTierDto {
  @ApiProperty({
    description:
      'Audit log retention window in days for this tier. Mirrors PlanDefinition.auditRetentionDays.',
    example: 30,
  })
  audit_retention_days!: number;

  @ApiProperty({
    description:
      'How CERNIQ enforces retention — redactions preserve audit chain hashes; events are never deleted.',
    example: 'redact-not-delete',
  })
  redaction_method!: 'redact-not-delete';

  @ApiProperty({
    description: 'Format string emitted as the `reason` field on the redaction meta-event.',
    example: 'retention_policy:plan=FREE:days=30',
  })
  redaction_reason_format!: string;
}

export class RetentionPolicyOperationalDto {
  @ApiProperty({
    description:
      'How often the retention worker scans for events past their retention window. Default 86400 (1 day).',
    example: 86400,
  })
  retention_run_interval_seconds!: number;

  @ApiProperty({
    description: 'Env var operators can set to override the worker interval (in milliseconds).',
    example: 'CERNIQ_AUDIT_RETENTION_INTERVAL_MS',
  })
  configurable_via_env!: string;
}

export class RetentionPolicyDto {
  @ApiProperty({
    description: 'Doc schema version. Bumped on breaking change to this shape.',
    example: '1.0.0',
  })
  spec_version!: string;

  @ApiProperty({
    description:
      'ISO-8601 generation timestamp. Captured per request — informational, not a cache validator.',
    example: '2026-05-05T12:34:56.789Z',
  })
  generated_at!: string;

  @ApiProperty({
    description:
      'Per-tier retention configuration. Keys are the canonical PlanTier enum values (FREE, DEVELOPER, GROWTH, ENTERPRISE).',
    type: () => RetentionPolicyTierDto,
    isArray: false,
  })
  tiers!: Record<string, RetentionPolicyTierDto>;

  @ApiProperty({
    description:
      'Human-readable guarantees CERNIQ makes about retention enforcement and chain integrity.',
    example: [
      'Redactions preserve audit chain hashes — chain remains verifiable post-redaction.',
      'Each redaction emits a meta-event in the chain (audit-of-audit).',
      'Public keys (.well-known/audit-signing-key) are never redacted.',
    ],
  })
  guarantees!: string[];

  @ApiProperty({
    description: 'Operational defaults for the retention worker.',
    type: () => RetentionPolicyOperationalDto,
  })
  operational!: RetentionPolicyOperationalDto;
}
