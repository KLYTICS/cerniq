import { ApiProperty } from '@nestjs/swagger';

/**
 * CERNIQ configuration discovery doc — the OIDC-style discovery
 * surface for agent-identity infrastructure. Lets a relying party
 * auto-configure their verifier from a single URL:
 *
 *     fetch('https://api.cerniqapp.com/.well-known/cerniq-configuration')
 *       .then(r => r.json())
 *
 * Stable, additive, versioned. Removing a field is a breaking change
 * and requires bumping `version` + 90-day customer notice.
 */
export class CerniqConfigurationDto {
  @ApiProperty({
    description:
      'The canonical issuer URL. Used by relying parties as `iss` for CERNIQ-issued JWTs.',
    example: 'https://api.cerniqapp.com',
  })
  issuer!: string;

  @ApiProperty({
    description: 'Discovery doc schema version. Bumped on breaking change to this shape.',
    example: '1.0.0',
  })
  spec_version!: string;

  @ApiProperty({
    description: 'CERNIQ API version exposed at the issuer.',
    example: '0.1.0',
  })
  api_version!: string;

  @ApiProperty({
    description: 'Human documentation entry point.',
    example: 'https://docs.cerniqapp.com',
  })
  documentation!: string;

  @ApiProperty({
    description: 'Machine-readable OpenAPI 3 spec (JSON).',
    example: 'https://api.cerniqapp.com/docs-json',
  })
  openapi_spec!: string;

  @ApiProperty({
    description: 'Machine-readable JWKS for verifying audit chain signatures.',
    example: 'https://api.cerniqapp.com/.well-known/jwks.json',
  })
  jwks_uri!: string;

  @ApiProperty({
    description: 'Plain JSON helper view of the active audit signing key.',
    example: 'https://api.cerniqapp.com/.well-known/audit-signing-key',
  })
  audit_signing_key_uri!: string;

  @ApiProperty({
    description:
      'Endpoint map. Relying parties POST to `verify`; management UIs POST to `agent_register`, etc.',
  })
  endpoints!: {
    verify: string;
    agent_register: string;
    agent_status: string;
    policy_create: string;
    audit_export_per_agent: string;
    audit_export_tenant: string;
    webhook_subscribe: string;
    billing_checkout: string;
    billing_webhook: string;
    health_live: string;
    health_ready: string;
    health_version: string;
  };

  @ApiProperty({
    description: 'Signature algorithms CERNIQ uses for audit signing and policy issuance.',
    example: ['EdDSA'],
  })
  supported_algorithms!: string[];

  @ApiProperty({
    description: 'Elliptic curves supported. CERNIQ is Ed25519-only per ADR-0002.',
    example: ['Ed25519'],
  })
  supported_curves!: string[];

  @ApiProperty({
    description:
      'Canonical denial-precedence order, top wins. Locked by ADR-0004; reorder requires API version bump + 90-day notice.',
    example: [
      'AGENT_NOT_FOUND',
      'AGENT_REVOKED',
      'INVALID_SIGNATURE',
      'POLICY_REVOKED',
      'POLICY_EXPIRED',
      'SCOPE_NOT_GRANTED',
      'SPEND_LIMIT_EXCEEDED',
      'TRUST_SCORE_TOO_LOW',
      'ANOMALY_FLAGGED',
    ],
  })
  denial_reasons!: string[];

  @ApiProperty({
    description: 'BATE trust band ladder (low → high).',
    example: ['FLAGGED', 'WATCH', 'VERIFIED', 'PLATINUM'],
  })
  trust_bands!: string[];

  @ApiProperty({
    description: 'Per-route rate limits (requests/minute). Operator may tighten in production.',
  })
  rate_limits!: {
    verify_per_min: number;
    default_per_min: number;
  };

  @ApiProperty({
    description: 'Runtimes the @cerniq/sdk and @cerniq/verifier-rp packages support.',
    example: ['nodejs', 'cloudflare-workers', 'vercel-edge', 'deno', 'bun', 'browser'],
  })
  supported_runtimes!: string[];

  @ApiProperty({
    description: 'Official SDK package names — pin these in your dependency manager.',
  })
  sdks!: {
    typescript: string;
    python: string;
    verifier_rp: string;
    mcp_bridge: string;
    mcp_server: string;
    cli: string;
  };

  @ApiProperty({
    description:
      'Deployment region (informational; deduce data-residency posture from this + retention-policy.json).',
    example: 'us-east-1',
    required: false,
  })
  region?: string;

  @ApiProperty({
    description: 'Build identity for blue-green confirmation. Mirrors GET /health/version.',
  })
  build!: {
    version: string;
    git_sha: string;
    built_at: string;
  };

  @ApiProperty({
    description: 'Plain-text security disclosure file (RFC 9116).',
    example: 'https://api.cerniqapp.com/.well-known/security.txt',
  })
  security_txt!: string;

  @ApiProperty({
    description: 'AI-agent-readable site description (emerging llms.txt convention).',
    example: 'https://api.cerniqapp.com/.well-known/llms.txt',
  })
  llms_txt!: string;

  @ApiProperty({
    description:
      'Per-tier audit retention windows + redaction guarantees. Body is auto-derived from billing/plans.ts.',
    example: 'https://api.cerniqapp.com/.well-known/retention-policy.json',
  })
  retention_policy_uri!: string;

  @ApiProperty({
    description: 'Per-tier pricing table (ADR-0014). Body is auto-derived from billing/plans.ts.',
    example: 'https://api.cerniqapp.com/.well-known/pricing.json',
  })
  pricing_uri!: string;
}
