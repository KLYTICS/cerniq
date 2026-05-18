// /terms — Terms of Service starter draft.
//
// ⚠️ DRAFT — requires legal review before customer signature. Operator
// must have qualified counsel customize before any customer accepts.
// This file maps ADR-0014 pricing, SLA tiers, and AEGIS technical
// invariants to a standard B2B SaaS terms structure so the lawyer's
// review is faster — not a substitute for review.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — AEGIS',
  description: 'Terms governing use of AEGIS (KLYTICS LLC). Plan tiers, SLAs, acceptable use, IP, warranties, and limitations.',
};

const LAST_UPDATED = '2026-05-15';
const ENTITY = 'KLYTICS LLC';
const LEGAL_EMAIL = process.env.NEXT_PUBLIC_LEGAL_EMAIL ?? 'legal@aegislabs.io';

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

export default function TermsPage() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 32 }}>
        <div className="container hero-inner">
          <span className="eyebrow">Terms of Service</span>
          <h1>The contract <span className="accent">between us.</span></h1>
          <p>
            These Terms govern your use of AEGIS. By creating an account or sending a
            request to AEGIS, you accept these Terms. Read them — they&rsquo;re short.
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
            <strong>DRAFT.</strong> Operator must have qualified counsel customize this
            document before customer acceptance. Plan pricing, SLA percentages, and
            jurisdiction must be validated against current commercial reality.
          </div>
        </div>
      </section>

      <Section id="parties" title="1. Parties + scope">
        <p>
          These Terms are an agreement between you (the &ldquo;Customer&rdquo;) and {ENTITY}
          (&ldquo;AEGIS&rdquo;, &ldquo;we&rdquo;), governing your access to and use of the
          AEGIS service: the verification, policy enforcement, behavioral attestation, and
          audit-rails platform, including all SDKs, APIs, dashboard, and documentation.
        </p>
      </Section>

      <Section id="account" title="2. Account creation + access">
        <p>
          You must be 18+ to create an account. You are responsible for keeping your API
          keys and dashboard credentials confidential — AEGIS will not be liable for any
          loss arising from your failure to do so. Notify <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>
          immediately if you suspect a credential has been compromised.
        </p>
      </Section>

      <Section id="plans" title="3. Plans, fees, and billing">
        <p>
          Plan tiers and pricing are published at <a href="/#pricing">/#pricing</a> and at
          <code> /.well-known/pricing.json</code> (machine-readable canonical mirror). Per
          ADR-0014:
        </p>
        <ul>
          <li><strong>Developer:</strong> $49 / month — 50,000 included verifies, $0.0008 / verify overage.</li>
          <li><strong>Team:</strong> $299 / month — 500,000 included verifies, $0.0008 / verify overage.</li>
          <li><strong>Scale:</strong> $1,499 / month — 5,000,000 included verifies, $0.0008 / verify overage.</li>
          <li><strong>Enterprise:</strong> Custom pricing, custom retention, custom SLA.</li>
          <li><strong>Trial:</strong> Every account starts with 10,000 lifetime verifies at no cost.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          Billing is processed by Stripe. You authorize automatic charges on the payment
          method you provide. Failed payments trigger 7-day grace period; thereafter the
          account is suspended (read-only via dashboard; verify path returns <code>PLAN_LIMIT_EXCEEDED</code>).
        </p>
      </Section>

      <Section id="sla" title="4. Service Level Agreement">
        <p>
          We commit to the following monthly uptime targets (verify path availability):
        </p>
        <ul>
          <li><strong>Developer:</strong> Best-effort. No SLA credit obligation.</li>
          <li><strong>Team:</strong> 99.9% (≤ 43m downtime/month).</li>
          <li><strong>Scale:</strong> 99.95% (≤ 21m downtime/month).</li>
          <li><strong>Enterprise:</strong> 99.99% (≤ 4.3m downtime/month).</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          If we miss the target, we credit 10% of the affected month&rsquo;s fees per 0.1%
          below target, capped at 50% of the monthly fee. Status posted at
          <code> status.aegis.klytics.io</code>. Credits apply to the next invoice, are not paid
          out in cash, and are the sole remedy for SLA breach.
        </p>
      </Section>

      <Section id="aup" title="5. Acceptable Use">
        <p>You will not:</p>
        <ul>
          <li>Use AEGIS to verify agent actions that violate any applicable law (sanctions, anti-money-laundering, securities, export controls).</li>
          <li>Bypass plan-tier rate limits via multi-accounting or coordinated tenants.</li>
          <li>Reverse-engineer, decompile, or attempt to extract private keys, signing secrets, or proprietary algorithms (BATE rules).</li>
          <li>Use AEGIS to facilitate fraud, deception, or any agent action you would not personally authorize.</li>
          <li>Submit data through AEGIS that you do not have lawful basis to process.</li>
          <li>Probe, scan, or stress-test the service except via plan-tier rate limits or with explicit written consent.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          We may suspend or terminate accounts for material breach. Egregious violations
          (e.g. AML evasion, agent impersonation of a regulated principal) may be reported
          to relevant authorities consistent with our legal obligations.
        </p>
      </Section>

      <Section id="ip" title="6. Intellectual property">
        <p>
          <strong>Your data, your IP.</strong> You retain all rights to the data you submit
          to AEGIS — agent metadata, policy strings, audit-event context. We claim no
          ownership over your data.
        </p>
        <p style={{ marginTop: 12 }}>
          <strong>Our service, our IP.</strong> The AEGIS service — software, models,
          discovery profile, BATE rules, documentation, SDKs (except open-source portions
          licensed separately per their LICENSE) — remains the property of {ENTITY}. You
          receive a non-exclusive, non-transferable license to use the service per these
          Terms.
        </p>
        <p style={{ marginTop: 12 }}>
          <strong>Feedback.</strong> If you send us suggestions, we may use them without
          restriction or compensation.
        </p>
      </Section>

      <Section id="warranties" title="7. Warranties + disclaimer">
        <p>
          We warrant that AEGIS will substantially conform to its published documentation
          and SLA target. EXCEPT FOR THE EXPRESS WARRANTIES IN THIS SECTION, AEGIS IS
          PROVIDED &ldquo;AS-IS&rdquo; AND {ENTITY} DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR
          IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR
          A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
        </p>
      </Section>

      <Section id="limitations" title="8. Limitations of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW:
        </p>
        <ul>
          <li>NEITHER PARTY WILL BE LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST DATA, OR BUSINESS INTERRUPTION, EVEN IF ADVISED OF THE POSSIBILITY.</li>
          <li>OUR AGGREGATE LIABILITY UNDER THESE TERMS WILL NOT EXCEED THE FEES YOU PAID TO AEGIS IN THE 12 MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY.</li>
          <li>NOTHING IN THESE TERMS LIMITS LIABILITY FOR GROSS NEGLIGENCE, WILLFUL MISCONDUCT, OR ANY OTHER LIABILITY THAT CANNOT BE EXCLUDED BY LAW.</li>
        </ul>
      </Section>

      <Section id="data-processing" title="9. Data processing">
        <p>
          When you submit personal data to AEGIS, our Data Processing Agreement (the
          <a href="/dpa"> DPA</a>) applies and is incorporated into these Terms by reference.
          See also our <a href="/privacy">Privacy Policy</a>.
        </p>
      </Section>

      <Section id="termination" title="10. Termination">
        <p>
          Either party may terminate for convenience with 30 days notice. We may terminate
          immediately for material breach of these Terms. On termination, you may export
          your data via NDJSON or Parquet for 30 days; thereafter we delete it except where
          retention is required by law (see <a href="/privacy#retention">Privacy §4</a>).
        </p>
      </Section>

      <Section id="changes" title="11. Changes to these Terms">
        <p>
          Material changes are announced 30 days before effective date via email + the
          <a href="/changelog"> changelog</a>. Continued use after the effective date
          constitutes acceptance. If you do not accept, you may terminate per §10.
        </p>
      </Section>

      <Section id="governing-law" title="12. Governing law + dispute resolution">
        <p>
          These Terms are governed by the laws of [jurisdiction — operator to fill],
          excluding conflict-of-laws principles. Disputes will be resolved by binding
          arbitration in [city — operator to fill] under [arbitration rules — operator to
          choose, e.g. AAA Commercial Arbitration Rules]. Class actions waived to the
          extent permitted by law.
        </p>
      </Section>

      <Section id="contact" title="13. Contact">
        <p>
          Questions about these Terms: <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.
        </p>
      </Section>
    </>
  );
}
