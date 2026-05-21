// PastDueBanner — red banner shown only when subscriptionStatus is
// past_due / unpaid. Includes an inline ManageButton so the user can
// update their card without scrolling.

import type { ReactElement } from 'react';

import type { PlanSummary } from '../../../lib/api-client';
import { isPastDue } from '../../../lib/billing';

import { ManageButton } from './ManageButton';

interface Props {
  plan: PlanSummary;
}

export function PastDueBanner({ plan }: Props): ReactElement | null {
  if (!isPastDue(plan)) return null;
  return (
    <div
      role="alert"
      aria-label="Payment past due"
      style={{
        border: '1px solid #5a2222',
        background: '#1a0d0d',
        color: '#ff8a8a',
        padding: '10px 14px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        fontSize: 13,
      }}
    >
      <span>
        <strong style={{ marginRight: 8 }}>Payment failed</strong>
        Update your card to keep your <code>{plan.planTier}</code> tier active.
      </span>
      <ManageButton label="Update card ▶" ariaLabel="Update payment method" />
    </div>
  );
}
