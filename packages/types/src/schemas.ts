// Zod schemas — the single source of truth for CERNIQ request/response shapes.
//
// These mirror docs/spec/CERNIQ_API_SPEC.yaml. When the OpenAPI spec changes,
// update here first; both the API DTOs and the SDK derive from these.
//
// Why Zod over plain TS interfaces: it gives us runtime validation in the
// SDK (catch developer errors before the wire) and in any non-NestJS
// surface (e.g. the Cloudflare Worker) without pulling class-validator's
// reflect-metadata weight.

import { z } from 'zod';

import { DENIAL_REASON_PRECEDENCE, WEBHOOK_EVENT } from './constants.js';

// ── Primitives ───────────────────────────────────────────────────

export const PrincipalIdSchema = z.string().min(1).max(64);
export const AgentIdSchema = z.string().min(1).max(64);
export const PolicyIdSchema = z.string().min(1).max(64);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

// Base64url-encoded Ed25519 public key (32 bytes raw → 43 chars b64url).
export const PublicKeyB64UrlSchema = z
  .string()
  .min(40)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url-encoded');

// Compact JWS / JWT — three base64url segments separated by dots.
export const JwtTokenSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    'must be a compact JWT (header.payload.signature)',
  );

// ── Enums ────────────────────────────────────────────────────────

export const AgentRuntimeSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'huggingface',
  'custom',
]);
export const AgentStatusSchema = z.enum(['pending_verification', 'active', 'suspended', 'revoked']);
export const TrustBandSchema = z.enum(['PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED']);
export const PolicyStatusSchema = z.enum(['active', 'expired', 'revoked']);
export const PolicyCategorySchema = z.enum([
  'commerce',
  'data-read',
  'data-write',
  'communication',
  'scheduling',
]);
// Currency codes — extended in 2026 Q2 audit (a4814df0 / type_design).
// The original USD/EUR/GBP closed enum was a public-API liability:
// ACP merchants in 2026 routinely accept JPY/CAD/AUD/BRL plus stablecoins
// (USDC, PYUSD), and PR cooperativas use USD. Stablecoins are 6-decimal,
// so amount validation must allow non-cent precision when currency is
// in the STABLECOIN set.
//
// Public-API stability: adding values here is non-breaking; removing
// values is breaking. Renames forbidden — the enum value IS the wire
// format.
export const FIAT_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'BRL',
  'CHF',
  'MXN',
] as const;
export const STABLECOIN_CURRENCIES = ['USDC', 'PYUSD', 'USDT', 'EURC'] as const;
export const CurrencySchema = z.enum([...FIAT_CURRENCIES, ...STABLECOIN_CURRENCIES]);

/** True for currencies that use 6-decimal precision (stablecoins). */
export const isStablecoin = (c: z.infer<typeof CurrencySchema>): boolean =>
  (STABLECOIN_CURRENCIES as readonly string[]).includes(c);
export const DenialReasonSchema = z.enum(DENIAL_REASON_PRECEDENCE);
export const SignalSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ReportEventTypeSchema = z.enum([
  'fraud_confirmed',
  'anomaly',
  'policy_violation',
  'suspicious_behavior',
  'false_positive',
]);
export const WebhookEventNameSchema = z.enum([
  WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED,
  WEBHOOK_EVENT.AGENT_ANOMALY_DETECTED,
  WEBHOOK_EVENT.AGENT_POLICY_EXPIRED,
  WEBHOOK_EVENT.AGENT_FLAGGED_BY_RELYING_PARTY,
  WEBHOOK_EVENT.AGENT_REVOKED,
]);

// ── Policy scope ─────────────────────────────────────────────────

export const SpendLimitSchema = z
  .object({
    currency: CurrencySchema,
    maxPerTransaction: z.number().positive().finite().optional(),
    maxPerDay: z.number().positive().finite().optional(),
    maxPerMonth: z.number().positive().finite().optional(),
  })
  .refine(
    (v) =>
      v.maxPerTransaction !== undefined || v.maxPerDay !== undefined || v.maxPerMonth !== undefined,
    'At least one of maxPerTransaction / maxPerDay / maxPerMonth must be set.',
  );

export const PolicyScopeSchema = z.object({
  category: PolicyCategorySchema,
  spendLimit: SpendLimitSchema.optional(),
  merchantCategories: z.array(z.string().min(1)).max(64).optional(),
  allowedDomains: z.array(z.string().min(1).max(255)).max(64).optional(),
  dataScopes: z.array(z.string().min(1).max(64)).max(64).optional(),
  validFrom: IsoDateTimeSchema.optional(),
  validUntil: IsoDateTimeSchema.optional(),
});

export type PolicyScope = z.infer<typeof PolicyScopeSchema>;

// ── Identity ─────────────────────────────────────────────────────

export const AgentRegistrationRequestSchema = z.object({
  publicKey: PublicKeyB64UrlSchema,
  runtime: AgentRuntimeSchema,
  model: z.string().max(64).optional(),
  principalId: PrincipalIdSchema,
  label: z.string().max(120).optional(),
});

export const AgentRegistrationResponseSchema = z.object({
  agentId: AgentIdSchema,
  verificationToken: z.string(),
  trustScore: z.number().int().min(0).max(1000),
  registeredAt: IsoDateTimeSchema,
});

export const AgentIdentitySchema = z.object({
  agentId: AgentIdSchema,
  publicKey: PublicKeyB64UrlSchema,
  principalId: PrincipalIdSchema,
  runtime: AgentRuntimeSchema,
  model: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  status: AgentStatusSchema,
  trustScore: z.number().int().min(0).max(1000),
  trustBand: TrustBandSchema,
  registeredAt: IsoDateTimeSchema,
  lastSeenAt: IsoDateTimeSchema.nullable().optional(),
});

export const AgentStatusResponseSchema = z.object({
  agentId: AgentIdSchema,
  status: AgentStatusSchema,
  trustScore: z.number().int().min(0).max(1000),
  trustBand: TrustBandSchema,
  lastSeenAt: IsoDateTimeSchema.nullable().optional(),
});

export const AgentListQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: AgentIdSchema.optional(),
  status: AgentStatusSchema.optional(),
  runtime: AgentRuntimeSchema.optional(),
  search: z.string().min(1).max(120).optional(),
});

export const AgentListResponseSchema = z.object({
  agents: z.array(AgentIdentitySchema),
  nextCursor: AgentIdSchema.nullable(),
  total: z.number().int().min(0),
});

// Handshake — proof-of-possession of the registered Ed25519 public key.
export const HandshakeChallengeResponseSchema = z.object({
  agentId: AgentIdSchema,
  /** base64url-encoded 256-bit nonce. Single-use, 5 min TTL. */
  challenge: z.string().min(40).max(64),
  expiresIn: z.number().int().positive(),
  protocolVersion: z.literal('cerniq-handshake-v1'),
  /** UTF-8 string the SDK signs verbatim. */
  message: z.string(),
});

export const HandshakeVerifiedResponseSchema = z.object({
  agentId: AgentIdSchema,
  verifiedAt: IsoDateTimeSchema,
  protocolVersion: z.literal('cerniq-handshake-v1'),
  trustScore: z.number().int().min(0).max(1000),
  recordTtlSeconds: z.number().int().positive(),
});

export const HandshakeStatusResponseSchema = z.object({
  agentId: AgentIdSchema,
  verified: z.boolean(),
  verifiedAt: IsoDateTimeSchema.optional(),
  protocolVersion: z.literal('cerniq-handshake-v1').optional(),
});

// ── Policy ───────────────────────────────────────────────────────

export const PolicyCreateRequestSchema = z.object({
  scopes: z.array(PolicyScopeSchema).min(1).max(10),
  expiresAt: IsoDateTimeSchema,
  label: z.string().max(120).optional(),
});

export const PolicyCreateResponseSchema = z.object({
  policyId: PolicyIdSchema,
  signedToken: JwtTokenSchema,
  expiresAt: IsoDateTimeSchema,
});

export const AgentPolicySchema = z.object({
  policyId: PolicyIdSchema,
  agentId: AgentIdSchema,
  scopes: z.array(PolicyScopeSchema),
  status: PolicyStatusSchema,
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  label: z.string().nullable().optional(),
  // OD-024 Phase A2 — wire revocation provenance into the catalog response.
  // `revokedAt` mirrors the server clock at DELETE; `revokedReason` carries
  // the operator-supplied audit context from
  // `DELETE /agents/:agentId/policies/:policyId` body `{ reason: "..." }`.
  // Both null when the policy was never revoked.
  revokedAt: IsoDateTimeSchema.nullable().optional(),
  revokedReason: z.string().nullable().optional(),
});

// ── Verify ───────────────────────────────────────────────────────

export const VerifyRequestSchema = z.object({
  token: JwtTokenSchema,
  action: z.string().max(64).optional(),
  amount: z.number().positive().finite().optional(),
  currency: CurrencySchema.optional(),
  merchantId: z.string().max(120).optional(),
  merchantDomain: z.string().max(255).optional(),
  minTrustScore: z.number().int().min(0).max(1000).optional(),
  context: z.record(z.unknown()).optional(),
});

export const VerifySpendRemainingSchema = z.object({
  today: z.number().nullable().optional(),
  thisMonth: z.number().nullable().optional(),
});

export const VerifyResponseSchema = z
  .object({
    valid: z.boolean(),
    agentId: AgentIdSchema.nullable(),
    principalId: PrincipalIdSchema.nullable(),
    trustScore: z.number().int().min(0).max(1000),
    trustBand: TrustBandSchema.nullable(),
    scopesGranted: z.array(z.string()),
    spendRemaining: VerifySpendRemainingSchema.nullable().optional(),
    denialReason: DenialReasonSchema.nullable(),
    verifiedAt: IsoDateTimeSchema,
    ttl: z.number().int().min(0).max(300),
    auditEventId: z.string().nullable().optional(),
  })
  // T-1 fix — runtime-enforce the cross-field invariants we documented in
  // ADR-0004 + verify.algorithm.ts. Static-type discriminated union is kept
  // out of the wire shape for backward compatibility; consumers wanting the
  // narrowed type use the `isVerifyApproved` / `isVerifyDenied` guards below.
  .refine((r) => (r.valid ? r.denialReason === null : r.denialReason !== null), {
    message: 'valid=true requires denialReason=null; valid=false requires denialReason set',
  })
  .refine(
    (r) => !r.valid || (r.agentId !== null && r.principalId !== null && r.trustBand !== null),
    { message: 'valid=true requires agentId, principalId, and trustBand to be non-null' },
  )
  .refine((r) => r.valid || r.scopesGranted.length === 0, {
    message: 'valid=false must return scopesGranted=[] (no scope grants leak on denial)',
  });

// ── Audit ────────────────────────────────────────────────────────

export const AuditDecisionSchema = z.enum(['approved', 'denied', 'flagged']);

export const AuditEventSchema = z.object({
  eventId: z.string(),
  agentId: AgentIdSchema.nullable(),
  claimedAgentId: z.string().nullable().optional(),
  principalId: PrincipalIdSchema,
  timestamp: IsoDateTimeSchema,
  action: z.string().nullable(),
  actionHash: z.string(),
  relyingParty: z.string().nullable().optional(),
  decision: AuditDecisionSchema,
  decisionReason: z.string().nullable().optional(),
  trustScoreAtEvent: z.number().int().min(0).max(1000),
  signature: z.string(),
});

export const AuditLogResponseSchema = z.object({
  events: z.array(AuditEventSchema),
  nextCursor: z.string().nullable().optional(),
  total: z.number().int().nonnegative(),
});

// ── Reporting ────────────────────────────────────────────────────

export const ReportRequestSchema = z.object({
  eventType: ReportEventTypeSchema,
  severity: SignalSeveritySchema.default('medium'),
  description: z.string().max(1000).optional(),
  transactionId: z.string().max(120).optional(),
  evidence: z.record(z.unknown()).optional(),
});

// ── Inferred types (export the names consumers actually use) ────

export type AgentRuntime = z.infer<typeof AgentRuntimeSchema>;
export type AgentStatusValue = z.infer<typeof AgentStatusSchema>;
export type TrustBand = z.infer<typeof TrustBandSchema>;
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;
export type PolicyCategory = z.infer<typeof PolicyCategorySchema>;
export type Currency = z.infer<typeof CurrencySchema>;
export type SignalSeverity = z.infer<typeof SignalSeveritySchema>;
export type ReportEventType = z.infer<typeof ReportEventTypeSchema>;
export type SpendLimit = z.infer<typeof SpendLimitSchema>;
export type AgentRegistrationRequest = z.infer<typeof AgentRegistrationRequestSchema>;
export type AgentRegistrationResponse = z.infer<typeof AgentRegistrationResponseSchema>;
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type AgentStatusResponse = z.infer<typeof AgentStatusResponseSchema>;
export type AgentListQuery = z.infer<typeof AgentListQuerySchema>;
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;
export type HandshakeChallengeResponse = z.infer<typeof HandshakeChallengeResponseSchema>;
export type HandshakeVerifiedResponse = z.infer<typeof HandshakeVerifiedResponseSchema>;
export type HandshakeStatusResponse = z.infer<typeof HandshakeStatusResponseSchema>;
export type PolicyCreateRequest = z.infer<typeof PolicyCreateRequestSchema>;
export type PolicyCreateResponse = z.infer<typeof PolicyCreateResponseSchema>;
export type AgentPolicy = z.infer<typeof AgentPolicySchema>;
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;
export type AuditEventRecord = z.infer<typeof AuditEventSchema>;
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

// ── Verify response narrow types (T-1 helper) ────────────────────
// Kept additive so the wire `VerifyResponse` shape stays backward-compatible
// while consumers that want the discriminated experience opt in.

export type VerifyApproved = VerifyResponse & {
  valid: true;
  agentId: string;
  principalId: string;
  trustBand: TrustBand;
  denialReason: null;
};

export type VerifyDenied = VerifyResponse & {
  valid: false;
  denialReason: NonNullable<VerifyResponse['denialReason']>;
};

/**
 * Type-narrows a VerifyResponse to its approved branch.
 *
 * Use this in SDK consumer code to access `agentId`, `principalId`, and
 * `trustBand` as non-nullable strings without `!` assertions:
 *
 *   const result = await cerniq.verify(token);
 *   if (isVerifyApproved(result)) {
 *     fulfilOrder(result.agentId, result.principalId);
 *   } else {
 *     escalate(result.denialReason);   // also narrowed to NonNullable
 *   }
 */
export function isVerifyApproved(r: VerifyResponse): r is VerifyApproved {
  return r.valid && r.agentId !== null && r.principalId !== null && r.trustBand !== null;
}

export function isVerifyDenied(r: VerifyResponse): r is VerifyDenied {
  return !r.valid && r.denialReason !== null;
}
