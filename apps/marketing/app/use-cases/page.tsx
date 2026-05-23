// /use-cases — vertical-focused page tying AEGIS to specific industry
// problems. Each card links to a real example/ directory or, for the
// intent-manifest Phase-2 financial verticals (peer 115e12ee), routes to
// sales until the examples promote into the public examples/ tree.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Use cases — AEGIS on financial rails first',
  description:
    'AEGIS in production: ACP-aligned fintech payments, ISO 20022 treasury wires, FINRA Rule 3110 broker-dealer order entry, banking rails, reconciliation. Each financial vertical maps to a runnable example using Intent Manifest + FAPI 2.0 JAR + OAuth 2.0 RAR.',
};

const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL ?? 'sales@aegislabs.io';
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/klytics/aegis';

interface UseCase {
  vertical: 'financial' | 'operational';
  title: string;
  problem: string;
  solution: string;
  primitives: string[];
  status: 'available' | 'beta' | 'coming-soon';
  /** Path under `examples/` or external URL. Falls back to mailto when undefined. */
  exampleHref: string;
}

const USE_CASES: UseCase[] = [
  // ── Financial verticals ───────────────────────────────────────
  {
    vertical: 'financial',
    title: 'Agentic Commerce (ACP) Payments',
    problem: 'AI shopping agents executing ACP payments on behalf of users need merchant-bound, amount-capped, single-use authorization that the merchant can verify locally before the charge runs.',
    solution: 'Intent manifest declares action + merchant + amount cap + max-calls + strict reconciliation before the charge fires. The merchant calls verifyIntent({ manifest, actuals, publicKeysByKid }) from @aegis/verifier-rp — closed-enum outcome, no AEGIS API in the request path.',
    primitives: ['Intent manifest', 'ACP-compatible', '@aegis/verifier-rp', 'Strict reconciliation'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/intent-fintech-acp`,
  },
  {
    vertical: 'financial',
    title: 'Banking Rails',
    problem: 'Core banking actions (transfers, account opens, KYC verifications) flowing from AI agents need provable identity + revocable scope.',
    solution: 'L1 identity (Ed25519) binds the agent to a verified principal. L2 policy time-bounds the action. L4 audit publishes a signed chain for examiners.',
    primitives: ['Identity (L1)', 'Policy (L2)', 'Audit (L4)', 'KMS adapters'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/banking-rails`,
  },
  {
    vertical: 'financial',
    title: 'Reconciliation',
    problem: 'Intent declared at request time often diverges from the actual outcome. Compliance needs a paper trail of the delta.',
    solution: 'POST /v1/intent + /v1/intent/{id}/actuals reconcile declared vs actual; mismatches emit audit events and BATE signals.',
    primitives: ['Intent manifest', 'Reconciliation', 'BATE drift signal'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/reconciliation`,
  },
  {
    vertical: 'financial',
    title: 'Treasury Operations (ISO 20022)',
    problem: 'AI treasury agents executing SWIFT MT103 / ISO 20022 pacs.008 wires need cryptographic provenance, beneficiary binding, and tolerance-aware reconciliation against the settlement notification.',
    solution: 'Intent manifest binds the pacs.008 message to a signed pre-execution declaration: action, amount cap, beneficiary (encoded in merchantId), and a graduated reconciliation tolerance. Relying-party verifyIntent() returns a closed-enum outcome — no AEGIS round-trip needed at execution time.',
    primitives: ['Intent manifest', 'ISO 20022 pacs.008', 'Graduated reconciliation', '@aegis/verifier-rp'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/intent-treasury-iso20022`,
  },
  {
    vertical: 'financial',
    title: 'Broker-Dealer (FINRA Rule 3110)',
    problem: 'AI portfolio-rebalancing agents placing equity orders require FINRA Rule 3110 supervision evidence — signed before the order hits the OMS, reconciled against the fill report, retained for the regulator-mandated window.',
    solution: 'Intent manifest issues a signed cryptographic supervision trail keyed on venue + symbol + qty + limit price + strict (zero-tolerance) reconciliation. The broker-dealer’s relying-party verifies offline; the hash-chained audit row becomes the Rule 3110 supervision artifact.',
    primitives: ['Intent manifest', 'FINRA Rule 3110', 'Strict reconciliation', 'Hash-chained audit'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/intent-broker-dealer-finra`,
  },
  // ── Operational use cases ─────────────────────────────────────
  {
    vertical: 'operational',
    title: 'AI Platform Tool-Call Governance',
    problem: 'Multi-tenant AI platforms hosting customer agents need per-tool, per-tenant authorization without operating an in-house policy engine.',
    solution: 'AEGIS sits between the platform and the tool. Tool-scoped verification (post-2026-05 MCP bridge hardening) makes "allow read_file but not write_file" trivial.',
    primitives: ['MCP bridge', 'Per-tool action scoping', 'L2 policy'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/ai-platform-tool-call`,
  },
  {
    vertical: 'operational',
    title: 'SaaS Seat Provisioning',
    problem: 'When an agent provisions a SaaS seat, the buyer needs proof of who triggered it for SOC 2 evidence.',
    solution: 'Verify wraps the provisioning call; audit row carries the principal binding; SOC 2 evidence collection auto-pulls from the audit chain.',
    primitives: ['Verify path', 'Audit chain', 'SOC 2 evidence pull'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/saas-seat-provisioning`,
  },
  {
    vertical: 'operational',
    title: 'Agentic Commerce Protocol (ACP) Bridge',
    problem: 'ACP standardized payment, but identity was delegated to implementers. Every ACP merchant needs a verification layer.',
    solution: 'AEGIS is that layer. The ACP bridge example shows the full agent → AEGIS → merchant flow with signed receipts on both sides.',
    primitives: ['ACP-compatible', 'L1 identity', 'Intent manifest'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/acp-bridge`,
  },
  {
    vertical: 'operational',
    title: 'CI/CD Agent Preflight',
    problem: 'AI agents shipping code (PR creation, merge, deploy) bypass normal employee identity. CI needs a gate that checks the agent before the workflow.',
    solution: 'Drop-in GitHub Action verifies the agent token + action before any subsequent step runs. Audit chain becomes the deploy provenance.',
    primitives: ['GitHub Action', 'Verify path', 'SLSA provenance'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/preflight-github-action`,
  },
  {
    vertical: 'operational',
    title: 'Relying-Party Verification',
    problem: 'A relying party (the service the agent acts on) needs offline-verifiable proof that AEGIS approved the action — without trusting AEGIS at request time.',
    solution: '@aegis/verifier-rp lets the relying party verify the AEGIS signature locally against the published JWKS. No round-trip; no AEGIS uptime dependency.',
    primitives: ['@aegis/verifier-rp', 'JWKS (RFC 7517)', 'Edge-runtime safe'],
    status: 'available',
    exampleHref: `${REPO_URL}/tree/main/examples/relying-party-verifier`,
  },
];

function statusDot(status: UseCase['status']): string {
  if (status === 'available') return 'var(--ok)';
  if (status === 'beta') return 'var(--warn)';
  return 'var(--accent)';
}

function statusLabel(status: UseCase['status']): string {
  return status === 'coming-soon' ? 'Coming soon' : status === 'beta' ? 'Beta' : 'Available';
}

const FINANCIAL = USE_CASES.filter((c) => c.vertical === 'financial');
const OPERATIONAL = USE_CASES.filter((c) => c.vertical === 'operational');

function UseCaseCard({ uc }: { uc: UseCase }) {
  return (
    <article className="layer" style={{ minHeight: 280 }}>
      <span className="layer-tag" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{uc.vertical === 'financial' ? 'Financial' : 'Operational'}</span>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 9,
          padding: '2px 6px', borderRadius: 2,
          background: 'var(--accent-wash)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot(uc.status) }} />
          {statusLabel(uc.status)}
        </span>
      </span>
      <h3>{uc.title}</h3>
      <p style={{ fontSize: 13, marginBottom: 8 }}>
        <strong style={{ color: 'var(--text)' }}>Problem.</strong> {uc.problem}
      </p>
      <p style={{ fontSize: 13, marginBottom: 12 }}>
        <strong style={{ color: 'var(--text)' }}>Solution.</strong> {uc.solution}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto', marginBottom: 12 }}>
        {uc.primitives.map((p) => (
          <span key={p} className="mono" style={{
            fontSize: 10, padding: '2px 6px',
            border: '1px solid var(--border-strong)', borderRadius: 2,
            color: 'var(--text-dim)', background: 'var(--bg)',
          }}>
            {p}
          </span>
        ))}
      </div>
      <div>
        <a href={uc.exampleHref} className="mono" style={{ fontSize: 11 }}>
          {uc.status === 'coming-soon' ? 'Talk to us →' : 'View example →'}
        </a>
      </div>
    </article>
  );
}

export default function UseCasesPage() {
  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Use Cases · Financial rails first</span>
          <h1>Where AI agents touch <span className="accent">money.</span></h1>
          <p>
            AEGIS leads with the verticals where the regulators are already asking the questions
            our audit chain answers — ACP-aligned payments, ISO 20022 treasury wires, FINRA Rule 3110
            broker-dealer order entry. Each card below maps to a runnable example directory; the
            financial three are end-to-end intent-manifest scenarios with cryptographic supervision
            built in.
          </p>
          <div className="hero-proof" style={{ marginTop: 24 }}>
            <span>{FINANCIAL.filter((c) => c.status === 'available').length}/{FINANCIAL.length} financial verticals — runnable today</span>
            <span>{OPERATIONAL.filter((c) => c.status === 'available').length}/{OPERATIONAL.length} operational patterns — same primitives</span>
            <span>Intent Manifest · FAPI 2.0 JAR · OAuth 2.0 RAR</span>
          </div>
        </div>
      </section>

      {/* ─── Financial verticals ─────────────────────────────────── */}
      <section className="reveal" id="financial">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Financial Verticals</span>
            <h2>Standards your regulator already trusts.</h2>
            <p>
              Each of the five cards below names a regulator the buyer&rsquo;s compliance team already
              answers to (ACP issuer, ISO 20022 settlement counterparty, FINRA Rule 3110 supervisor,
              federal banking examiner, SOC 2 audit). The intent-manifest scenarios (ACP / ISO 20022 /
              FINRA) are end-to-end runnable examples; banking-rails and reconciliation are the
              underlying L1+L2+L4 patterns those scenarios compose from.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            {FINANCIAL.map((uc) => <UseCaseCard key={uc.title} uc={uc} />)}
          </div>
        </div>
      </section>

      {/* ─── Operational use cases ───────────────────────────────── */}
      <section className="reveal" id="operational">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Operational Use Cases</span>
            <h2>Wherever agents touch infrastructure.</h2>
            <p>
              SaaS, AI platforms, CI/CD, and relying-party verification all share the same problem:
              non-human actors operating on systems built for humans. AEGIS fills the gap with one
              verification API and four integration patterns.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            {OPERATIONAL.map((uc) => <UseCaseCard key={uc.title} uc={uc} />)}
          </div>
        </div>
      </section>

      {/* ─── CTA band ────────────────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Don&rsquo;t see your vertical?</h2>
              <p>
                The patterns are general — financial, healthcare, government, education, defense all
                map cleanly to L1/L2/L3/L4. Talk to us about your specific compliance shape; first
                vertical integrations ship with paid-tier credits.
              </p>
            </div>
            <div className="cta-band-actions">
              <a
                href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('AEGIS — Vertical use case inquiry')}`}
                className="btn btn-primary"
              >
                Talk to us →
              </a>
              <a href="/integrations" className="btn btn-ghost">View integrations</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
