// Bloomberg-density feature matrix. One row per feature, one column per
// tier. Boolean cells render as ✓ / — to match operator's UI bar.
//
// Round 23: tiers + rows now come from `resolvePricing()` (server-side)
// instead of the hardcoded `lib/pricing.ts` table. Falls back to the
// hardcoded copy when the API is unreachable. Component itself is dumb.

import type { ReactElement } from 'react';

import type { FeatureRow, PublicTier } from '../../../lib/pricing';

import { TierColumn } from './TierColumn';

function renderCell(value: string | boolean): ReactElement | string {
  if (typeof value === 'boolean') {
    return value ? <span aria-label="included">✓</span> : <span className="dim" aria-label="not included">—</span>;
  }
  return value;
}

export function FeatureMatrix({
  tiers,
  rows,
}: {
  tiers: readonly PublicTier[];
  rows: readonly FeatureRow[];
}): ReactElement {
  return (
    <table className="data-table dense pricing-table" aria-label="AEGIS pricing tiers and features">
      <caption className="visually-hidden">
        AEGIS pricing tiers, monthly cost, included verifies, agents, audit retention, BATE
        access, webhooks, and SLA targets.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="dim">{/* feature label column */}</th>
          {tiers.map((tier) => (
            <th key={tier.id} scope="col">
              <TierColumn tier={tier} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="dim">{row.label}</th>
            {row.cells.map((cell, idx) => {
              const tierId = tiers[idx]?.id ?? `col-${idx}`;
              return (
                <td key={tierId} className="mono">
                  {renderCell(cell)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
