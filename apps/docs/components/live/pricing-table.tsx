import 'server-only';

type ApiTier = {
  id: string;
  name: string;
  price_usd: number | null;
  included_verifies: number | null;
  included_verifies_period: string;
  overage_usd_per_verify: number | null;
};

type ApiPricing = {
  spec_version: string;
  generated_at: string;
  tiers: ApiTier[];
};

type FetchResult =
  | { source: 'api'; data: ApiPricing }
  | { source: 'fallback'; reason: string };

async function fetchPricing(): Promise<FetchResult> {
  const base = process.env.AEGIS_API_BASE_URL;
  if (!base) return { source: 'fallback', reason: 'AEGIS_API_BASE_URL unset' };
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/.well-known/pricing.json`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { source: 'fallback', reason: `HTTP ${res.status}` };
    const data = (await res.json()) as ApiPricing;
    if (!Array.isArray(data?.tiers) || data.tiers.length === 0) {
      return { source: 'fallback', reason: 'missing or empty tiers field' };
    }
    return { source: 'api', data };
  } catch (err) {
    return { source: 'fallback', reason: err instanceof Error ? err.message : 'fetch error' };
  }
}

// Build-time mirror — kept in lockstep with apps/api/src/modules/billing/plans.ts
// by the cross-package parity test. When that test breaks, this constant is the
// thing to update; do not modify wire shapes here.
const FALLBACK_TIERS: ApiTier[] = [
  {
    id: 'FREE',
    name: 'Free Trial',
    price_usd: 0,
    included_verifies: 10_000,
    included_verifies_period: 'lifetime',
    overage_usd_per_verify: null,
  },
  {
    id: 'DEVELOPER',
    name: 'Developer',
    price_usd: 49,
    included_verifies: 50_000,
    included_verifies_period: 'month',
    overage_usd_per_verify: 0.0008,
  },
  {
    id: 'TEAM',
    name: 'Team',
    price_usd: 299,
    included_verifies: 500_000,
    included_verifies_period: 'month',
    overage_usd_per_verify: 0.0008,
  },
  {
    id: 'SCALE',
    name: 'Scale',
    price_usd: 1_499,
    included_verifies: 5_000_000,
    included_verifies_period: 'month',
    overage_usd_per_verify: 0.0008,
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    price_usd: null,
    included_verifies: null,
    included_verifies_period: 'custom',
    overage_usd_per_verify: null,
  },
];

function fmtPrice(t: ApiTier): string {
  if (t.price_usd === null) return 'Custom';
  if (t.price_usd === 0) return '$0';
  return `$${t.price_usd.toLocaleString()} / mo`;
}

function fmtVerifies(t: ApiTier): string {
  if (t.included_verifies === null) return 'Negotiated';
  const v = t.included_verifies;
  const formatted = v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1_000 ? `${v / 1_000}K` : `${v}`;
  return `${formatted} / ${t.included_verifies_period}`;
}

function fmtOverage(t: ApiTier): string {
  if (t.overage_usd_per_verify === null) return t.id === 'ENTERPRISE' ? 'Negotiated' : '—';
  return `$${t.overage_usd_per_verify.toFixed(4)} / verify`;
}

export async function PricingTable() {
  const result = await fetchPricing();
  const tiers = result.source === 'api' ? result.data.tiers : FALLBACK_TIERS;
  return (
    <div className="my-6">
      <div className="overflow-hidden rounded-lg border border-[var(--aegis-mist)] bg-[var(--aegis-ink)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--aegis-steel)] text-xs uppercase tracking-wider text-[var(--aegis-fog)]">
            <tr>
              <th className="px-4 py-3 text-left">Tier</th>
              <th className="px-4 py-3 text-left">Price</th>
              <th className="px-4 py-3 text-left">Verifies</th>
              <th className="px-4 py-3 text-left">Overage</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id} className="border-t border-[var(--aegis-mist)]">
                <td className="px-4 py-3 font-mono text-[var(--aegis-cyan)]">{t.name}</td>
                <td className="px-4 py-3 font-mono">{fmtPrice(t)}</td>
                <td className="px-4 py-3 font-mono">{fmtVerifies(t)}</td>
                <td className="px-4 py-3 font-mono">{fmtOverage(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        className="mt-2 font-mono text-xs text-[var(--aegis-shadow)]"
        data-source={result.source}
        data-testid="pricing-provenance"
      >
        {result.source === 'api'
          ? `Live · /.well-known/pricing.json · spec ${result.data.spec_version} · generated ${result.data.generated_at}`
          : `Fallback · ${result.reason}`}
      </p>
    </div>
  );
}
