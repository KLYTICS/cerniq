// JWT claim type-validation helpers shared across IdP adapters.
//
// WHY THIS MODULE EXISTS
//
// JWT claims arrive from the wire as `Record<string, unknown>`. Auth0,
// Clerk, and any future IdP adapter must project them into the strongly
// typed `IdpUser` shape, and the projection has to defend against
// claims that are present-but-wrong-type — an attacker-controllable
// surface.
//
// The naive `typeof claim === 'string' ? claim : ''` pattern silently
// coerces four input shapes (object, number, array, boolean) to the
// empty string. Downstream code then treats the user as "verified with
// empty fields" rather than failing the token, which violates the
// AEGIS "no silent failures" doctrine (CLAUDE.md root contract).
//
// These helpers force the alternative: a malformed claim short-circuits
// `verifyAccessToken` to null, the same sentinel the function already
// uses for "signature invalid" or "issuer mismatch".
//
// SCOPE
//
// Type validation only. Domain validation (issuer match, audience match,
// expiry, signature verification) stays in the adapter — it's IdP-specific.

/**
 * Validate that a JWT claim is present and a non-empty string.
 *
 * Returns the value if it is a non-empty string; returns null otherwise.
 * Use for REQUIRED claims like `sub` and `email` where absence or
 * malformedness should fail the entire token verification.
 *
 * @example
 *   const sub = requireStringClaim(claims, 'sub');
 *   if (!sub) return null;
 */
export function requireStringClaim(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const v = claims[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Sentinel return type for `optionalStringClaim` — three-way result:
 *   - `string` — claim is present and a string (may be empty).
 *   - `undefined` — claim is absent (undefined or null in the payload).
 *   - `null` — claim is present but the wrong type. Caller MUST treat
 *     this as a verification failure and return null from the adapter.
 */
export type OptionalClaimResult = string | undefined | null;

/**
 * Validate an OPTIONAL JWT claim without requiring presence.
 *
 * Distinguishes three cases the caller must handle separately:
 *   - present + string → return the value
 *   - absent (undefined or null in payload) → return undefined
 *   - present + wrong type → return null (loud failure signal)
 *
 * The caller chains the result through a nullish-coalescing default
 * for the absent case, and short-circuits the adapter on null. Example:
 *
 *   const orgId = optionalStringClaim(claims, 'org_id');
 *   if (orgId === null) return null; // malformed claim
 *   // orgId is now string | undefined
 *   const finalOrgId = orgId ?? '';
 *
 * @example
 *   const name = optionalStringClaim(claims, 'name');
 *   if (name === null) return null;
 *   return { ..., name: name ?? null };
 */
export function optionalStringClaim(
  claims: Record<string, unknown>,
  key: string,
): OptionalClaimResult {
  const v = claims[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  return null;
}

/**
 * Validate that a JWT claim is an array of strings.
 *
 * Returns:
 *   - the array if it is present and every element is a string
 *   - an empty array if the claim is absent
 *   - null if present but wrong type, or if any element is non-string
 *
 * Used for `roles`, `amr`, custom-namespace role claims, etc. Empty
 * array for absent is the safe default — "no roles" is a valid state.
 *
 * Element-level checks matter: an attacker who can inject `[1, 2, 3]`
 * as a roles claim must not silently produce role strings like '1'.
 */
export function optionalStringArrayClaim(
  claims: Record<string, unknown>,
  key: string,
): string[] | null {
  const v = claims[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  for (const el of v) {
    if (typeof el !== 'string') return null;
  }
  return v as string[];
}
