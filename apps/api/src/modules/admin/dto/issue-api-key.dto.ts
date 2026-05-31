// Request DTO for POST /admin/principals/:principalId/api-keys —
// issues a fresh API key for an existing principal under the
// founder-led onboarding path.
//
// Pairs with create-principal.dto.ts. Both are internal admin DTOs
// (not part of the public SDK contract — see that file's header note).

import { z } from 'zod';

export const IssueApiKeyRequestSchema = z.object({
  /**
   * Operator-facing label for the issued key. Surfaces in the
   * dashboard API-keys table. Recommended: include the customer
   * name + purpose (e.g. "acme-corp-production-2026-Q2").
   *
   * Optional but encouraged — keys without labels are debuggable
   * only by their keyPrefix, which is the first 12 chars of the
   * plaintext (limited usefulness for ops).
   */
  label: z.string().max(120).optional(),

  /**
   * Key scope. `FULL` permits all API surface (verify, identity,
   * policy, audit read, billing read); `VERIFY_ONLY` is the
   * relying-party scope that limits the key to `/v1/verify` only.
   *
   * Default `FULL` matches the dashboard-issued-key default.
   * Founder-led onboarding typically issues FULL since the customer
   * needs to register agents + policies.
   */
  scope: z.enum(['FULL', 'VERIFY_ONLY']).optional(),
});

export type IssueApiKeyRequest = z.infer<typeof IssueApiKeyRequestSchema>;

export interface IssueApiKeyResponse {
  /** New API key's database id (not the secret). */
  apiKeyId: string;
  /**
   * The plaintext API key — returned EXACTLY ONCE. The operator MUST
   * deliver this to the customer immediately (via email, secure
   * messaging, or 1Password share). After this response, only the
   * bcrypt hash is stored; the plaintext is unrecoverable.
   *
   * Format: `aegis_sk_<26 char base58-ish>` for FULL scope,
   * `aegis_vk_…` for VERIFY_ONLY.
   */
  plaintextKey: string;
  /**
   * The first 12 chars of plaintextKey. Safe to display in the
   * dashboard / operator logs — used for human disambiguation
   * between keys.
   */
  keyPrefix: string;
  /** Principal that owns this key (echo from URL param). */
  principalId: string;
  /** Scope as stored. */
  scope: 'FULL' | 'VERIFY_ONLY';
  /** ISO-8601 timestamp of issuance. */
  issuedAt: string;
}
