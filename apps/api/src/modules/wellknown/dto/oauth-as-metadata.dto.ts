// RFC 8414 — OAuth 2.0 Authorization Server Metadata
// + FAPI 2.0 §6.1 metadata extensions
//
// What AEGIS publishes at /.well-known/oauth-authorization-server:
// the RFC 8414 fields that are HONEST given AEGIS's role (an
// authorization-decision-and-audit-layer, not a full OAuth AS that
// issues authorization codes or access tokens). Empty arrays are valid
// per RFC 8414 §2 for fields whose flow AEGIS doesn't implement.
//
// AEGIS-specific extensions are namespaced under `aegis_*` per RFC 8414
// §2.4 "Additional metadata parameters."
//
// Authority: docs/spec/05_FAPI_2_0_PROFILE.md §2 — RFC-8414 binding.

import { ApiProperty } from '@nestjs/swagger';

export class OAuthAuthorizationServerMetadataDto {
  // ── RFC 8414 §2 required fields ─────────────────────────────────────

  @ApiProperty({
    description: 'RFC 8414 §2 — Authorization Server issuer identifier (URL).',
    example: 'https://api.aegis.klytics.io',
  })
  issuer!: string;

  @ApiProperty({
    description:
      'RFC 8414 §2 — Response types this AS supports. AEGIS publishes an empty array: it does NOT issue authorization codes or implicit tokens. AEGIS is an authorization-decision-and-audit-layer; consult `aegis_service_type`.',
    example: [],
  })
  response_types_supported!: string[];

  // ── RFC 8414 §2 recommended fields ──────────────────────────────────

  @ApiProperty({
    description: 'RFC 8414 §2 — JWKS endpoint URL. RFC 7517 / RFC 8037 Ed25519-in-JOSE.',
    example: 'https://api.aegis.klytics.io/.well-known/jwks.json',
  })
  jwks_uri!: string;

  @ApiProperty({
    description:
      'RFC 8414 §2 — Introspection endpoint URL. AEGIS\'s `/v1/verify` performs an introspection-shaped decision: relying party POSTs an agent-signed assertion, AEGIS returns ALLOW/DENY plus an audit trail.',
    example: 'https://api.aegis.klytics.io/v1/verify',
  })
  introspection_endpoint!: string;

  @ApiProperty({
    description: 'RFC 8414 §2 — Auth methods accepted at the introspection endpoint.',
    example: ['api_key_bearer'],
  })
  introspection_endpoint_auth_methods_supported!: string[];

  @ApiProperty({
    description: 'RFC 8414 §2 — JWS algs the introspection endpoint accepts on relying-party auth. AEGIS uses API keys (not signed JWTs) for relying-party auth; this is empty by design.',
    example: [],
  })
  introspection_endpoint_auth_signing_alg_values_supported!: string[];

  @ApiProperty({
    description: 'RFC 8414 §2 — Token endpoint auth methods (AEGIS does not issue OAuth tokens, but the field is canonical so a parser does not break).',
    example: [],
  })
  token_endpoint_auth_methods_supported!: string[];

  @ApiProperty({
    description: 'RFC 8414 §2 — JWS algs supported on signed responses (audit events, RAR receipts).',
    example: ['EdDSA'],
  })
  token_endpoint_auth_signing_alg_values_supported!: string[];

  @ApiProperty({
    description: 'RFC 8414 §2 — Documentation URL.',
    example: 'https://docs.aegis.klytics.io',
  })
  service_documentation!: string;

  @ApiProperty({
    description: 'RFC 8414 §2 — Operator privacy/security policy URL. Operator-overridable via AEGIS_OP_POLICY_URI.',
    example: 'https://aegis.klytics.io/security',
    required: false,
  })
  op_policy_uri?: string;

  @ApiProperty({
    description: 'RFC 8414 §2 — Operator terms-of-service URL. Operator-overridable via AEGIS_OP_TOS_URI.',
    example: 'https://aegis.klytics.io/terms',
    required: false,
  })
  op_tos_uri?: string;

  // ── FAPI 2.0 §6.1 extensions ────────────────────────────────────────

  @ApiProperty({
    description: 'FAPI 2.0 §6.1 — Registered RAR (RFC 9396) `authorization_details` types. Cross-checked against the evaluator in the cross-package binding parity spec.',
    example: ['trading_order', 'payment_initiation', 'data_access', 'agent_action'],
  })
  authorization_details_types_supported!: string[];

  @ApiProperty({
    description: 'FAPI 2.0 §6.1 — JWS algs accepted on inbound JAR request objects (RFC 9101). EdDSA today; JAR wire input is roadmap (Q3 2026 per FAPI profile §3.3).',
    example: ['EdDSA'],
  })
  request_object_signing_alg_values_supported!: string[];

  // ── AEGIS-specific extensions (RFC 8414 §2.4 namespaced) ────────────

  @ApiProperty({
    description: 'AEGIS-specific — Disambiguates AEGIS\'s role from a full OAuth Authorization Server. A buyer\'s tooling can branch on this when auto-configuring against AEGIS.',
    example: 'authorization-decision-and-audit-layer',
  })
  aegis_service_type!: string;

  @ApiProperty({
    description: 'AEGIS-specific — RAR evaluation endpoint. Live at this URL for inline `authorization_details[]` evaluation per RFC 9396.',
    example: 'https://api.aegis.klytics.io/v1/verify/rar/evaluate',
  })
  aegis_rar_evaluate_endpoint!: string;

  @ApiProperty({
    description: 'AEGIS-specific — Canonical AEGIS configuration discovery doc. Strict superset of this RFC 8414 view.',
    example: 'https://api.aegis.klytics.io/.well-known/aegis-configuration',
  })
  aegis_configuration_uri!: string;

  @ApiProperty({
    description: 'AEGIS-specific — FAPI profile binding identifier. See docs/spec/05_FAPI_2_0_PROFILE.md.',
    example: 'aegis-fapi-2.0-aligned-1.0',
  })
  aegis_fapi_profile!: string;
}
