// Domain types for the ACP + OKORO dual-verify flow.
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

/** OKORO auditEventId — links the merchant charge to OKORO's signed
 *  audit chain so a regulator can independently verify either side. */
export type AuditEventId = string;

/** Inbound /api/charge body. The merchant API receives BOTH tokens
 *  per the ACP + OKORO dual-verify pattern. */
export interface ChargeRequest {
  /** Stripe Shared Payment Token from ACP authorization. */
  paymentToken: SharedPaymentToken;
  /** OKORO-signed agent token (the JWT from `signAgentToken`). */
  okoroToken: string;
  /** Charge amount in the smallest currency unit (cents for USD). */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Merchant Category Code (informational; some PSPs require it). */
  mcc?: string;
  /** Public-facing merchant domain — used for OKORO scope check. */
  merchantDomain: string;
  /** Optional client-side idempotency key. OKORO jti is used when absent. */
  idempotencyKey?: string;
}

/** Verdict shape returned by the merchant API. */
export interface ChargeResponse {
  allowed: boolean;
  /** Stripe charge id when allowed. */
  chargeId?: ChargeId;
  /** OKORO audit event id (always present — denials are audited too). */
  auditEventId?: AuditEventId;
  /** When denied, which side refused: 'okoro' or 'stripe' (or 'pre' for
   *  validation errors before either gate was called). */
  denialSource?: 'okoro' | 'stripe' | 'pre';
  /** Okoro denial reason from the canonical 9-reason precedence. */
  okoroDenialReason?: string;
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
   *  cross-checking against OKORO's principalId for the agent. */
  payerUserId?: string;
  /** When invalid: the Stripe error code. */
  errorCode?: string;
  /** When invalid: a human description of why. */
  errorMessage?: string;
}
