// Request DTO for POST /admin/principals — founder-led principal
// creation for the cheapest path to customer #1 (per
// docs/LAUNCH_READINESS_AUDIT_2026-05-21.md Phase Bα).
//
// Why Zod inline (not @aegis/types yet): /admin/* is a closed-surface
// internal API gated by AEGIS_ADMIN_TOKEN. It is NOT part of the
// public wire contract that ships in the SDK. Per CLAUDE.md packages
// invariant 7 ("Contracts are generated or centrally owned. Wire
// schemas and constants belong in `packages/types`"), public wire
// contracts live in @aegis/types — internal admin surfaces own their
// own DTOs. If /admin/* ever becomes public (multi-tenant admin),
// promote these to @aegis/types/admin.ts at that time.

import { z } from 'zod';

import type { PlanTier } from '@prisma/client';

// PlanTier enum mirrored as Zod union — Prisma enums are not z-importable
// at compile time. Keep in sync with apps/api/prisma/schema.prisma if
// new tiers land. Current set per the Prisma `enum PlanTier`:
const PlanTierZ = z.enum(['FREE', 'DEVELOPER', 'GROWTH', 'ENTERPRISE']);

export const CreatePrincipalRequestSchema = z.object({
  /**
   * Customer email — MUST be unique across the principals table.
   * Email collision (already exists) returns 409 with the existing
   * principalId so the operator can decide whether to issue a new
   * API key to the existing principal.
   */
  email: z.string().email(),

  /**
   * Display name — optional, defaults to the email's local-part on
   * the wire side. Surfaces in the dashboard principal list.
   */
  name: z.string().max(100).optional(),

  /**
   * Plan tier at creation. Defaults to FREE — the operator can upgrade
   * via /admin/principals/:id/plan-tier later (not in v1).
   *
   * Setting tier > FREE here skips the Stripe checkout path — useful
   * for design partners on negotiated pricing. ENTERPRISE tier is the
   * canonical use case for this field.
   */
  planTier: PlanTierZ.optional(),
});

export type CreatePrincipalRequest = z.infer<typeof CreatePrincipalRequestSchema>;

export interface CreatePrincipalResponse {
  /** New principal's cuid identifier (e.g. `cl…`). */
  principalId: string;
  /** Echo of the email as stored — useful for the operator's audit log. */
  email: string;
  /** Plan tier as stored. */
  planTier: PlanTier;
  /** ISO-8601 timestamp of creation (the audit event timestamp too). */
  createdAt: string;
}
