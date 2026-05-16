// Intent Manifest client for the AEGIS TS SDK. Wraps the /v1/intent
// surface (ADR-0017) — issuance + reconciliation + read.
//
// Usage:
//
//   const aegis = new Aegis({ apiKey });
//   const { manifestId, signedManifest } = await aegis.intent.issue({
//     agentId,
//     verifyTokenJti,
//     verifyTokenSha256B64Url,
//     intent: { kind: 'commerce-action', action: 'stripe.charge', maxCalls: 1,
//               merchantId, amountCap: { amount: '25.00', currency: 'USD' } },
//   });
//
//   // ... agent performs the tool call ...
//
//   const result = await aegis.intent.reconcile(manifestId, {
//     idempotencyKey: `recon-${manifestId}-${Date.now()}`,
//     actuals: [{
//       observedAt: Math.floor(Date.now() / 1000),
//       kind: 'commerce-action',
//       payload: { action: 'stripe.charge', merchantId, amount: '24.00' },
//     }],
//   });
//   if (result.recommendedDenialReason) { /* deny + refund + alert */ }

import type {
  ActualCallObservation,
  IntentClaim,
  ReconciliationPolicy,
  ReconciliationResult,
  SignedIntentManifest,
} from '@aegis/intent-manifest';

import type { HttpClient } from './http.js';

// ────────────────────────────────────────────────────────────────────────
// Wire-shape DTOs (mirror apps/api/src/modules/intent/intent.dto.ts +
// docs/spec/AEGIS_API_SPEC.yaml /v1/intent endpoints)
// ────────────────────────────────────────────────────────────────────────

export interface IssueIntentRequest {
  agentId: string;
  /** jti of the verify token this manifest binds to. */
  verifyTokenJti: string;
  /** Base64URL SHA-256 of the verify token bytes. */
  verifyTokenSha256B64Url: string;
  intent: IntentClaim;
  /** Defaults server-side to { strictness: 'strict' } (ADR-0016 D2). */
  reconciliation?: ReconciliationPolicy;
  /** Seconds. Clamped server-side to [30, 60] in Phase 2 (OD-019 may widen). */
  ttlSeconds?: number;
}

export interface IssueIntentResponse {
  manifestId: string;
  signedManifest: SignedIntentManifest;
  /** Unix epoch seconds. */
  expiresAt: number;
}

export interface ReconcileIntentRequest {
  /** Idempotency-Key header value. REQUIRED per ADR-0017. */
  idempotencyKey: string;
  actuals: readonly ActualCallObservation[];
}

export interface ReconcileIntentResponse extends ReconciliationResult {
  /** True if this call replayed an existing idempotency-key. */
  idempotencyReplay?: boolean;
}

export interface GetIntentResponse {
  manifest: SignedIntentManifest;
  actuals: readonly ActualCallObservation[];
  reconciliation: ReconciliationResult | null;
  status: 'OPEN' | 'RECONCILED' | 'EXPIRED';
}

// ────────────────────────────────────────────────────────────────────────
// Client class — mirrors AgentClient + PolicyClient shape
// ────────────────────────────────────────────────────────────────────────

export class IntentClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * Issue a signed intent manifest bound to a verify-token jti.
   * Server-side defaults: strictness='strict', ttlSeconds=60.
   * Throws AegisError subclass on 4xx/5xx (use isAegisErrorRetryable to
   * decide retry semantics).
   */
  issue(input: IssueIntentRequest): Promise<IssueIntentResponse> {
    return this.http.request<IssueIntentResponse>('/intent', {
      method: 'POST',
      body: input,
    });
  }

  /**
   * Reconcile observed actuals against the manifest. Idempotency-Key is
   * REQUIRED per ADR-0017 — collisions on the same key + same body return
   * the prior result (replay); collisions on same key + different body
   * return a 409 IDEMPOTENCY_CONFLICT (AegisConflictError).
   */
  reconcile(
    manifestId: string,
    input: ReconcileIntentRequest,
  ): Promise<ReconcileIntentResponse> {
    return this.http.request<ReconcileIntentResponse>(
      `/intent/${encodeURIComponent(manifestId)}/actuals`,
      {
        method: 'POST',
        body: { actuals: input.actuals },
        headers: { 'Idempotency-Key': input.idempotencyKey },
      },
    );
  }

  /** Read a stored manifest + reconciliation outcome. */
  get(manifestId: string): Promise<GetIntentResponse> {
    return this.http.request<GetIntentResponse>(
      `/intent/${encodeURIComponent(manifestId)}`,
      { method: 'GET' },
    );
  }
}
