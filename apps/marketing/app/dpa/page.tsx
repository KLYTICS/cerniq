// /dpa — Data Processing Agreement starter draft.
//
// ⚠️ DRAFT — requires legal review before customer signature. Operator
// must have qualified counsel customize before any customer accepts.
// This file maps AEGIS's actual sub-processors + security measures to a
// GDPR Art. 28-compliant DPA structure so the lawyer's review is faster
// — not a substitute for review.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Processing Agreement — AEGIS',
  description: 'GDPR Article 28 + UK GDPR + CCPA Data Processing Agreement covering AEGIS sub-processors, security measures, and breach notification.',
};

const LAST_UPDATED = '2026-05-15';
const ENTITY = 'KLYTICS LLC';
const DPO_EMAIL = process.env.NEXT_PUBLIC_DPO_EMAIL ?? 'dpo@aegislabs.io';
const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? 'privacy@aegislabs.io';

interface SubProcessor {
  name: string;
  purpose: string;
  region: string;
  dpaUrl: string;
}

const SUB_PROCESSORS: SubProcessor[] = [
  { name: 'Vercel Inc.',         purpose: 'Marketing site + dashboard hosting + edge functions', region: 'US + EU regions',          dpaUrl: 'https://vercel.com/legal/dpa' },
  { name: 'Railway Corp.',       purpose: 'API hosting + worker queues',                          region: 'us-east',                  dpaUrl: 'https://railway.app/legal/dpa' },
  { name: 'Neon Inc.',           purpose: 'Postgres database',                                    region: 'us-east + EU on request',  dpaUrl: 'https://neon.tech/dpa' },
  { name: 'Cloudflare Inc.',     purpose: 'DNS + CDN + edge verify (Phase 3)',                    region: 'Global edge',              dpaUrl: 'https://www.cloudflare.com/cloudflare-customer-dpa/' },
  { name: 'Stripe Inc.',         purpose: 'Billing + payment processing',                         region: 'US + EU',                  dpaUrl: 'https://stripe.com/legal/dpa' },
  { name: 'Auth0 / Okta Inc.',   purpose: 'Dashboard authentication (default per ADR-0009)',      region: 'US + EU',                  dpaUrl: 'https://www.okta.com/agreements/' },
  { name: 'Functional Software, Inc. (Sentry)', purpose: 'Error monitoring (PII sanitized per ADR-0006)', region: 'US',           dpaUrl: 'https://sentry.io/legal/dpa/' },
  { name: 'Resend Inc.',         purpose: 'Transactional email (API key delivery, alerts)',       region: 'US',                       dpaUrl: 'https://resend.com/legal/dpa' },
];

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

export default function DpaPage() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 32 }}>
        <div className="container hero-inner">
          <span className="eyebrow">Data Processing Agreement</span>
          <h1>Article 28 + UK GDPR + CCPA.<br /><span className="accent">Mapped to running code.</span></h1>
          <p>
            This DPA covers AEGIS&rsquo;s processing of personal data on behalf of customers
            (controllers). Sub-processor list is exhaustive and live. Security measures are
            mapped to <a href="/security">/security</a> + <code>CLAUDE.md</code> invariants.
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
            <strong>DRAFT.</strong> This DPA is a starter mapping. Operator must have
            qualified counsel customize before customer signature. SCCs Module 2 + UK IDTA
            should be appended as separate documents and referenced here once finalized.
          </div>
        </div>
      </section>

      <Section id="parties" title="1. Parties + roles">
        <p>
          This Data Processing Agreement (&ldquo;DPA&rdquo;) is between Customer (Controller)
          and {ENTITY} (Processor). It applies whenever {ENTITY} processes personal data
          on behalf of Customer pursuant to the
          <a href="/terms"> Terms of Service</a>.
        </p>
        <p style={{ marginTop: 12 }}>
          For sub-processor relationships, Customer is the Controller, {ENTITY} is the
          Processor, and the sub-processors in §5 are Sub-processors. Where applicable
          law treats us as a Service Provider (CCPA) or Business (CPRA), we operate under
          those analogous obligations.
        </p>
      </Section>

      <Section id="subject" title="2. Subject matter + duration">
        <p>
          <strong>Subject matter:</strong> Cryptographic identity verification, policy
          enforcement, behavioral attestation, and signed audit logging for AI agents
          acting on Customer&rsquo;s behalf.
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>Duration:</strong> Co-terminus with the underlying Terms; survives for
          retention windows in §6 + any longer period required by law.
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>Nature + purpose:</strong> Processing as necessary to deliver the AEGIS
          service.
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>Categories of data subjects:</strong> Customer&rsquo;s end-users; agents
          (non-human actors) acting on their behalf; Customer&rsquo;s employees with
          dashboard access.
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>Categories of personal data:</strong> Account data (email, name, org),
          API keys (hashed), agent public keys (Ed25519), verify request metadata (action
          string, truncated IP, timestamp, trust band).
        </p>
      </Section>

      <Section id="instructions" title="3. Processing only on documented instructions">
        <p>
          {ENTITY} processes personal data only on documented instructions from Customer,
          including with regard to transfers, unless required to do otherwise by EU/UK law.
          If a legal obligation requires processing without instructions, {ENTITY} will
          inform Customer of that legal requirement before processing, unless that law
          prohibits disclosure.
        </p>
      </Section>

      <Section id="confidentiality" title="4. Confidentiality">
        <p>
          {ENTITY} ensures that personnel authorized to process personal data have committed
          themselves to confidentiality or are under an appropriate statutory obligation
          of confidentiality. Background checks performed before role-onboarding for any
          role with production data access.
        </p>
      </Section>

      <Section id="sub-processors" title="5. Sub-processors">
        <p>
          Customer authorizes {ENTITY} to engage the following Sub-processors, which provide
          equivalent data-protection obligations as in this DPA. We notify Customer of new
          Sub-processors via the <a href="/changelog">changelog</a> + email at least 30 days
          before they begin processing. Customer may object on reasonable grounds within
          that period; if no resolution, Customer may terminate the affected service.
        </p>
        <div className="integration-grid" style={{ marginTop: 16 }}>
          {SUB_PROCESSORS.map((s) => (
            <article key={s.name} className="integration-card">
              <div className="name">{s.name}</div>
              <div className="blurb">{s.purpose}</div>
              <div className="meta">
                <span>{s.region}</span>
                <a href={s.dpaUrl} className="mono" style={{ fontSize: 10 }}>DPA →</a>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section id="retention" title="6. Retention + deletion">
        <p>
          AEGIS retains personal data only as long as necessary to provide the service.
          Default retention windows by plan tier:
        </p>
        <ul>
          <li><strong>Account data:</strong> Account lifetime + 90 days post-deletion.</li>
          <li><strong>Audit chain:</strong> Developer 90d / Team 1yr / Scale 7yr / Enterprise negotiated. Retention floor: max(seal-time plan retention, sweep-time current retention) — plan downgrades cannot shorten an already-promised window (OD-017).</li>
          <li><strong>Diagnostic logs:</strong> 30 days, then aggregated.</li>
          <li><strong>Billing data:</strong> 7 years per financial record-keeping obligations.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          On termination, Customer may export data via NDJSON or Parquet for 30 days. After
          that, {ENTITY} deletes personal data except where retention is required by law,
          using GDPR Art. 17–compatible irrevocable redaction (POST <code>/v1/compliance/audit/redact-*</code>).
        </p>
      </Section>

      <Section id="security-measures" title="7. Technical + organizational measures (Art. 32)">
        <p>Annex II — Technical + Organizational Measures, mapped to AEGIS architecture:</p>
        <ul>
          <li><strong>Pseudonymization + encryption.</strong> Ed25519 signatures on every audit row. TLS 1.2+ in transit. AES-256 at rest (provider-level: Neon, Railway, Vercel).</li>
          <li><strong>Confidentiality + integrity + availability + resilience.</strong> Hash-chained audit log (CLAUDE.md invariant #3). Multi-tenant isolation by principalId (CLAUDE.md invariant #5). HSTS preload. CSP. SOC 2 Type I in progress.</li>
          <li><strong>Restore in a timely manner.</strong> Neon point-in-time restore (7-day window). Railway snapshot backups. RTO: 4h. RPO: 15m for paid tiers.</li>
          <li><strong>Regular testing.</strong> Cross-package parity tests (95+ tests guarding manifest integrity). Penetration testing annual (Phase 2). Bug bounty (Phase 3).</li>
          <li><strong>Key management.</strong> KMS adapters for AWS/GCP/Vault (ADR-0011). 90-day audit-signing rotation, 365-day JWT rotation, overlap windows.</li>
          <li><strong>Access control.</strong> RBAC on dashboard. API key bcrypt-12 at rest. Principle of least privilege.</li>
        </ul>
      </Section>

      <Section id="assistance" title="8. Assistance + data subject rights">
        <p>
          {ENTITY} assists Customer in fulfilling data subject rights (Art. 15-22) by
          providing:
        </p>
        <ul>
          <li>Self-serve audit export via dashboard or <code>GET /v1/audit/export</code>.</li>
          <li>Irrevocable redaction via <code>POST /v1/compliance/audit/redact-{`{event,by-agent}`}</code>.</li>
          <li>Account-data export + deletion via dashboard or email request.</li>
          <li>Sub-processor list, retention windows, and security posture published publicly.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          Customer is responsible for receiving and validating data subject requests; we
          execute upon Customer&rsquo;s instruction.
        </p>
      </Section>

      <Section id="breach" title="9. Breach notification">
        <p>
          {ENTITY} notifies Customer without undue delay (target: 24h) after becoming aware
          of a personal data breach affecting Customer&rsquo;s data, providing the
          information necessary for Customer to meet its Art. 33/34 obligations. Initial
          notification will cover known facts; supplements follow as investigation proceeds.
          Contact: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> +
          {' '}<a href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</a>.
        </p>
      </Section>

      <Section id="audit" title="10. Audit rights">
        <p>
          Customer may audit {ENTITY}&rsquo;s compliance with this DPA once per 12-month
          period via:
        </p>
        <ul>
          <li>Review of AEGIS&rsquo;s most recent SOC 2 Type II report (when available).</li>
          <li>Written security questionnaire response within 30 days.</li>
          <li>On-site audit by independent auditor, at Customer&rsquo;s expense, with 30 days notice, scheduled during business hours, and subject to confidentiality.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          Public self-serve verification surfaces: <a href="/security">/security</a> +
          <code> /.well-known/openid-configuration</code> + the AEGIS audit chain itself
          (offline verifier ships in the SDK).
        </p>
      </Section>

      <Section id="transfers" title="11. International transfers + SCCs">
        <p>
          To the extent personal data is transferred outside the EEA / UK to a jurisdiction
          without an adequacy decision, the parties incorporate the EU Standard Contractual
          Clauses (Module 2: Controller → Processor) into this DPA by reference. For UK
          transfers, the UK International Data Transfer Addendum (IDTA) supplements the
          SCCs. The Annexes to the SCCs are populated by §2 (subject matter), §5 (Sub-processors),
          and §7 (TOMs) of this DPA.
        </p>
      </Section>

      <Section id="liability" title="12. Liability">
        <p>
          Liability under this DPA is subject to the limitations of liability set out in
          the <a href="/terms#limitations">Terms §8</a>, except where prohibited by GDPR
          Art. 82 (the right to compensation cannot be limited as between Controller and
          data subject).
        </p>
      </Section>

      <Section id="contact" title="13. Contact">
        <p>
          DPO + privacy contact: <a href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</a>.
          Customer support: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
        </p>
      </Section>
    </>
  );
}
