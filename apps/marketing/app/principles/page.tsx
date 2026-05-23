// /principles — public mirror of docs/NON_GOALS.md.
//
// Most vendors hide their refusals. AEGIS publishes them. This page is the
// procurement-grade artifact for the CISO question "what are you committing
// to NOT build?" The escape hatch on every refusal is documented inline so
// a future-reversal happens *because the reasoning changed*, not because
// the original reasoning was forgotten.
//
// Parity: the REFUSALS array below is the source of truth this page renders.
// A planned cross-package test (tests/cross-package/marketing-non-goals-parity.spec.ts)
// asserts each refusal's slug + title matches the corresponding § header in
// docs/NON_GOALS.md. Adding a refusal to the doc without updating this array
// (or vice versa) will fail CI.

import type { Metadata } from 'next';

const REPO = 'https://github.com/klytics/aegis/blob/main';
const NON_GOALS_DOC = `${REPO}/docs/NON_GOALS.md`;

export const metadata: Metadata = {
  title: 'Principles — AEGIS · what we will not build',
  description:
    'Most security vendors hide their refusals. AEGIS publishes them. Six architectural refusals — configurable precedence, additional first-party SDKs, multi-cloud edge, alternative canonicalization, customer-tunable trust weights, "universal AI agent" positioning — each with its tempting moment and escape hatch documented in writing. The procurement-grade answer to "what are you committing to NOT build?"',
  openGraph: {
    title: 'AEGIS Principles — what we will not build',
    description:
      'Published refuse-to-build register. Every refusal carries its tempting moment and escape hatch in writing.',
    type: 'article',
  },
};

interface Refusal {
  slug: string;
  section: string;
  title: string;
  oneLine: string;
  whyRefused: string;
  tempting: string;
  escape: string;
}

/**
 * Exported so the parity test can assert sync with docs/NON_GOALS.md.
 * Section numbers track the doc's heading hierarchy.
 */
export const REFUSALS: readonly Refusal[] = [
  {
    slug: 'configurable-precedence',
    section: '1.1',
    title: 'Configurable denial precedence',
    oneLine: 'No knob to reorder which check fires first.',
    whyRefused:
      'The constancy of denial precedence is what makes audit reports cross-customer comparable. SPEND_LIMIT_EXCEEDED at position 9 means the same thing for Customer A and Customer B. That property is what lets third-party auditors generalize and lets behavioral trust signals aggregate across the population.',
    tempting:
      'A fintech customer with strong fraud-modeling instincts asks "can spend checks fire before signature checks for our flow?" Sensible in isolation — destroys the comparability moat the moment it ships.',
    escape:
      'API versioning, not configuration. A future /v2/verify can change the order; both endpoints run during the deprecation window.',
  },
  {
    slug: 'additional-sdk-languages',
    section: '1.2',
    title: 'Additional first-party SDK languages',
    oneLine: 'TypeScript and Python only. No Go, Java, Ruby, .NET, Rust SDK.',
    whyRefused:
      'TS + Py covers ~95% of the agent-runtime ecosystem. Adding a third first-party SDK without a named customer who is blocked on it commits AEGIS to language-specific bug-fixing, security-patching, and contract-parity testing in perpetuity. Public packages are forever once shipped; the maintenance tax compounds.',
    tempting:
      'A prospect says "we\'d integrate if you had a Go SDK." Often the constraint is "we need official support," not "TypeScript bindings won\'t run."',
    escape:
      'A named paid design-partner whose stack genuinely cannot consume the OpenAPI spec directly — plus an internal staffing commitment to maintain the new SDK for at least 24 months.',
  },
  {
    slug: 'multi-cloud-edge',
    section: '1.3',
    title: 'Multi-cloud edge enforcement',
    oneLine: 'Cloudflare edge only. No AWS Lambda@Edge, Fastly Compute, or Azure Front Door port.',
    whyRefused:
      'Single-cloud edge is sufficient for sub-50ms p99 in every region AEGIS serves. Multi-cloud edge doubles the operational surface (two runtimes, two deploy pipelines, two sets of incidents to track) for a benefit no customer is asking for. The verify algorithm is portable by design, so when a customer\'s contract genuinely requires their edge provider, the algorithm moves cleanly.',
    tempting:
      'A prospect with an existing AWS-only or Azure-only edge story asks if AEGIS can run on theirs.',
    escape:
      'First customer whose contract requires a specific non-Cloudflare edge AND who pays for the integration.',
  },
  {
    slug: 'alternative-canonicalization',
    section: '1.4',
    title: 'Alternative canonicalization formats',
    oneLine: 'One canonical JSON format. No RFC 8785 (JCS) or customer-supplied alternatives.',
    whyRefused:
      'Canonicalization is a single bit of cryptographic agreement between signer and verifier. Adding a second canonical format means every signature carries an implicit format-version field, every verifier must accept both, and any drift in canonicalization libraries becomes a security-grade bug.',
    tempting:
      'A customer cites RFC 8785 as a "standard." The standard is real and the citation is correct, but compliance buys interoperability with other RFC 8785 implementations — and no other implementation shares our signed corpus.',
    escape:
      'A non-AEGIS-built third-party verifier (the customer refuses to use @aegis/audit-verifier and builds their own from scratch). At that point the format must be a published standard with vetted libraries.',
  },
  {
    slug: 'customer-tunable-trust-weights',
    section: '1.5',
    title: 'Customer-tunable behavioral trust weights',
    oneLine: 'BATE signal weights are global, not per-tenant.',
    whyRefused:
      'Trust scores are only meaningful if they are comparable across customers. A fraud-report signal worth -200 in one tenant and -50 in another produces incomparable scores and defeats the cross-tenant aggregation that makes the score useful in the first place.',
    tempting:
      'A relying party asks "can we make velocity anomalies count less for our flow, since we expect high velocity?" The right answer is to adjust their threshold for accepting low scores — a per-policy field — not the score itself.',
    escape:
      'Per-policy thresholds (already supported) cover most "we have unusual traffic" requests. Re-weighted scoring, if ever needed, ships as a separately-namespaced score — additive and disclosed, never a mutation of the headline score.',
  },
  {
    slug: 'universal-agent-positioning',
    section: '3.1',
    title: '"Universal AI agent identity" positioning',
    oneLine: 'Regulated financial services is the vertical. Not "any agent, anywhere."',
    whyRefused:
      'The codebase has already chosen its vertical through its examples surface — FINRA broker-dealer, ISO 20022 treasury, banking-rails, fintech-payments, ACP fintech, reconciliation. Positioning AEGIS as universal pulls discovery traffic from audiences who can\'t justify the engineering AEGIS has actually built (audit-chain forensics, FAPI 2.0 conformance, KMS abstraction).',
    tempting:
      'A general-purpose AI agent framework gains press attention. The temptation is to position AEGIS as "verify for [framework]." This optimizes for traffic; it does not optimize for procurement-shaped customers.',
    escape:
      'A specific market signal — paying customer in a non-regulated vertical, strategic partnership with a major agent-framework vendor, or a deliberate Phase-2 expansion — earns the universal framing its keep.',
  },
] as const;

export default function PrinciplesPage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Principles · what we will not build</span>
          <h1>
            Most vendors hide their refusals.{' '}
            <span className="accent">We publish ours.</span>
          </h1>
          <p>
            Six architectural refusals, in writing. Each one carries the
            tempting moment we expect to be asked about and the escape hatch
            that would make us reverse course. The point is procurement-grade
            durability — when a CISO asks &ldquo;what are you committing to
            NOT build?&rdquo; the answer is here, signed by the codebase
            itself (parity-tested against{' '}
            <a href={NON_GOALS_DOC} target="_blank" rel="noreferrer">
              <code style={{ background: 'var(--bg-elev)', padding: '2px 6px', borderRadius: 3 }}>
                docs/NON_GOALS.md
              </code>
            </a>
            ).
          </p>
          <div className="hero-proof" style={{ marginTop: 16 }}>
            <span>Six refusals published</span>
            <span>Tempting moment named for each</span>
            <span>Escape hatch documented inline</span>
            <span>Parity-tested with the source doc</span>
          </div>
        </div>
      </section>

      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Product surfaces</span>
            <h2>Five refusals about what the engine will and will not flex.</h2>
            <p>
              Each refusal preserves a property that&rsquo;s only valuable when
              it&rsquo;s constant across customers — comparability of audit
              reports, aggregability of behavioral signals, single-format
              cryptographic agreement, finite SDK maintenance surface.
            </p>
          </div>

          <div className="layers" style={{ marginTop: 24 }}>
            {REFUSALS.filter((r) => r.section.startsWith('1.')).map((r) => (
              <RefusalCard key={r.slug} refusal={r} />
            ))}
          </div>
        </div>
      </section>

      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Positioning</span>
            <h2>One refusal about who we are not for.</h2>
            <p>
              The codebase has already chosen regulated financial services
              through its examples surface. Marketing positioning follows what
              the code actually says.
            </p>
          </div>

          <div className="layers" style={{ marginTop: 24 }}>
            {REFUSALS.filter((r) => r.section.startsWith('3.')).map((r) => (
              <RefusalCard key={r.slug} refusal={r} />
            ))}
          </div>
        </div>
      </section>

      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Read the full text</span>
            <h2>Every refusal in writing, with the reasoning history.</h2>
            <p>
              The summaries above are intentionally tight. The full doc carries
              the rejected alternatives, the cross-references back to specific
              ADRs that motivated each refusal, and the procedure for retiring
              a refusal if its escape hatch ever fires.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
              <a href={NON_GOALS_DOC} className="btn btn-primary" target="_blank" rel="noreferrer">
                docs/NON_GOALS.md (full text) →
              </a>
              <a href="/security" className="btn btn-ghost">
                Security posture →
              </a>
              <a href="/try" className="btn btn-ghost">
                Verify in your browser →
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function RefusalCard({ refusal: r }: { refusal: Refusal }): React.ReactElement {
  return (
    <div className="layer">
      <span className="layer-tag">{`§ ${r.section}`}</span>
      <h3 style={{ marginTop: 12, marginBottom: 6 }}>{r.title}</h3>
      <p style={{ color: 'var(--text)', fontWeight: 500, marginBottom: 14 }}>
        {r.oneLine}
      </p>
      <p style={{ fontSize: 13, marginBottom: 10 }}>
        <strong style={{ color: 'var(--text)' }}>Why refused.</strong> {r.whyRefused}
      </p>
      <p style={{ fontSize: 13, marginBottom: 10 }}>
        <strong style={{ color: 'var(--text)' }}>Tempting moment.</strong> {r.tempting}
      </p>
      <p style={{ fontSize: 13 }}>
        <strong style={{ color: 'var(--text)' }}>Escape hatch.</strong> {r.escape}
      </p>
    </div>
  );
}
