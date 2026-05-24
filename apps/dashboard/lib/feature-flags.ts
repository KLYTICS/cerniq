// Dashboard feature flags. One module to give the dashboard a single,
// typed contract for reading flag state from env, server- or client-side.
//
// The API and the dashboard each read their own copy of any flag — by
// design, since they ship independently. Operators set both halves of
// a paired flag at the same time (see LAUNCH.md §0 go/no-go snapshot).

/**
 * BILLING_LADDER_ENABLED — when false, the dashboard hides upgrade CTAs.
 * Paired with the API's `BILLING_LADDER_ENABLED` config which gates
 * /v1/billing/checkout server-side. Dashboard reads the NEXT_PUBLIC_*
 * variant so the value is available both at build (UI tree) and at
 * runtime (server components).
 *
 * Path C launch posture (LAUNCH.md): keep `false` until the first
 * paying beta customer has completed a full checkout → upgrade →
 * continued-verify smoke. Flip both halves together.
 *
 * Note on Stripe portal: portal access is NOT gated by this flag —
 * existing paid customers need to manage their subscription regardless
 * of whether new self-serve signups are accepting payment.
 */
export function billingLadderEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_LADDER_ENABLED === 'true';
}
