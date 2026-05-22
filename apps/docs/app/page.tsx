import Link from 'next/link';

import { PricingTable } from '@/components/live/pricing-table';
import { SdkVersionBadges } from '@/components/live/sdk-version-badges';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <p className="mb-6 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--okoro-cyan)]">
        OKORO · Documentation
      </p>
      <h1 className="mb-8 text-5xl font-semibold leading-none tracking-tight md:text-7xl">
        Neutral verification for{' '}
        <span className="okoro-aurora">autonomous agents</span>
      </h1>
      <p className="mb-10 max-w-2xl text-lg leading-relaxed text-[var(--okoro-fog)]">
        OKORO holds only public keys, signs only what it observed, and remains
        protocol-, vendor-, and model-neutral. Every page in this documentation
        renders directly from the running platform — pricing, denial
        precedence, and SDK versions cannot drift from production.
      </p>
      <div className="mb-16 flex flex-wrap gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-[var(--okoro-cyan)] px-5 py-3 font-semibold text-[var(--okoro-obsidian)] transition hover:brightness-110"
        >
          Read the quickstart
        </Link>
        <Link
          href="/docs/api/agents"
          className="rounded-lg border border-[var(--okoro-mist)] px-5 py-3 text-[var(--okoro-halo)] transition hover:border-[var(--okoro-cyan)]"
        >
          API reference
        </Link>
      </div>

      <section className="mb-16">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--okoro-fog)]">
          SDKs
        </p>
        <SdkVersionBadges />
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-semibold">Live pricing</h2>
        <p className="mb-6 text-[var(--okoro-fog)]">
          Fetched at request time from{' '}
          <code className="rounded bg-[var(--okoro-graphite)] px-1.5 py-0.5 font-mono text-sm">
            /.well-known/pricing.json
          </code>{' '}
          — the same endpoint the dashboard uses (Round 23). When the operator
          changes a price in <code>plans.ts</code>, this page reflects it
          within the next ISR window. No second deploy required.
        </p>
        <PricingTable />
      </section>
    </main>
  );
}
