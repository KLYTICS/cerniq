// /architecture — public mirror of the procurement-relevant ADRs in
// docs/decisions/.
//
// Companion to /principles (refuse-to-build list). Where /principles
// names what AEGIS will *not* build, /architecture names what it has
// *committed* to building, with the source ADR linked for the auditor
// who wants the full reasoning history.
//
// Parity: the COMMITMENTS array exports the ADR numbers + titles this
// page renders. A cross-package test
// (tests/cross-package/marketing-architecture-parity.spec.ts) asserts
// each ADR file exists on disk and its first-line title matches what
// the page claims. Renaming an ADR or changing its title without
// updating the page fails CI.

import type { Metadata } from 'next';

const REPO = 'https://github.com/klytics/aegis/blob/main';
const DECISIONS_DIR = `${REPO}/docs/decisions`;

export const metadata: Metadata = {
  title: 'Architecture — AEGIS · decisions made on purpose',
  description:
    'Eight architectural commitments published from the AEGIS ADR set. One signing curve. One canonical JSON. Audit chain verifiable across key rotations and after GDPR redaction. Verify algorithm portable across runtimes. Human and agent identity strictly separated. Intent-bound attestation surfaces behavioral mismatch. Each commitment carries a link to the full ADR.',
  openGraph: {
    title: 'AEGIS Architecture — decisions made on purpose',
    description:
      'Eight ADRs published in prospect-facing summaries. Cryptographic foundation, verifiability guarantees, neutrality boundaries — each linked to the full decision record.',
    type: 'article',
  },
};

type Theme = 'cryptographic-foundation' | 'verifiability' | 'neutrality';

interface Commitment {
  /** ADR slug as the file lives in docs/decisions/. */
  adrSlug: string;
  /** Full ADR title — used by the parity test to assert on-disk H1 matches. */
  adrTitle: string;
  /** Short label rendered as the card chip ("ADR-0002", "ADR-0011", ...). */
  label: string;
  theme: Theme;
  /** Buyer-friendly one-line commitment. */
  oneLine: string;
  /** Why this commitment matters to a CISO/auditor (the procurement context). */
  why: string;
  /** Concrete evidence — file or directory path that implements the commitment. */
  evidence: string;
}

/**
 * Exported so the parity test can assert sync with docs/decisions/.
 * Eight ADRs curated for procurement relevance — the cryptographic +
 * verifiability + neutrality posture. ADR-0004 (precedence) lives on
 * /principles as the configurable-precedence refusal; not duplicated here.
 */
export const COMMITMENTS: readonly Commitment[] = [
  {
    adrSlug: '0002-ed25519-only-crypto',
    adrTitle: 'ADR-0002 — Ed25519-only cryptography',
    label: 'ADR-0002',
    theme: 'cryptographic-foundation',
    oneLine: 'One signing curve. Ed25519 for every signature, base64url for every encoding.',
    why:
      'No RSA (slower, larger keys, no benefit). No symmetric secrets (would force every relying party to share a key, killing the third-party verifier story). One curve means one set of attack surfaces to monitor and one library to audit.',
    evidence: '@noble/ed25519 throughout the SDK, audit chain, and verifier-rp',
  },
  {
    adrSlug: '0005-audit-chain-canonicalization',
    adrTitle: 'ADR-0005 — Audit chain canonicalization (RFC 8785-lite)',
    label: 'ADR-0005',
    theme: 'cryptographic-foundation',
    oneLine: 'One canonical JSON. Keys sorted recursively, no whitespace, no NaN/Infinity/BigInt.',
    why:
      'Canonicalization is the single bit of cryptographic agreement between signer and verifier. One format means no format-negotiation header, no version drift, and no edge-case bugs from competing canonicalizers. The Zod validation layer rejects exotic types upstream so the canonical form has no surprises.',
    evidence: 'apps/api/src/common/crypto/audit-chain.util.ts + @aegis/audit-verifier/src/canonical.ts',
  },
  {
    adrSlug: '0011-key-rotation-kms',
    adrTitle: 'ADR-0011 — Key rotation via KMS adapter; signingKeyId stamped on every signed event',
    label: 'ADR-0011',
    theme: 'cryptographic-foundation',
    oneLine: 'Every signed record carries signingKeyId. JWKS publishes current AND historical keys forever.',
    why:
      'Audit-chain verifiability is forever. A key rotation today must not make yesterday\'s chain unverifiable tomorrow. validUntil marks when a key stopped signing; the key stays in JWKS so any auditor can resolve a historical signature.',
    evidence: '/.well-known/audit-signing-key + apps/api/src/common/crypto/crypto.bootstrap.ts',
  },
  {
    adrSlug: '0003-portable-verify-path',
    adrTitle: 'ADR-0003 — Portable verify hot path',
    label: 'ADR-0003',
    theme: 'verifiability',
    oneLine: 'The verify decision algorithm is a framework-free function. Same code runs everywhere.',
    why:
      'NestJS in the control plane, Cloudflare Workers at the edge, future runtimes wherever a customer needs them — the algorithm is the same file. No rewrite, no behavioral drift between the regions a verify call might land in. Forbidden imports (NestJS, Prisma, BullMQ, node:*) enforce the boundary.',
    evidence: 'apps/api/src/modules/verify/algorithm/verify.algorithm.ts (single source of truth)',
  },
  {
    adrSlug: '0006-audit-redactability',
    adrTitle: 'ADR-0006 — AuditEvent redactability for GDPR Article 17',
    label: 'ADR-0006',
    theme: 'verifiability',
    oneLine: 'Sign over hashes of PII, not raw values. Redaction nulls the raw column; the chain still verifies.',
    why:
      'GDPR Article 17 (right to erasure) and an immutable audit chain look contradictory. They aren\'t — when the chain commits to hashes of PII fields rather than the raw values. An erasure event sets the raw column to null and stamps redactedAt; the hash column and signature stay intact. The chain remains verifiable forever, even after a redaction.',
    evidence: 'AuditChainPayload v2 in audit-chain.util.ts + the *Hash columns in the Prisma schema',
  },
  {
    adrSlug: '0007-transactional-outbox',
    adrTitle: 'ADR-0007 — Transactional outbox for audit-or-bust SOC2 invariant',
    label: 'ADR-0007',
    theme: 'verifiability',
    oneLine: 'Audit appends and their side-effects commit in the same Postgres transaction.',
    why:
      'Fire-and-forget side-effects (BATE ingest, webhook delivery) lose data when Redis blips or the queue is down. The outbox makes the side-effect write part of the same transaction as the audit append — so the failure mode is "Postgres lost data" (same trust boundary as the audit chain itself), not "we dropped a webhook." A separate worker drains the outbox at least once.',
    evidence: 'OutboxEvent table + OutboxWorker; SELECT FOR UPDATE SKIP LOCKED for parallel drain',
  },
  {
    adrSlug: '0009-auth0-bridge',
    adrTitle: 'ADR-0009 — Auth0 bridges human identity; AEGIS owns agent identity',
    label: 'ADR-0009',
    theme: 'neutrality',
    oneLine: 'Two guards, two principals, never mixed. Human admins via Auth0; agents via AEGIS API keys.',
    why:
      'Mixing human and agent identity at the same authentication boundary is how every "I thought it was an admin acting" incident happens. /v1/verify is agent-only; human admin endpoints go through Auth0Guard. The verify hot path never sees a human session — period. The IdpAdapter interface keeps the choice of human IdP (Auth0 default, Clerk/Stytch on the path) from leaking into agent code.',
    evidence: 'apps/api/src/modules/auth0/ + Auth0Guard vs ApiKeyGuard split across controllers',
  },
  {
    adrSlug: '0016-intent-bound-attestation',
    adrTitle: 'ADR-0016 — Intent-bound attestation (`@aegis/intent-manifest`)',
    label: 'ADR-0016',
    theme: 'neutrality',
    oneLine: 'Agents declare intent in a signed manifest before acting. Mismatch surfaces as INTENT_MISMATCH.',
    why:
      'Identity-only verification answers "who is this agent." Behavioral attestation also answers "is this what the agent said it would do." A cryptographically-signed intent manifest issued before action and reconciled with the executed action lets the relying party (and any auditor) detect drift between declared and executed behavior — a class of agent compromise that pure identity verification cannot catch.',
    evidence: 'packages/intent-manifest/ + INTENT_MISMATCH at denial-precedence position 12',
  },
] as const;

const THEME_LABEL: Record<Theme, string> = {
  'cryptographic-foundation': 'Cryptographic foundation',
  verifiability: 'Verifiability',
  neutrality: 'Neutrality',
};

const THEME_INTRO: Record<Theme, string> = {
  'cryptographic-foundation':
    'Three commitments about the primitives. One signing curve, one canonical JSON format, and a key-rotation discipline that keeps yesterday\'s audit chains verifiable forever.',
  verifiability:
    'Three commitments about the guarantee. The verify decision is portable across runtimes; audit events remain verifiable across GDPR redaction; side-effects commit in the same transaction as the durable audit record.',
  neutrality:
    'Two commitments about the boundary. Human identity bridges through Auth0; agent identity is AEGIS-owned. Agents cryptographically declare intent before acting — behavioral attestation, not just identity verification.',
};

export default function ArchitecturePage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Architecture · decisions made on purpose</span>
          <h1>
            Eight commitments, each linked to the ADR{' '}
            <span className="accent">that records the reasoning.</span>
          </h1>
          <p>
            Every architectural decision worth defending has a written
            reasoning history — what was chosen, what was rejected, and what
            would have to change to reverse it. AEGIS publishes the eight
            decisions a CISO or third-party auditor will need to evaluate
            during procurement, each with the source ADR linked for the full
            text. For the refuse-to-build counterpart, see{' '}
            <a href="/principles">/principles</a>.
          </p>
          <div className="hero-proof" style={{ marginTop: 16 }}>
            <span>Eight ADRs surfaced</span>
            <span>Cryptographic primitives + verifiability + neutrality</span>
            <span>Each linked to the source decision record</span>
            <span>Parity-tested with docs/decisions/</span>
          </div>
        </div>
      </section>

      {(['cryptographic-foundation', 'verifiability', 'neutrality'] as const).map((theme) => (
        <section key={theme} className="reveal">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">{THEME_LABEL[theme]}</span>
              <h2>{themeHeadline(theme)}</h2>
              <p>{THEME_INTRO[theme]}</p>
            </div>

            <div className="layers" style={{ marginTop: 24 }}>
              {COMMITMENTS.filter((c) => c.theme === theme).map((c) => (
                <CommitmentCard key={c.adrSlug} commitment={c} />
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Read every decision</span>
            <h2>The full ADR set lives in source.</h2>
            <p>
              The eight commitments above are curated for procurement
              relevance. The complete ADR register — including the rejected
              alternatives, the constraints each decision imposes downstream,
              and the procedure for reversing one — lives in
              <code style={{ background: 'var(--bg-elev)', padding: '2px 6px', borderRadius: 3, marginLeft: 4 }}>
                docs/decisions/
              </code>{' '}
              and is read-only from this side: every ADR is dated, accepted,
              and immutable except by additive amendment.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
              <a href={`${DECISIONS_DIR}/`} className="btn btn-primary" target="_blank" rel="noreferrer">
                Browse all ADRs on GitHub →
              </a>
              <a href="/principles" className="btn btn-ghost">
                What we will NOT build →
              </a>
              <a href="/security" className="btn btn-ghost">
                Security posture →
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function themeHeadline(theme: Theme): string {
  switch (theme) {
    case 'cryptographic-foundation':
      return 'The primitives are a small, audited surface.';
    case 'verifiability':
      return 'The guarantee survives runtime, regulation, and Redis outages.';
    case 'neutrality':
      return 'The boundary between humans, agents, and intent is cryptographic — not configuration.';
  }
}

function CommitmentCard({ commitment: c }: { commitment: Commitment }): React.ReactElement {
  return (
    <div className="layer">
      <span className="layer-tag">{c.label}</span>
      <h3 style={{ marginTop: 12, marginBottom: 6 }}>{c.adrTitle.replace(/^ADR-\d+\s+—\s+/, '')}</h3>
      <p style={{ color: 'var(--text)', fontWeight: 500, marginBottom: 14 }}>
        {c.oneLine}
      </p>
      <p style={{ fontSize: 13, marginBottom: 10 }}>
        <strong style={{ color: 'var(--text)' }}>Why it matters.</strong> {c.why}
      </p>
      <p style={{ fontSize: 13, marginBottom: 10 }}>
        <strong style={{ color: 'var(--text)' }}>Where it lives.</strong>{' '}
        <code style={{ background: 'var(--bg-elev)', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>
          {c.evidence}
        </code>
      </p>
      <p style={{ fontSize: 13 }}>
        <a
          href={`${DECISIONS_DIR}/${c.adrSlug}.md`}
          target="_blank"
          rel="noreferrer"
        >
          Read the full ADR →
        </a>
      </p>
    </div>
  );
}
