// Domain types for the ACP + AEGIS dual-verify flow.
//
// We model Stripe's Agentic Commerce Protocol shape (Shared Payment
// Tokens) without depending on the `stripe` npm package — the example
// stays runnable even when the SDK isn't installed, and the types are
// the contract a real Stripe-API call would satisfy.

/** Stripe Shared Payment Token. The agent receives this from Stripe
 *  during ACP authorization and presents it to the merchant. */
export type SharedPaymentToken = `spt_${string}`;

/** Stripe charge identifier — what `POST /v1/charges` returns. */
export type ChargeId = `ch_${string}`;

/** AEGIS auditEventId — links the merchant charge to AEGIS's signed
 *  audit chain so a regulator can independently verify either side. */
export type AuditEventId = string;

/** Inbound /api/charge body. The merchant API receives BOTH tokens
 *  per the ACP + AEGIS dual-verify pattern. */
export interface ChargeRequest {
  /** Stripe Shared Payment Token from ACP authorization. */
  paymentToken: SharedPaymentToken;
  /** AEGIS-signed agent token (the JWT from `signAgentToken`). */
  aegisToken: string;
  /** Charge amount in the smallest currency unit (cents for USD). */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Merchant Category Code (informational; some PSPs require it). */
  mcc?: string;
  /** Public-facing merchant domain — used for AEGIS scope check. */
  merchantDomain: string;
  /** Optional client-side idempotency key. AEGIS jti is used when absent. */
  idempotencyKey?: string;
}

/** Verdict shape returned by the merchant API. */
export interface ChargeResponse {
  allowed: boolean;
  /** Stripe charge id when allowed. */
  chargeId?: ChargeId;
  /** AEGIS audit event id (always present — denials are audited too). */
  auditEventId?: AuditEventId;
  /** When denied, which side refused: 'aegis' or 'stripe' (or 'pre' for
   *  validation errors before either gate was called). */
  denialSource?: 'aegis' | 'stripe' | 'pre';
  /** Aegis denial reason from the canonical 9-reason precedence. */
  aegisDenialReason?: string;
  /** Stripe-side error code (e.g. spt_expired, spt_amount_mismatch). */
  stripeError?: string;
}

/** SPT verification verdict from the (mocked) Stripe gate. The real
 *  Stripe API exposes this through a verify call; our example models
 *  the shape. */
export interface SptVerdict {
  valid: boolean;
  /** When valid: the spend cap on the SPT (cents). The merchant must
   *  ensure the requested amount is ≤ this cap. */
  authorizedAmountMax?: number;
  /** When valid: the currency the SPT is denominated in. */
  authorizedCurrency?: string;
  /** When valid: the user identifier the SPT was issued to. Useful for
   *  cross-checking against AEGIS's principalId for the agent. */
  payerUserId?: string;
  /** When invalid: the Stripe error code. */
  errorCode?: string;
  /** When invalid: a human description of why. */
  errorMessage?: string;
}
