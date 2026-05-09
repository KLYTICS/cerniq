// OnboardingService — read + write the per-principal activation
// checklist (OD-012). One-way ratchet semantics: a step that has been
// marked complete cannot be marked incomplete from this surface.
//
// Used by:
//   - Dashboard wizard (GET status to render checklist)
//   - `aegis doctor` CLI (GET status to render "you haven't done X yet")
//   - Service-internal hooks (agent.create / policy.create / verify
//     success / kms.configure call markStep() to roll up the funnel)

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { OnboardingStatusDto, OnboardingStep } from './onboarding.dto';

/** Maps step → timestamp column. Stays in sync with the schema. */
const STEP_TIMESTAMP_COL: Record<OnboardingStep, string> = {
  hasFirstAgent: 'firstAgentAt',
  hasFirstPolicy: 'firstPolicyAt',
  hasFirstVerify: 'firstVerifyAt',
  hasKmsConfigured: 'kmsConfiguredAt',
  hasMcpServerRegistered: 'firstMcpServerAt',
  hasWebhookSubscribed: 'firstWebhookAt',
  hasPaymentMethodAdded: 'paymentMethodAt',
};

const ALL_STEPS: OnboardingStep[] = [
  'hasFirstAgent',
  'hasFirstPolicy',
  'hasFirstVerify',
  'hasKmsConfigured',
  'hasMcpServerRegistered',
  'hasWebhookSubscribed',
  'hasPaymentMethodAdded',
];

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch onboarding state. Lazy-creates the row on first read so
   * dashboards and CLIs don't have to special-case "no row yet".
   */
  async getStatus(principalId: string): Promise<OnboardingStatusDto> {
    const row = await this.prisma.principalOnboarding.upsert({
      where: { principalId },
      create: { principalId },
      update: {},
    });
    const steps = {
      hasFirstAgent: row.hasFirstAgent,
      hasFirstPolicy: row.hasFirstPolicy,
      hasFirstVerify: row.hasFirstVerify,
      hasKmsConfigured: row.hasKmsConfigured,
      hasMcpServerRegistered: row.hasMcpServerRegistered,
      hasWebhookSubscribed: row.hasWebhookSubscribed,
      hasPaymentMethodAdded: row.hasPaymentMethodAdded,
    };
    const completed = Object.values(steps).filter(Boolean).length;
    return {
      principalId,
      steps,
      completed,
      total: ALL_STEPS.length,
      timestamps: {
        firstAgentAt: row.firstAgentAt?.toISOString() ?? null,
        firstPolicyAt: row.firstPolicyAt?.toISOString() ?? null,
        firstVerifyAt: row.firstVerifyAt?.toISOString() ?? null,
        kmsConfiguredAt: row.kmsConfiguredAt?.toISOString() ?? null,
        firstMcpServerAt: row.firstMcpServerAt?.toISOString() ?? null,
        firstWebhookAt: row.firstWebhookAt?.toISOString() ?? null,
        paymentMethodAt: row.paymentMethodAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Idempotent. Calling `markStep('hasFirstAgent')` after the step is
   * already complete is a no-op (preserves the original timestamp).
   * Service-internal callers don't need to check first.
   */
  async markStep(principalId: string, step: OnboardingStep): Promise<void> {
    const tsCol = STEP_TIMESTAMP_COL[step];
    if (!tsCol) throw new Error(`onboarding: unknown step=${step}`);

    await this.prisma.principalOnboarding.upsert({
      where: { principalId },
      create: {
        principalId,
        [step]: true,
        [tsCol]: new Date(),
      },
      // NOTE: the boolean is set to true unconditionally; the timestamp
      // is set ONLY if it's currently null (preserves original mark time).
      // Prisma doesn't support "set if null" in a single update — we
      // emulate by reading once, but that race-window is acceptable for
      // an analytics table.
      update: {
        [step]: true,
        ...(await this.shouldSetTimestamp(principalId, step) ? { [tsCol]: new Date() } : {}),
      },
    });
  }

  private async shouldSetTimestamp(principalId: string, step: OnboardingStep): Promise<boolean> {
    const tsCol = STEP_TIMESTAMP_COL[step];
    const existing = await this.prisma.principalOnboarding.findUnique({
      where: { principalId },
      select: { [tsCol]: true } as never,
    });
    if (!existing) return true;
    return (existing as Record<string, Date | null>)[tsCol] === null;
  }
}
