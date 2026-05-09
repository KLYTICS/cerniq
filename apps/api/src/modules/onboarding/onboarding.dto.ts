// Onboarding DTOs — server-persisted activation state per OD-012.

export interface OnboardingStatusDto {
  principalId: string;
  steps: {
    hasFirstAgent: boolean;
    hasFirstPolicy: boolean;
    hasFirstVerify: boolean;
    hasKmsConfigured: boolean;
    hasMcpServerRegistered: boolean;
    hasWebhookSubscribed: boolean;
    hasPaymentMethodAdded: boolean;
  };
  /** Number of completed steps. */
  completed: number;
  /** Total checklist size. */
  total: number;
  /** ISO timestamps for funnel analysis (or null if step not done). */
  timestamps: Record<string, string | null>;
}

/** Steps the dashboard / CLI can mark complete via PATCH. */
export type OnboardingStep =
  | 'hasFirstAgent'
  | 'hasFirstPolicy'
  | 'hasFirstVerify'
  | 'hasKmsConfigured'
  | 'hasMcpServerRegistered'
  | 'hasWebhookSubscribed'
  | 'hasPaymentMethodAdded';

export interface MarkOnboardingStepDto {
  step: OnboardingStep;
}
