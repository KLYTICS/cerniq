import { ApiProperty } from '@nestjs/swagger';

/**
 * AEGIS configuration discovery doc — the OIDC-style discovery
 * surface for agent-identity infrastructure. Lets a relying party
 * auto-configure their verifier from a single URL:
 *
 *     fetch('https://api.aegislabs.io/.well-known/aegis-configuration')
 *       .then(r => r.json())
 *
 * Stable, additive, versioned. Removing a field is a breaking change
 * and requires bumping `version` + 90-day customer notice.
 */
export class AegisConfigurationDto {
  @ApiProperty({
    description: 'The canonical issuer URL. Used by relying parties as `iss` for AEGIS-issued JWTs.',
    example: 'https://api.aegislabs.io',
  })
  issuer!: string;

  @ApiProperty({
    description: 'Discovery doc schema version. Bumped on breaking change to this shape.',
    example: '1.0.0',
  })
  spec_version!: string;

  @ApiProperty({
    description: 'AEGIS API version exposed at the issuer.',
    example: '0.1.0',
  })
  api_version!: string;

  @ApiProperty({
    description: 'Human documentation entry point.',
    example: 'https://docs.aegislabs.io',
  })
  documentation!: string;

  @ApiProperty({
    description: 'Machine-readable OpenAPI 3 spec (JSON).',
    example: 'https://api.aegislabs.io/docs-json',
  })
  openapi_spec!: string;

  @ApiProperty({
    description: 'Machine-readable JWKS for verifying audit chain signatures.',
    example: 'https://api.aegislabs.io/.well-known/jwks.json',
  })
  jwks_uri!: string;

  @ApiProperty({
    description: 'Plain JSON helper view of the active audit signing key.',
    example: 'https://api.aegislabs.io/.well-known/audit-signing-key',
  })
  audit_signing_key_uri!: string;

  @ApiProperty({
    description: 'Endpoint map. Relying parties POST to `verify`; management UIs POST to `agent_register`, etc.',
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
    description: 'Signature algorithms AEGIS uses for audit signing and policy issuance.',
    example: ['EdDSA'],
  })
  supported_algorithms!: string[];

  @ApiProperty({
    description: 'Elliptic curves supported. AEGIS is Ed25519-only per ADR-0002.',
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
    description: 'Runtimes the @aegis/sdk and @aegis/verifier-rp packages support.',
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
    description: 'Deployment region (informational; deduce data-residency posture from this + retention-policy.json).',
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
    example: 'https://api.aegislabs.io/.well-known/security.txt',
  })
  security_txt!: string;

  @ApiProperty({
    description: 'AI-agent-readable site description (emerging llms.txt convention).',
    example: 'https://api.aegislabs.io/.well-known/llms.txt',
  })
  llms_txt!: string;

  @ApiProperty({
    description:
      'Per-tier audit retention windows + redaction guarantees. Body is auto-derived from billing/plans.ts.',
    example: 'https://api.aegislabs.io/.well-known/retention-policy.json',
  })
  retention_policy_uri!: string;

  @ApiProperty({
    description:
      'Per-tier pricing table (ADR-0014). Body is auto-derived from billing/plans.ts.',
    example: 'https://api.aegislabs.io/.well-known/pricing.json',
  })
  pricing_uri!: string;

  // ─────────────────────────────────────────────────────────────────────
  // FAPI-2.0-aligned discoverable metadata (added 1.1.0, additive only).
  //
  // These fields let a relying party / buyer auto-verify which financial-
  // grade standards AEGIS bindingly implements vs. is positionally aligned
  // with. The split between "implemented" and "aligned" is deliberate and
  // honest — claiming FAPI 2.0 Advanced when JAR input isn't yet wired
  // would set buyer expectations we can't meet.
  //
  // Authority for the binding contract: docs/spec/05_FAPI_2_0_PROFILE.md.
  // ─────────────────────────────────────────────────────────────────────

  @ApiProperty({
    description:
      'IANA-style identifier for the AEGIS FAPI profile. Names the specific binding of FAPI 2.0 concepts to AEGIS primitives. Authority: docs/spec/05_FAPI_2_0_PROFILE.md.',
    example: 'aegis-fapi-2.0-aligned-1.0',
  })
  fapi_profile!: string;

  @ApiProperty({
    description:
      'In-repo binding spec for AEGIS ↔ FAPI 2.0 + adjacent RFCs. The authoritative contract any AEGIS-compliant implementation conforms to.',
    example: 'https://docs.aegislabs.io/spec/05_FAPI_2_0_PROFILE',
  })
  fapi_profile_spec_uri!: string;

  @ApiProperty({
    description:
      'Standards AEGIS bindingly implements today — every entry is a citable claim a buyer can verify against the running code or its tests.',
    example: ['RFC-8032', 'RFC-7517', 'RFC-9116'],
  })
  standards_implemented!: string[];

  @ApiProperty({
    description:
      'Standards AEGIS is positionally aligned with but NOT YET bindingly compliant — the discovery shape mirrors them, but a wire-level contract test would fail. Roadmap detailed in fapi_profile_spec_uri.',
    example: ['RFC-6749', 'RFC-8414', 'RFC-9396', 'RFC-9101', 'RFC-9449', 'RFC-9421'],
  })
  standards_aligned!: string[];

  @ApiProperty({
    description:
      'JWS signing algorithms AEGIS uses for its OWN outputs (audit events, signed receipts). FAPI 2.0 §6.1 field name preserved for ecosystem familiarity. EdDSA = Ed25519 per RFC 8037 §3.1.',
    example: ['EdDSA'],
  })
  signing_alg_values_supported!: string[];

  @ApiProperty({
    description:
      'JWS signing algorithms AEGIS accepts on INBOUND agent signatures. Today this is over canonical-JSON envelopes; JAR (RFC 9101) JWT input via the same algorithms is on the Q3 2026 roadmap and gated behind the same EdDSA set.',
    example: ['EdDSA'],
  })
  agent_signing_alg_values_supported!: string[];

  @ApiProperty({
    description:
      'Agent authentication method identifiers. Today AEGIS uses a bespoke canonical-JSON envelope (`ed25519_canonical_json`); FAPI 2.0 `private_key_jwt` (RFC 7523) over the same Ed25519 keypair is the planned standards-equivalent path.',
    example: ['ed25519_canonical_json'],
  })
  agent_authentication_methods_supported!: string[];

  @ApiProperty({
    description:
      'Registered RAR (RFC 9396) `authorization_details` types. A FAPI client can statically check this list before submitting an authorization_details array to /v1/verify/rar/evaluate. New types are additive and require operator review.',
    example: ['trading_order', 'payment_initiation', 'data_access', 'agent_action'],
  })
  authorization_details_types_supported!: string[];

  @ApiProperty({
    description:
      'Operator privacy / security policy URL. RFC 8414 § `op_policy_uri`. Operator-overridable via AEGIS_OP_POLICY_URI env.',
    example: 'https://aegis.klytics.io/security',
    required: false,
  })
  op_policy_uri?: string;

  @ApiProperty({
    description:
      'Operator terms-of-service URL. RFC 8414 § `op_tos_uri`. Operator-overridable via AEGIS_OP_TOS_URI env.',
    example: 'https://aegis.klytics.io/terms',
    required: false,
  })
  op_tos_uri?: string;
}
