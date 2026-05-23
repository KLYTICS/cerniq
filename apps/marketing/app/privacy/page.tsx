// /privacy — Privacy Policy starter draft.
//
// ⚠️ DRAFT — requires legal review before customer-facing publication.
// Operator must have qualified counsel customize before any customer signs.
// This file maps the AEGIS technical architecture to GDPR Art. 13/14 + CCPA
// disclosure obligations so the lawyer's review is faster — not a substitute
// for review.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — AEGIS',
  description: 'How KLYTICS LLC collects, processes, and protects personal data on behalf of AEGIS customers and end-users.',
  robots: { index: true, follow: true },
};

const LAST_UPDATED = '2026-05-15';
const ENTITY = 'KLYTICS LLC';
const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? 'privacy@aegislabs.io';
const DPO_EMAIL = process.env.NEXT_PUBLIC_DPO_EMAIL ?? 'dpo@aegislabs.io';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="reveal" style={{ paddingTop: 32, paddingBottom: 32 }}>
      <div className="container" style={{ maxWidth: 880 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>{title}</h2>
        <div style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.7 }}>{children}</div>
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 32 }}>
        <div className="container hero-inner">
          <span className="eyebrow">Privacy Policy</span>
          <h1>How we handle <span className="accent">your data.</span></h1>
          <p>
            AEGIS holds cryptographic identity for AI agents. We hold public keys only.
            Personal data we touch is minimized, logged in the audit chain, and never sold.
          </p>
          <p className="mono" style={{ fontSize: 11, marginTop: 16, color: 'var(--text-mute)' }}>
            Last updated: {LAST_UPDATED} · Effective: {LAST_UPDATED}
          </p>
        </div>
      </section>

      <section className="reveal" style={{ paddingTop: 12, paddingBottom: 12, borderBottom: 'none' }}>
        <div className="container" style={{ maxWidth: 880 }}>
          <div style={{
            padding: 14, border: '1px solid var(--warn)',
            background: 'color-mix(in srgb, var(--warn) 8%, transparent)',
            borderRadius: 4, fontSize: 12, color: 'var(--text)',
          }}>
            <strong>DRAFT.</strong> This document is a starter mapping of AEGIS technical
            architecture to GDPR Art. 13/14 + CCPA disclosure obligations. Operator must
            have qualified counsel customize before customer publication. Do not treat
            this as a finalized legal document.
          </div>
        </div>
      </section>

      <Section id="controller" title="1. Data controller">
        <p>
          The controller for the data described in this policy is {ENTITY} (&ldquo;AEGIS&rdquo;, &ldquo;we&rdquo;).
          Registered in [jurisdiction — operator to fill]. Contact for privacy matters:
          <a href={`mailto:${PRIVACY_EMAIL}`}> {PRIVACY_EMAIL}</a>. EU/UK Data Protection
          Officer: <a href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</a>.
        </p>
        <p>
          When AEGIS processes data on behalf of a customer (e.g. agent activity in a
          customer&rsquo;s AEGIS tenant), the customer is the controller and AEGIS is the
          processor. The applicable terms are set out in the
          <a href="/dpa"> Data Processing Agreement</a>.
        </p>
      </Section>

      <Section id="data-collected" title="2. Data we collect">
        <p>
          AEGIS is designed to minimize personal data collection. Specifically we collect:
        </p>
        <ul style={{ marginTop: 10 }}>
          <li><strong>Account data.</strong> Email, name, organization, role. Source: identity provider (Auth0, Clerk, or WorkOS) at signup. Stripe (post-checkout) populates billing fields only.</li>
          <li><strong>Authentication data.</strong> API keys (hashed at rest with bcrypt cost-12). Auth0 / Clerk session tokens for dashboard login. Public keys for agents (Ed25519). <strong>We never collect or store private keys.</strong></li>
          <li><strong>Verify request metadata.</strong> Agent ID, action string, timestamp, IP address (truncated to /24 for IPv4, /48 for IPv6), trust band returned. This is the audit chain — hash-linked, Ed25519-signed, append-only.</li>
          <li><strong>Behavioral attestation signals.</strong> Aggregated, anonymized signals across a tenant&rsquo;s agent population (BATE — Behavioral Attestation Engine). No raw request bodies are retained.</li>
          <li><strong>Billing data.</strong> Processed by Stripe; we receive Stripe customer ID, plan tier, usage counts. We do not receive card numbers.</li>
          <li><strong>Diagnostic data.</strong> Server logs (rotated 30 days), Sentry error reports (sanitized of PII per ADR-0006).</li>
        </ul>
      </Section>

      <Section id="purposes" title="3. Why we process it (lawful basis under GDPR Art. 6)">
        <ul>
          <li><strong>Performance of contract (Art. 6(1)(b)).</strong> Account data, API keys, verify metadata — necessary to deliver the AEGIS service.</li>
          <li><strong>Legitimate interest (Art. 6(1)(f)).</strong> Behavioral attestation, diagnostic data, fraud prevention. Balancing test: cryptographic-grade fraud prevention is a substantial interest, the impact on data subjects is minimized (no raw bodies, hashed identifiers, truncated IPs).</li>
          <li><strong>Legal obligation (Art. 6(1)(c)).</strong> Audit log retention where required by sector regulation (FINRA Rule 4511, SOC 2 evidence, GDPR Art. 30 records).</li>
          <li><strong>Consent (Art. 6(1)(a)).</strong> Marketing communications only. Opt-in at signup, opt-out at any time.</li>
        </ul>
      </Section>

      <Section id="retention" title="4. Retention">
        <p>
          Default retention windows, configurable per plan tier per
          <a href="/dpa"> DPA</a> §6:
        </p>
        <ul>
          <li><strong>Account data:</strong> Retained while the account is active + 90 days after deletion request.</li>
          <li><strong>Audit chain:</strong> Developer 90d / Team 1yr / Scale 7yr / Enterprise negotiated. Retention floor = max(seal-time plan retention, sweep-time current retention) — plan downgrades cannot shorten an already-promised window (OD-017).</li>
          <li><strong>Diagnostic logs:</strong> 30 days, then aggregated.</li>
          <li><strong>Billing data:</strong> 7 years per US/EU financial record-keeping obligations.</li>
        </ul>
      </Section>

      <Section id="rights" title="5. Your rights (GDPR Art. 15-22)">
        <p>
          Data subjects in the EU/UK have the right to:
        </p>
        <ul>
          <li><strong>Access (Art. 15).</strong> Request a copy of all personal data we hold. Honored within 30 days.</li>
          <li><strong>Rectification (Art. 16).</strong> Correct inaccurate or incomplete data.</li>
          <li><strong>Erasure (Art. 17).</strong> Be forgotten. AEGIS supports irrevocable audit-chain redaction via <code>POST /v1/compliance/audit/redact-{`{event,by-agent}`}</code> — the redaction is permanent and pinned in the audit chain as a meta-event (operator-traceable, content-irrecoverable).</li>
          <li><strong>Restriction (Art. 18).</strong> Limit how we process your data.</li>
          <li><strong>Portability (Art. 20).</strong> Export data in NDJSON or Parquet.</li>
          <li><strong>Object (Art. 21).</strong> To processing based on legitimate interests.</li>
          <li><strong>Withdraw consent (Art. 7).</strong> At any time, without affecting prior lawful processing.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          Exercise any of these rights by emailing <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
        </p>
      </Section>

      <Section id="sub-processors" title="6. Sub-processors">
        <p>
          Current sub-processors. Full list with security postures and DPA links at
          <a href="/dpa#sub-processors"> /dpa#sub-processors</a>. We notify customers via
          changelog + email at least 30 days before adding a new sub-processor:
        </p>
        <ul>
          <li><strong>Vercel</strong> — marketing site + dashboard hosting (EU + US regions).</li>
          <li><strong>Railway</strong> — API hosting (us-east).</li>
          <li><strong>Neon</strong> — Postgres database (us-east, EU region available).</li>
          <li><strong>Cloudflare</strong> — DNS, CDN, edge-verify (Phase 3).</li>
          <li><strong>Stripe</strong> — billing + payment processing.</li>
          <li><strong>Auth0 / Clerk</strong> — dashboard authentication (default Auth0 per ADR-0009).</li>
          <li><strong>Sentry</strong> — error monitoring (PII sanitized per ADR-0006).</li>
        </ul>
      </Section>

      <Section id="transfers" title="7. International transfers">
        <p>
          Default region is US (us-east). EU customers can request EU-only processing via
          contractual addendum; AEGIS sub-processors with EU regions (Vercel, Neon, Cloudflare,
          Stripe) honor that constraint. Where transfers occur, we rely on Standard Contractual
          Clauses (Module 2: Controller → Processor) appended to the DPA. UK transfers use the
          UK Addendum (IDTA).
        </p>
      </Section>

      <Section id="security" title="8. Security measures">
        <p>
          Detailed in <a href="/security">/security</a>. Highlights:
        </p>
        <ul>
          <li>Ed25519 signatures on every audit row, hash-chained.</li>
          <li>Private keys never enter AEGIS (architecture invariant #1).</li>
          <li>Multi-tenant isolation by principalId (architecture invariant #5).</li>
          <li>API keys bcrypt-hashed at cost 12 at rest.</li>
          <li>TLS 1.2+ in transit. HSTS preload.</li>
          <li>SOC 2 Type I attestation in progress.</li>
          <li>Coordinated disclosure surface at /.well-known/security.txt (RFC 9116).</li>
        </ul>
      </Section>

      <Section id="changes" title="9. Changes to this policy">
        <p>
          We will post any changes here with a new &ldquo;Last updated&rdquo; date. Material
          changes that affect data subjects&rsquo; rights or processing purposes will be
          announced via email to account contacts at least 30 days before they take effect.
          Continued use of AEGIS after the effective date constitutes acceptance.
        </p>
      </Section>

      <Section id="contact" title="10. Contact">
        <p>
          Privacy contact: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
          DPO contact: <a href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</a>.
          Supervisory authority: in the EU, you may lodge a complaint with the data protection
          authority in your country of residence.
        </p>
      </Section>
    </>
  );
}
