// IdP-claim validators — shared by every IdpAdapter implementation.
//
// Why this file exists: prior to this module, each adapter coerced
// wrong-type JWT claims to empty strings (`typeof x === 'string' ? x : ''`).
// That violated root CLAUDE.md invariant 4 ("No silent failures and no
// fabricated data") in an auth hot path and risked tenant-isolation
// collisions (multiple users registered with `idpUserId: ''`).
//
// The operator-chosen design is **strict rejection**:
//   - Required claims (idpUserId, idpOrganizationId, idpDomain, email):
//     missing/wrong-type/empty-string → reject the token (return null
//     from `verifyAccessToken`).
//   - Optional claims (name, roles, mfaSatisfied): prefer typed empty
//     (`null` / `[]` / `false`) over coerced empty string.
//
// These helpers are pure and side-effect-free; callers are responsible
// for the structured log on rejection (so the log can identify the
// specific claim and the adapter without leaking the claim value itself).

/**
 * Returns the claim value if it is a non-empty string; null otherwise.
 *
 * An empty string is treated as missing because, for every required JWT
 * claim (`sub`, `email`, `org_id`, `org_slug`, etc.), an empty value
 * cannot identify a real user/org and would create the same silent-failure
 * mode as a coerced empty string.
 */
export function requireStringClaim(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const v = claims[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Returns the claim value if it is a string (non-empty), null if missing,
 * wrong type, or empty. Caller decides whether `null` is acceptable.
 *
 * Identical implementation to {@link requireStringClaim} — kept as a
 * separate name so adapter callsites read clearly:
 *
 *     const userId = requireStringClaim(claims, 'sub');
 *     if (userId === null) { reject(); return null; }
 *
 *     const displayName = optionalStringClaim(claims, 'name');
 *     // displayName: string | null — pass straight to IdpUser.name
 */
export function optionalStringClaim(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const v = claims[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Returns the claim value if it is a non-empty string; otherwise returns
 * null after consulting a fallback path on a nested object. Used by Clerk
 * where `org_id` may live at `claims.org_id` OR `claims.o.id` depending
 * on Clerk's token version.
 */
export function requireStringClaimWithFallback(
  claims: Record<string, unknown>,
  primaryKey: string,
  fallbackPath: { parentKey: string; nestedKey: string },
): string | null {
  const primary = requireStringClaim(claims, primaryKey);
  if (primary !== null) return primary;

  const parent = claims[fallbackPath.parentKey];
  if (parent === null || typeof parent !== 'object') return null;
  const nested = (parent as Record<string, unknown>)[fallbackPath.nestedKey];
  return typeof nested === 'string' && nested.length > 0 ? nested : null;
}

/**
 * Returns true when the `amr` (Authentication Methods References) claim
 * is a string array that includes `'mfa'`. Returns false for any other
 * shape (missing claim, non-array, array of non-strings).
 *
 * Centralized so adapters do not each implement the array narrowing.
 */
export function isMfaSatisfied(claims: Record<string, unknown>): boolean {
  const amr = claims.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((v) => typeof v === 'string' && v === 'mfa');
}

/**
 * Returns a filtered string array of `aegis:*` roles, or `[]`.
 * Tolerates missing, wrong-type, and mixed-type values without coercion.
 *
 * Used by Clerk + WorkOS which receive role lists from customer-side
 * IdPs where non-AEGIS role names may leak in.
 */
export function extractAegisRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === 'string' && v.startsWith('aegis:'),
  );
}

/**
 * Returns a string array from a claim value, dropping any non-string
 * entries. Returns `[]` for missing/wrong-type values.
 *
 * Used by Auth0 where the `https://aegis.dev/roles` custom claim is
 * already curated by an Auth0 Action — no `aegis:*` prefix filter needed.
 */
export function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
