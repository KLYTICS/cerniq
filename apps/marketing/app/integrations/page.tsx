// Full integration ecosystem grid — every category, every surface AEGIS
// attaches to. Static-rendered. Each card shows status; peer-claim hooks
// point at packages/integrations/<slug>/ for parallel work.

import type { Metadata } from 'next';
import { ALL_INTEGRATIONS, BY_CATEGORY, CATEGORY_DESC, CATEGORY_LABELS, STATUS_LABEL, type Integration, type Status } from '../../lib/integrations';

export const metadata: Metadata = {
  title: 'Integrations — AEGIS',
  description:
    'AEGIS attaches as a verification layer to every major LLM provider, agent framework, workflow tool, and cloud platform. 80+ integrations across 9 categories.',
};

const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL ?? 'sales@aegislabs.io';

const STATUS_ORDER: Status[] = ['available', 'beta', 'coming-soon', 'planned'];

function statusOrder(s: Status): number {
  return STATUS_ORDER.indexOf(s);
}

function sortedByStatus(list: Integration[]): Integration[] {
  return [...list].sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.name.localeCompare(b.name));
}

function counts(list: Integration[]): Record<Status, number> {
  return list.reduce<Record<Status, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, { available: 0, beta: 0, 'coming-soon': 0, planned: 0 });
}

export default function IntegrationsPage() {
  const total = ALL_INTEGRATIONS.length;
  const overall = counts(ALL_INTEGRATIONS);

  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Integrations</span>
          <h1>Verify every agent — <span className="accent">wherever it runs.</span></h1>
          <p>
            AEGIS attaches as middleware to every major LLM provider, agent framework, workflow engine,
            and cloud platform. One verification API. Four integration patterns. {total} surfaces and
            growing.
          </p>
          <div className="hero-proof" style={{ marginTop: 24 }}>
            <span>{overall.available} available now</span>
            <span>{overall.beta} in beta</span>
            <span>{overall['coming-soon']} coming soon</span>
            <span>{overall.planned} planned</span>
          </div>
        </div>
      </section>

      {/* ─── Pattern primer ──────────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">How AEGIS Attaches</span>
            <h2>Four patterns cover every surface.</h2>
            <p>
              Whatever runs your agent, AEGIS slots in at the verification boundary — never replacing your
              stack, only adding a cryptographic checkpoint.
            </p>
          </div>
          <div className="layers">
            <article className="layer">
              <span className="layer-tag">Pattern A</span>
              <h3>Tool-call middleware</h3>
              <p>Wraps tool execution in any LLM framework. Verify before run; deny with typed reason.</p>
              <ul><li>OpenAI Responses</li><li>Vercel AI SDK</li><li>LangChain, CrewAI, AutoGen, …</li></ul>
            </article>
            <article className="layer">
              <span className="layer-tag">Pattern B</span>
              <h3>Workflow node</h3>
              <p>Native node/app for no-code platforms. Gate workflow steps on verification.</p>
              <ul><li>n8n</li><li>Zapier · Make · Pipedream</li><li>Power Automate</li></ul>
            </article>
            <article className="layer">
              <span className="layer-tag">Pattern C</span>
              <h3>Cloud function adapter</h3>
              <p>Provider-shaped middleware for serverless and orchestration runtimes.</p>
              <ul><li>AWS Lambda · Step Functions</li><li>Azure Functions · Logic Apps</li><li>Temporal · Inngest · Vercel</li></ul>
            </article>
            <article className="layer">
              <span className="layer-tag">Pattern D</span>
              <h3>Audit sink</h3>
              <p>Signed audit-event exporter into your SIEM or observability platform.</p>
              <ul><li>Datadog · Splunk · Sentinel</li><li>CloudWatch · Sentry · Honeycomb</li><li>Drata · Vanta evidence</li></ul>
            </article>
          </div>
        </div>
      </section>

      {/* ─── Category sections ───────────────────────────────────── */}
      {(Object.keys(BY_CATEGORY) as Array<keyof typeof BY_CATEGORY>).map((cat) => {
        const list = sortedByStatus(BY_CATEGORY[cat]);
        const c = counts(list);
        return (
          <section key={cat} className="reveal" id={cat}>
            <div className="container">
              <div className="section-head">
                <span className="eyebrow">{CATEGORY_LABELS[cat]}</span>
                <h2>{CATEGORY_DESC[cat]}</h2>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-mute)' }}>
                  {list.length} integrations · {c.available} available · {c.beta} beta · {c['coming-soon']} coming · {c.planned} planned
                </p>
              </div>
              <div className="integration-grid">
                {list.map((i) => (
                  <article key={i.slug} className="integration-card">
                    <div className="name">
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: i.status === 'available' ? 'var(--ok)' :
                                    i.status === 'beta' ? 'var(--warn)' :
                                    i.status === 'coming-soon' ? 'var(--accent)' : 'var(--text-mute)',
                      }} />
                      {i.name}
                    </div>
                    <div className="blurb">{i.blurb}</div>
                    <div className="meta">
                      <span className={`status-pill ${i.status}`}>{STATUS_LABEL[i.status]}</span>
                      <span>Pattern {i.pattern}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {/* ─── Standards alignment ─────────────────────────────────── */}
      <section className="reveal" id="standards">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Standards Alignment</span>
            <h2>Built on citable specs. Profiled for the regulated stack.</h2>
            <p>
              AEGIS publishes its standards posture at <code>/.well-known/openid-configuration</code> via
              a FAPI 2.0–aligned discovery profile. Every claim here is either <strong>implemented</strong>{' '}
              (citable to running code + tests today) or <strong>aligned</strong> (roadmapped per the
              published profile §3).
            </p>
          </div>
          <div className="layers">
            <article className="layer">
              <span className="layer-tag">Implemented</span>
              <h3>RFC 8032 — Ed25519</h3>
              <p>EdDSA signature algorithm for all agent + audit signatures.</p>
            </article>
            <article className="layer">
              <span className="layer-tag">Implemented</span>
              <h3>RFC 7517 — JWKS</h3>
              <p>Public-key discovery at <code>/.well-known/jwks.json</code> and audit-signing-key.</p>
            </article>
            <article className="layer">
              <span className="layer-tag">Implemented</span>
              <h3>RFC 9116 — security.txt</h3>
              <p>Coordinated disclosure surface at <code>/.well-known/security.txt</code>.</p>
            </article>
            <article className="layer">
              <span className="layer-tag">Implemented</span>
              <h3>RFC 9396 — RAR</h3>
              <p>OAuth 2.0 Rich Authorization Requests live at <code>POST /v1/verify/rar/evaluate</code>. 4 detail types registered.</p>
            </article>
            <article className="layer">
              <span className="layer-tag">Aligned</span>
              <h3>FAPI 2.0</h3>
              <p>Discovery profile published + RAR implemented. Token-binding + DPoP on the roadmap.</p>
            </article>
            <article className="layer">
              <span className="layer-tag">Aligned</span>
              <h3>RFC 9449 — DPoP</h3>
              <p>Demonstrating Proof-of-Possession scaffold landed; promotion gated.</p>
            </article>
            <article className="layer">
              <span className="layer-tag">Aligned</span>
              <h3>RFC 9421 — HTTP Message Signatures</h3>
              <p>Roadmap — paired with the verify hot-path edge port (Phase 3).</p>
            </article>
            <article className="layer">
              <span className="layer-tag">Aligned</span>
              <h3>NIST AI Agent Identity</h3>
              <p>Following NIST&rsquo;s 2026 guidance as it publishes; first to map.</p>
            </article>
          </div>
        </div>
      </section>

      {/* ─── Build-with-us CTA ───────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Don&rsquo;t see your stack? Build the integration with us.</h2>
              <p>
                The verification API is stable, the pattern catalog is open, and the scaffolding under
                <code style={{ color: 'var(--accent)' }}> packages/integrations/ </code>
                is ready to claim. Talk to engineering — first integrations ship with paid-tier credits.
              </p>
            </div>
            <div className="cta-band-actions">
              <a
                href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Integration request — ')}`}
                className="btn btn-primary"
              >
                Request an integration →
              </a>
              <a href="/" className="btn btn-ghost">Back to overview</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
