// /security — procurement-grade security page. Mirrors the binding
// contract published in docs/spec/05_FAPI_2_0_PROFILE.md so every
// claim here is citable to running code + tests today (implemented)
// or to a roadmap with promotion tests (aligned). Honest by design.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security — AEGIS',
  description:
    'AEGIS publishes its standards posture at /.well-known/openid-configuration via a FAPI 2.0–aligned discovery profile. Ed25519 (RFC 8032), JWKS (RFC 7517), security.txt (RFC 9116) implemented today. RAR, DPoP, JAR, HTTP-sig on the roadmap.',
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.aegis.dev';
const SECURITY_EMAIL = process.env.NEXT_PUBLIC_SECURITY_EMAIL ?? 'security@aegislabs.io';

interface StandardEntry {
  rfc: string;
  name: string;
  blurb: string;
  evidence?: string;
}

const IMPLEMENTED: StandardEntry[] = [
  { rfc: 'RFC 8032', name: 'EdDSA — Ed25519',
    blurb: 'All agent + audit signatures use Ed25519. One curve, one library, no RSA. Audited.',
    evidence: '@noble/ed25519 + paired tests on every signing path' },
  { rfc: 'RFC 7517', name: 'JSON Web Key Set (JWKS)',
    blurb: 'Public keys discoverable at /.well-known/jwks.json and /.well-known/audit-signing-key.',
    evidence: 'apps/api/src/modules/wellknown/' },
  { rfc: 'RFC 9116', name: 'security.txt',
    blurb: 'Coordinated disclosure surface published at /.well-known/security.txt.',
    evidence: `${API_BASE}/.well-known/security.txt` },
  { rfc: 'OpenID Discovery 1.0', name: 'Discovery profile',
    blurb: 'Capability advertisement at /.well-known/openid-configuration. FAPI 2.0 fields populated.',
    evidence: 'wellknown.service.ts — DISCOVERY_SPEC_VERSION 1.2.0' },
  { rfc: 'RFC 9396', name: 'Rich Authorization Requests (RAR)',
    blurb: 'authorization_details semantic on the verify path. 4 detail types registered (trading_order, payment_initiation, data_access, agent_action). Live endpoint.',
    evidence: 'POST /v1/verify/rar/evaluate — 37 paired tests, stateless evaluator' },
];

const ALIGNED: StandardEntry[] = [
  { rfc: 'FAPI 2.0', name: 'Financial-grade API Security Profile',
    blurb: 'Aligned via the discovery profile + RFC-9396 RAR implemented. Token-binding + DPoP on the implementation roadmap.',
    evidence: 'docs/spec/05_FAPI_2_0_PROFILE.md' },
  { rfc: 'RFC 9449', name: 'Demonstrating Proof-of-Possession (DPoP)',
    blurb: 'Token-binding scaffold landed. Promotion gated on browser + edge runtime support matrix.',
    evidence: 'Roadmap §3.3' },
  { rfc: 'RFC 9101', name: 'JWT-Secured Authorization Requests (JAR)',
    blurb: 'Request-object signature verification. Paired with FAPI 2.0 advanced profile.',
    evidence: 'Roadmap §3.5' },
  { rfc: 'RFC 9421', name: 'HTTP Message Signatures',
    blurb: 'Wire-level message integrity. Paired with the Cloudflare Workers verify edge (Phase 3).',
    evidence: 'Roadmap §3.6' },
  { rfc: 'NIST AI Agent Identity', name: 'NIST AI Agent Identity Initiative',
    blurb: 'Following the standards-development clock — first to map our profile to NIST guidance as it ships.',
    evidence: 'Public comment period closed April 2026' },
  { rfc: 'SOC 2 Type I', name: 'SOC 2 Type I attestation',
    blurb: 'Type I scoped to identity + audit-chain controls. Type II window planned 90 days post-launch.',
    evidence: 'In progress' },
  { rfc: 'ISO 27001', name: 'ISO 27001',
    blurb: 'Aligned via SOC 2 Type II control mapping. Formal attestation Phase 3.',
    evidence: 'Roadmap — Phase 3 ($50K MRR gate)' },
];

interface OpControl {
  title: string;
  detail: string;
}

const OPERATIONAL: OpControl[] = [
  { title: 'Private keys never enter AEGIS',
    detail: 'CLAUDE.md invariant #1. Customer SDKs generate + hold private keys locally. AEGIS holds only public keys.' },
  { title: 'Audit chain is append-only',
    detail: 'CLAUDE.md invariant #3. No production code path may update or delete an AuditEvent. Hash-chained, Ed25519-signed per row.' },
  { title: 'No silent failures',
    detail: 'CLAUDE.md invariant #4. Downstream failure is visible in response, logs, metrics, or audit trail. Never hidden behind empty list or fake success.' },
  { title: 'Multi-tenant isolation by principalId',
    detail: 'CLAUDE.md invariant #5. Every query, mutation, cache key, queue, and webhook carries the principal boundary to Prisma.' },
  { title: 'Locked denial precedence',
    detail: 'CLAUDE.md invariant #6. AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED → POLICY_EXPIRED → SCOPE_NOT_GRANTED → TRIAL_EXHAUSTED → SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED. Any change requires spec + parity tests + API version review.' },
  { title: 'KMS-backed signing keys',
    detail: 'ADR-0011 — AWS / GCP / Vault / in-memory adapters. Rotation policy: 90d audit, 365d JWT, with overlap windows.' },
  { title: 'Audit retention enforcement',
    detail: 'Plan downgrades cannot shorten an already-promised retention window. Retention floor = max(seal-time plan retention, sweep-time current plan retention) per OD-017.' },
  { title: 'GDPR Art. 17 redaction',
    detail: 'POST /v1/compliance/audit/redact-{event,by-agent} under FULL-scope API keys. Meta-event pinned in audit chain — redaction is irrevocable but operator-traceable.' },
  { title: 'Post-quantum hybrid scaffold',
    detail: 'ADR-0013 — PQ hybrid behind AEGIS_HYBRID_PQ_ENABLED flag. Triggers per OD-014 (IETF RFC of draft-ietf-cose-hybrid-pq-jwt OR AWS KMS EdDSA GA OR regulated customer ask).' },
];

interface DiscoveryEndpoint {
  path: string;
  description: string;
}

const ENDPOINTS: DiscoveryEndpoint[] = [
  { path: '/.well-known/openid-configuration', description: 'Discovery — FAPI 2.0 profile, supported algorithms, endpoints.' },
  { path: '/.well-known/jwks.json',             description: 'JWT verification key set.' },
  { path: '/.well-known/audit-signing-key',     description: 'Audit chain signing key set — distinct from JWT keys.' },
  { path: '/.well-known/security.txt',          description: 'Coordinated disclosure surface per RFC 9116.' },
  { path: '/.well-known/pricing.json',          description: 'Public pricing mirror — canonical source for marketing + dashboard.' },
];

export default function SecurityPage() {
  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Security</span>
          <h1>Verifiable security. <span className="accent">Not aspirational.</span></h1>
          <p>
            Every claim on this page is either <strong>implemented</strong> (citable to running
            code + tests today) or <strong>aligned</strong> (roadmapped with promotion tests). AEGIS
            publishes its standards posture at the discovery endpoint — auditors verify our claims
            without ever talking to us.
          </p>
          <div className="hero-proof" style={{ marginTop: 24 }}>
            <span>{IMPLEMENTED.length} standards implemented</span>
            <span>{ALIGNED.length} aligned, in flight</span>
            <span>{OPERATIONAL.length} operational invariants locked</span>
            <span>{ENDPOINTS.length} public .well-known endpoints</span>
          </div>
        </div>
      </section>

      {/* ─── Implemented ─────────────────────────────────────────── */}
      <section className="reveal" id="implemented">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Implemented Today</span>
            <h2>Standards with running code and paired tests.</h2>
            <p>
              Each row below is anchored to a file path and a passing test. The discovery endpoint
              advertises these in <code>standards_implemented</code> — request{' '}
              <code>{API_BASE}/.well-known/openid-configuration</code> for the live ledger.
            </p>
          </div>
          <div className="integration-grid">
            {IMPLEMENTED.map((s) => (
              <article key={s.rfc} className="integration-card">
                <div className="name">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)' }} />
                  {s.rfc}
                </div>
                <div className="blurb">
                  <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 4 }}>{s.name}</strong>
                  {s.blurb}
                </div>
                {s.evidence && (
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-mute)' }}>
                    ↳ {s.evidence}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Aligned ─────────────────────────────────────────────── */}
      <section className="reveal" id="aligned">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Aligned — Roadmap with Promotion Tests</span>
            <h2>Standards we&rsquo;re building toward, on a clock.</h2>
            <p>
              Each entry below has a promotion test in the FAPI 2.0 profile doc — when the test passes,
              the standard moves from <code>standards_aligned</code> to <code>standards_implemented</code> and the
              marketing claim updates the same day. No marketing aspiration without an engineering gate.
            </p>
          </div>
          <div className="integration-grid">
            {ALIGNED.map((s) => (
              <article key={s.rfc} className="integration-card">
                <div className="name">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                  {s.rfc}
                </div>
                <div className="blurb">
                  <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 4 }}>{s.name}</strong>
                  {s.blurb}
                </div>
                {s.evidence && (
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-mute)' }}>
                    ↳ {s.evidence}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Operational invariants ──────────────────────────────── */}
      <section className="reveal" id="operational">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Operational Invariants</span>
            <h2>The rules that don&rsquo;t bend.</h2>
            <p>
              These are non-negotiable. Codified in <code>CLAUDE.md</code> as architecture invariants
              and enforced at the test gate, the review gate, and the operator-decision gate. Engineering
              changes that violate them require an ADR + parity tests + API version review.
            </p>
          </div>
          <div className="layers">
            {OPERATIONAL.slice(0, 4).map((c) => (
              <article key={c.title} className="layer">
                <span className="layer-tag">Invariant</span>
                <h3>{c.title}</h3>
                <p style={{ fontSize: 13 }}>{c.detail}</p>
              </article>
            ))}
          </div>
          <div className="layers" style={{ marginTop: 12 }}>
            {OPERATIONAL.slice(4, 8).map((c) => (
              <article key={c.title} className="layer">
                <span className="layer-tag">Invariant</span>
                <h3>{c.title}</h3>
                <p style={{ fontSize: 13 }}>{c.detail}</p>
              </article>
            ))}
          </div>
          {OPERATIONAL.length > 8 && (
            <div className="layers" style={{ marginTop: 12, gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {OPERATIONAL.slice(8).map((c) => (
                <article key={c.title} className="layer">
                  <span className="layer-tag">Invariant</span>
                  <h3>{c.title}</h3>
                  <p style={{ fontSize: 13 }}>{c.detail}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ─── Discovery endpoints ─────────────────────────────────── */}
      <section className="reveal" id="endpoints">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Public Discovery Surface</span>
            <h2>Auditors verify us without asking us.</h2>
            <p>
              Every claim on this page is verifiable against AEGIS&rsquo; public discovery endpoints. No
              login, no sales call, no NDA. Auditors and procurement teams can confirm posture directly.
            </p>
          </div>
          <table className="pricing" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <th>
                    <a href={`${API_BASE}${e.path}`} className="mono" style={{ fontSize: 12 }}>
                      {e.path}
                    </a>
                  </th>
                  <td>{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 16, fontFamily: 'var(--mono)' }}>
            ↳ All endpoints are public, unauthenticated, CDN-cached, and version-pinned via the
            <code style={{ color: 'var(--accent)' }}> spec_version </code>
            field in the discovery response.
          </p>
        </div>
      </section>

      {/* ─── Disclosure CTA ──────────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Coordinated disclosure — security@aegislabs.io</h2>
              <p>
                Found a vulnerability? Email <code>{SECURITY_EMAIL}</code> with details. We respond within
                24h, fix critical issues within 7d, and credit reporters in <code>SECURITY.md</code>. The
                full disclosure surface lives at{' '}
                <a href={`${API_BASE}/.well-known/security.txt`} className="mono">
                  /.well-known/security.txt
                </a>{' '}
                per RFC 9116.
              </p>
            </div>
            <div className="cta-band-actions">
              <a
                href={`mailto:${SECURITY_EMAIL}?subject=${encodeURIComponent('AEGIS — security disclosure')}`}
                className="btn btn-primary"
              >
                Email security →
              </a>
              <a href={`${API_BASE}/.well-known/security.txt`} className="btn btn-ghost">
                View security.txt
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
