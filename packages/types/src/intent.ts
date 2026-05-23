// Zod schemas for the Intent Manifest surface (ADR-0016 / ADR-0017).
//
// These mirror the components declared under `# ── Intent Manifest schemas`
// in docs/spec/AEGIS_API_SPEC.yaml. They are checked by the spec-sync gate
// at packages/types/scripts/check-openapi-zod-parity.ts — every property
// that appears in the OpenAPI spec must appear as a key on the Zod
// schema with the matching name (`<ComponentName>Schema`).
//
// Why these live in @aegis/types and not in @aegis/intent-manifest:
//   @aegis/intent-manifest already owns the structural TS types for the
//   kernel's pure reconciliation logic (zero runtime deps, edge-portable).
//   The Zod schemas here are the WIRE contract: they're what crosses the
//   network boundary, what dashboards and SDKs validate, and what the
//   OpenAPI parity gate compares against. Splitting types (kernel) from
//   schemas (wire) keeps the kernel free of zod and keeps the OpenAPI
//   parity script's import surface narrow.
//
// Per CLAUDE.md packages contract: wire schemas and constants belong here.

import { z } from 'zod';

import { AgentIdSchema, PrincipalIdSchema } from './schemas.js';

// ── Enums ────────────────────────────────────────────────────────────

/**
 * Discriminated-union tag shared by IntentClaim and ActualCallObservation.
 * Locked at three members (ADR-0016 / operator 2026-05-15). See
 * packages/intent-manifest/src/types.ts §2 for adoption-wedge rationale.
 */
export const IntentClaimKindSchema = z.enum([
  'http-call',
  'commerce-action',
  'tool-invocation',
]);

/** Reconciliation strictness — see packages/intent-manifest types.ts §3. */
export const ReconciliationStrictnessSchema = z.enum([
  'strict',
  'advisory',
  'graduated',
]);

/** Closed enum over the mismatch surface. No `unknown` fallthrough per
 *  CLAUDE.md invariant #4 (no silent failures). */
export const IntentMismatchKindSchema = z.enum([
  'over-call-count',
  'wrong-endpoint',
  'wrong-method',
  'wrong-merchant',
  'over-amount-cap',
  'arg-shape-mismatch',
  'manifest-expired',
  'manifest-not-yet-valid',
]);

/** Lifecycle state of a stored manifest as exposed via GET /v1/intent/:id. */
export const IntentManifestStatusSchema = z.enum(['OPEN', 'RECONCILED', 'EXPIRED']);

// ── IntentClaim ──────────────────────────────────────────────────────

/**
 * Wire-level IntentClaim. The OpenAPI schema is open
 * (`additionalProperties: true`) because the per-shape fields
 * (url+method, action+merchantId+amountCap, toolName+argsHash) are
 * pass-through and validated by the kernel — see
 * packages/intent-manifest types.ts §2. We mirror that with
 * `.passthrough()` so consumers can carry shape-specific fields without
 * losing them at the Zod boundary.
 */
export const IntentClaimSchema = z
  .object({
    kind: IntentClaimKindSchema,
    maxCalls: z.number().int().min(1),
  })
  .passthrough();

// ── ReconciliationPolicy ─────────────────────────────────────────────

export const ReconciliationPolicySchema = z.object({
  strictness: ReconciliationStrictnessSchema,
  /** Only meaningful when strictness === 'graduated'. See ADR-0016 D2. */
  tolerance: z.number().min(0).optional(),
});

// ── SignedIntentManifest ─────────────────────────────────────────────

/**
 * IntentManifestBody. Kept open (`passthrough`) on the wire because
 * the OpenAPI spec describes the body via `additionalProperties: true`
 * and lists fields only in description prose; the structural TS contract
 * lives in packages/intent-manifest types.ts §1.
 */
export const IntentManifestBodySchema = z
  .object({
    schemaVersion: z.literal(1),
    manifestId: z.string().min(1),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    principalId: PrincipalIdSchema,
    agentId: AgentIdSchema,
    intent: IntentClaimSchema,
    reconciliation: ReconciliationPolicySchema,
    verifyTokenJti: z.string().min(1),
    verifyTokenSha256B64Url: z.string().min(1),
  })
  .passthrough();

export const SignedIntentManifestSchema = z.object({
  body: IntentManifestBodySchema,
  signingKeyId: z.string().min(1),
  signatureB64Url: z.string().min(1),
});

// ── IssueIntent (POST /v1/intent) ────────────────────────────────────

export const IssueIntentRequestSchema = z.object({
  agentId: AgentIdSchema,
  verifyTokenJti: z.string().min(1),
  verifyTokenSha256B64Url: z.string().min(1),
  intent: IntentClaimSchema,
  reconciliation: ReconciliationPolicySchema.optional(),
  /** Server clamps to [30, 60] per Phase 2 bounds (OD-019 may widen). */
  ttlSeconds: z.number().int().min(30).max(60).optional(),
});

export const IssueIntentResponseSchema = z.object({
  manifestId: z.string().min(1),
  signedManifest: SignedIntentManifestSchema,
  /** Unix epoch seconds. */
  expiresAt: z.number().int().nonnegative(),
});

// ── ActualCallObservation ────────────────────────────────────────────

export const ActualCallObservationSchema = z.object({
  /** Unix epoch seconds when the relying party observed the actual. */
  observedAt: z.number().int().nonnegative(),
  kind: IntentClaimKindSchema,
  // type-rationale: OpenAPI `payload` is `additionalProperties: true`
  // (open object). z.record(z.unknown()) is the right wire mirror;
  // the kernel validates per-shape semantics downstream.
  payload: z.record(z.unknown()),
});

// ── ReconcileIntent (POST /v1/intent/:id/reconcile) ──────────────────

export const ReconcileIntentRequestSchema = z.object({
  actuals: z.array(ActualCallObservationSchema),
});

export const IntentMismatchSchema = z.object({
  kind: IntentMismatchKindSchema,
  detail: z.string(),
  detectedAt: z.number().int().nonnegative(),
});

export const ReconcileIntentResponseSchema = z.object({
  manifestId: z.string().min(1),
  actualCount: z.number().int().nonnegative(),
  mismatches: z.array(IntentMismatchSchema),
  /**
   * `INTENT_MISMATCH` on strict-mode mismatch OR breached graduated
   * tolerance. `null` on clean match OR advisory mode. The literal
   * mirrors the appended member of DENIAL_REASON_PRECEDENCE in
   * constants.ts; we keep it inline (not imported) so this module
   * remains the wire-shape source.
   */
  recommendedDenialReason: z.literal('INTENT_MISMATCH').nullable(),
  /** True if this call replayed an existing idempotency-key. */
  idempotencyReplay: z.boolean().optional(),
});

// ── GetIntent (GET /v1/intent/:id) ───────────────────────────────────

export const GetIntentResponseSchema = z.object({
  manifest: SignedIntentManifestSchema,
  actuals: z.array(ActualCallObservationSchema),
  // OpenAPI: oneOf [ ReconcileIntentResponse, null ] — Zod mirror via nullable.
  reconciliation: ReconcileIntentResponseSchema.nullable(),
  status: IntentManifestStatusSchema,
});

// ── Inferred types ───────────────────────────────────────────────────

export type IntentClaimKind = z.infer<typeof IntentClaimKindSchema>;
export type ReconciliationStrictness = z.infer<typeof ReconciliationStrictnessSchema>;
export type IntentMismatchKind = z.infer<typeof IntentMismatchKindSchema>;
export type IntentManifestStatus = z.infer<typeof IntentManifestStatusSchema>;
export type IntentClaim = z.infer<typeof IntentClaimSchema>;
export type ReconciliationPolicy = z.infer<typeof ReconciliationPolicySchema>;
export type IntentManifestBody = z.infer<typeof IntentManifestBodySchema>;
export type SignedIntentManifest = z.infer<typeof SignedIntentManifestSchema>;
export type IssueIntentRequest = z.infer<typeof IssueIntentRequestSchema>;
export type IssueIntentResponse = z.infer<typeof IssueIntentResponseSchema>;
export type ActualCallObservation = z.infer<typeof ActualCallObservationSchema>;
export type ReconcileIntentRequest = z.infer<typeof ReconcileIntentRequestSchema>;
export type IntentMismatch = z.infer<typeof IntentMismatchSchema>;
export type ReconcileIntentResponse = z.infer<typeof ReconcileIntentResponseSchema>;
export type GetIntentResponse = z.infer<typeof GetIntentResponseSchema>;
