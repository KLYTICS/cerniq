// AEGIS marketing landing — cinematic single-page. Mostly server-rendered;
// client islands for the verify-burst, live counter, and code typewriter.

import { AuditChain } from '../components/AuditChain';
import { CodeTypewriter } from '../components/CodeTypewriter';
import { Hero } from '../components/Hero';
import { ProviderMarquee } from '../components/ProviderMarquee';
import { TrustGauge } from '../components/TrustGauge';
import { BY_CATEGORY, CATEGORY_LABELS } from '../lib/integrations';

const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL ?? 'sales@aegislabs.io';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'https://app.aegis.klytics.io';

// Why mailto for every paid plan: the self-serve checkout path is not wired
// end-to-end. apps/api/src/modules/billing/stripe.service.ts:553-559 requires
// session.metadata.principalId, but Stripe Payment Links cannot inject that;
// no email service exists in apps/api/; the webhook handler does not issue
// API keys on checkout. Until those three gaps close (and Auth0 v4 lands per
// operator decision #5), any "Start Free" button that takes money without
// fulfillment is a fraud surface. See docs/LAUNCH_RUNBOOK.md § Phase 0.
function planMailto(planLabel: string): string {
  return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`AEGIS — ${planLabel} plan`)}`;
}

const LINKS = {
  developer:  planMailto('Developer'),
  team:       planMailto('Team'),
  scale:      planMailto('Scale'),
  enterprise: planMailto('Enterprise inquiry'),
};

// Featured 12 for the home-page integration preview — mix of LLM + framework + cloud + workflow
const FEATURED_PREVIEW_SLUGS = [
  'openai', 'anthropic', 'vercel-ai-sdk', 'langchain',
  'aws', 'azure', 'gcp', 'cloudflare',
  'n8n', 'zapier', 'temporal', 'inngest',
];

export default function Landing() {
  // Resolve the preview integrations by slug
  const all = Object.values(BY_CATEGORY).flat();
  const featured = FEATURED_PREVIEW_SLUGS
    .map((slug) => all.find((i) => i.slug === slug))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));

  return (
    <>
      <Hero primaryHref={LINKS.developer} />

      <ProviderMarquee />

      {/* ─── Problem / threat framing ────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">The Trillion-Dollar Attack Surface</span>
            <h2>AI agents act on the world. They cannot prove who they are.</h2>
            <p>
              Every browser an agent touches, every API it calls, every dollar it moves passes through
              systems that were never designed for non-human actors. OAuth proves humans. SAML proves
              employees. None of it proves an AI agent — what it&rsquo;s allowed to do, on behalf of which
              principal, or whether its behavior is auditable.
            </p>
            <p style={{ marginTop: 16 }}>
              <strong style={{ color: 'var(--text)' }}>AEGIS is the cryptographic checkpoint.</strong>{' '}
              Neutral. Vendor-agnostic. Held to public keys only. Sits between every agent and every
              service it acts on, and signs the truth of what happened.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Wedge value-props ────────────────────────────────────
          Per wedge doc §11 (~/Desktop/AEGIS_WEDGE_FINANCIAL_STANDARDS_2026-05-15.md):
          three specific value props that map to docs/spec/05_FAPI_2_0_PROFILE.md
          § 5 ALLOWED-claims table. No DPoP / RFC 9421 / ISO 20022 present-tense
          claims (those are roadmap per §3.5, §3.6 of the FAPI profile).
      */}
      <section id="layers" className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Why financial-rail teams ship on AEGIS</span>
            <h2>Standards your security team already knows. Audit your regulator already trusts.</h2>
            <p>
              AEGIS is not a bespoke agent protocol. It is the standards layer between AI agents and the
              financial APIs they call — FAPI 2.0-shaped, auditor-ready by construction, and built from
              published RFCs your reviewers can grep against in a CVE database.
            </p>
          </div>

          <div className="layers">
            <article className="layer">
              <span className="layer-tag">FAPI 2.0-shaped</span>
              <h3>Looks like a Plaid request, not a bespoke protocol.</h3>
              <p>
                Your agent&rsquo;s API call carries an RFC 9101 JAR + RFC 9396 RAR scope. Your security
                team already knows how to review it; your relying-party already knows how to verify it.
              </p>
              <ul>
                <li>RFC 9101 JAR — aud/iss/iat operator-gated</li>
                <li>RFC 9396 RAR — 4 detail types live</li>
                <li>RFC 8414 AS metadata discoverable</li>
              </ul>
            </article>

            <article className="layer">
              <span className="layer-tag">Auditor-ready out of the box</span>
              <h3>Append-only hash chain. Offline-verifiable on a laptop.</h3>
              <p>
                Every verified action emits a signed AuditEvent in our hash chain. Export a Parquet +
                manifest tarball (ADR-0015) and your SOC 2 auditor verifies it without an AEGIS
                round-trip. SR 11-7 model-governance evidence comes for free.
              </p>
              <ul>
                <li>Ed25519-signed per row</li>
                <li>Parquet + manifest export</li>
                <li>Offline corpus verifier in the SDK</li>
              </ul>
            </article>

            <article className="layer">
              <span className="layer-tag">Standards, not inventions</span>
              <h3>Seven RFCs implemented. Two more on the roadmap.</h3>
              <p>
                Ed25519 (RFC 8032), OAuth 2.0 RAR (RFC 9396), FAPI 2.0 JAR (RFC 9101), OAuth 2.0 AS
                Metadata (RFC 8414), OAuth 2.0 error envelope (RFC 6749 § 5.2), JWKS (RFC 7517),
                security.txt (RFC 9116). DPoP (RFC 9449) and HTTP Message Signatures (RFC 9421) on
                the roadmap. Every primitive maps to a published standard with a CVE channel.
              </p>
              <ul>
                <li>Every claim grep-verifiable</li>
                <li>No bespoke crypto</li>
                <li>Discoverable at /.well-known/</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* ─── BATE + Audit live visualizations ────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Behavioral Attestation + Signed Audit</span>
            <h2>Trust scored. Chain signed. Both queryable.</h2>
            <p>
              Every verified action mutates the agent&rsquo;s trust score and appends to a hash-chained
              audit log. Both surfaces are observable end-to-end — by you, by your customers, by
              auditors, offline.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 24, alignItems: 'start' }}>
            <TrustGauge score={850} band="PLATINUM" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <AuditChain />
              <p style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--mono)', margin: 0 }}>
                ↑ Six most recent audit blocks. Each is Ed25519-signed, prev-hash-linked, and verifiable
                offline via{' '}
                <code style={{ color: 'var(--accent)' }}>aegis-audit-verify verify-manifests ./corpus/</code>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Neutral positioning ─────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Switzerland Positioning</span>
            <h2>Neutral by design — no vendor, no model, no protocol.</h2>
            <p>
              AEGIS is the cryptographic checkpoint, not a closed platform. We hold only public keys,
              route only verification, and remain unaligned with any agent runtime or LLM. Neutrality
              is not a hedge — it is the moat.
            </p>
          </div>
          <div className="neutrals">
            <div className="neutral">
              <span className="key">Vendor-neutral</span>
              <h3>Works with any agent runtime.</h3>
              <p>Browserbase, Anthropic, OpenAI, LangChain, custom — the agent identity contract is the same shape across all of them.</p>
            </div>
            <div className="neutral">
              <span className="key">Model-neutral</span>
              <h3>Doesn&rsquo;t care which model is talking.</h3>
              <p>Identity attests to the agent principal, not the inference provider. Swap Claude for Llama for GPT — the audit chain stays continuous.</p>
            </div>
            <div className="neutral">
              <span className="key">Protocol-neutral</span>
              <h3>ACP-compatible. MCP-aware. NIST-bound.</h3>
              <p>Compatible with the Agentic Commerce Protocol. Integrates with MCP servers at the tool level. Following NIST AI Agent Identity guidance as it lands.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Quickstart with typewriter ──────────────────────────── */}
      <section id="quickstart" className="reveal">
        <div className="container">
          <div className="split">
            <div className="split-copy">
              <span className="eyebrow">10-Minute Quickstart</span>
              <h2>Three calls. Zero infrastructure.</h2>
              <p>The Aha moment: your agent sends a request, the relying party gets back <code>{'{ valid: true, trustScore: 500 }'}</code>. Everything below is engineered so a developer hits that in under ten minutes.</p>
              <div className="step"><span className="step-n">01</span><span>Mint a per-agent Ed25519 keypair locally.</span></div>
              <div className="step"><span className="step-n">02</span><span>Sign an action token; send to <code>POST /v1/verify</code>.</span></div>
              <div className="step"><span className="step-n">03</span><span>Receive <code>valid</code> + <code>trustScore</code>, or a typed denial reason.</span></div>
              <div style={{ marginTop: 24 }}>
                <a href="/quickstart" className="btn btn-ghost">Full quickstart →</a>
              </div>
            </div>
            <div>
              <CodeTypewriter />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Integration preview ─────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Integrations</span>
            <h2>Verify every agent — wherever it runs.</h2>
            <p>
              AEGIS attaches as middleware to every major agent framework, LLM provider, workflow engine,
              and cloud platform. Pattern-A tool-call wrappers, Pattern-B workflow nodes, Pattern-C cloud
              adapters, Pattern-D audit sinks — one verification API across all of them.
            </p>
          </div>
          <div className="integration-grid">
            {featured.map((i) => (
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
                  <span className={`status-pill ${i.status}`}>{i.status === 'coming-soon' ? 'Soon' : i.status}</span>
                  <span>{CATEGORY_LABELS[i.category]}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="integration-actions">
            <a href="/integrations" className="btn btn-ghost">Browse all 80+ integrations →</a>
            <a href="/everywhere" className="btn btn-ghost">AEGIS Everywhere operating manual →</a>
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────────── */}
      <section id="pricing" className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Pricing</span>
            <h2>Every plan starts free. Pay only when you scale.</h2>
            <p>10,000 verifies free, lifetime. No card required to start. Overages on paid plans are uniform <code>$0.0008 / verify</code>.</p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="pricing">
              <thead>
                <tr>
                  <th />
                  <th>Developer</th>
                  <th>Team</th>
                  <th>Scale</th>
                  <th>Enterprise</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Monthly</th>
                  <td><span className="plan-price">$49<span className="per"> /mo</span></span></td>
                  <td className="plan-featured"><span className="plan-price">$299<span className="per"> /mo</span></span></td>
                  <td><span className="plan-price">$1,499<span className="per"> /mo</span></span></td>
                  <td><span className="plan-price">Custom</span></td>
                </tr>
                <tr>
                  <th>Included verifies</th>
                  <td className="mono">50,000 / mo</td>
                  <td className="mono plan-featured">500,000 / mo</td>
                  <td className="mono">5,000,000 / mo</td>
                  <td>Negotiated volume</td>
                </tr>
                <tr>
                  <th>Overage</th>
                  <td className="mono">$0.0008 / verify</td>
                  <td className="mono plan-featured">$0.0008 / verify</td>
                  <td className="mono">$0.0008 / verify</td>
                  <td>Volume committed</td>
                </tr>
                <tr>
                  <th>Agents · policies · webhooks</th>
                  <td className="feat-yes">Unlimited</td>
                  <td className="feat-yes plan-featured">Unlimited</td>
                  <td className="feat-yes">Unlimited</td>
                  <td className="feat-yes">Unlimited</td>
                </tr>
                <tr>
                  <th>BATE engine</th>
                  <td className="feat-yes">✓</td>
                  <td className="feat-yes plan-featured">✓</td>
                  <td className="feat-yes">✓</td>
                  <td className="feat-yes">✓ + tuned rules</td>
                </tr>
                <tr>
                  <th>Audit export</th>
                  <td>NDJSON</td>
                  <td className="plan-featured">NDJSON + S3</td>
                  <td>NDJSON + S3 + Parquet</td>
                  <td>All + custom destinations</td>
                </tr>
                <tr>
                  <th>MCP bridge · integrations</th>
                  <td className="feat-yes">✓</td>
                  <td className="feat-yes plan-featured">✓</td>
                  <td className="feat-yes">✓</td>
                  <td className="feat-yes">✓ + on-prem</td>
                </tr>
                <tr>
                  <th>SLA</th>
                  <td>Best-effort</td>
                  <td className="plan-featured">99.9%</td>
                  <td>99.95%</td>
                  <td>99.99%</td>
                </tr>
                <tr>
                  <th>Support</th>
                  <td>Community</td>
                  <td className="plan-featured">Email · 24h</td>
                  <td>Priority · 4h</td>
                  <td>Dedicated · 1h</td>
                </tr>
                <tr>
                  <td colSpan={5} className="plan-cta">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                      <a href={LINKS.developer} className="btn">Start Developer</a>
                      <a href={LINKS.team} className="btn btn-primary">Start Team</a>
                      <a href={LINKS.scale} className="btn">Contact for Scale</a>
                      <a href={LINKS.enterprise} className="btn">Contact for Enterprise</a>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Final CTA band ──────────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>The agent economy needs an identity layer. It is here.</h2>
              <p>Reach our team to provision an account. First 10,000 verifies on us. No card required to start. Self-serve checkout ships with v1.1.</p>
            </div>
            <div className="cta-band-actions">
              <a href={LINKS.developer} className="btn btn-primary">Talk to the team →</a>
              <a href={`${DASHBOARD_URL}/login`} className="btn btn-ghost">Log in</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
