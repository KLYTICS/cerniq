// /proof — the verifiable-artifacts surface.
//
// `/security` says "these standards are implemented."
// `/architecture` says "these decisions are signed in source."
// `/principles` says "these refusals are durable."
// `/proof` says "here are the URLs and packages that prove all three —
//          fetch them yourself, AEGIS doesn't need to be online for you
//          to check."
//
// Each artifact below is a click-through verifiable thing: a live
// well-known endpoint, an open-source package on a registry, or a path
// in the public GitHub repo. The parity gate
// (tests/cross-package/marketing-proof-artifacts-parity.spec.ts)
// asserts each artifact resolves to a real route definition or file on
// disk — so a 404 cannot ship.

import type { Metadata } from 'next';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.aegis.klytics.io';
const REPO = 'https://github.com/klytics/aegis';

export const metadata: Metadata = {
  title: 'Proof — AEGIS · verifiable artifacts you can fetch yourself',
  description:
    'Ten verifiable artifacts published by AEGIS. Six live discovery endpoints (audit-signing JWKS, OAuth AS metadata, security.txt, retention policy, pricing), three open-source verifier libraries (relying-party, audit chain, intent manifest), and the source repo. Each artifact is parity-tested against the implementation — a broken link cannot ship.',
  openGraph: {
    title: 'AEGIS Proof — verifiable artifacts',
    description:
      'Discovery endpoints, verifier libraries, source code — every claim on AEGIS\'s marketing surface is backed by a fetchable artifact published here.',
    type: 'article',
  },
};

type Kind = 'discovery' | 'pricing' | 'library' | 'source';

interface ProofArtifact {
  slug: string;
  /** Public label rendered as the card chip. */
  label: string;
  kind: Kind;
  oneLine: string;
  whatItProves: string;
  /** Live URL the visitor clicks. */
  href: string;
  /** Route path for well-known endpoints — used by parity test to grep
   *  wellknown.controller.ts for the matching @Get decorator. */
  routePath?: string;
  /** Workspace path for verifier packages — used by parity test to
   *  assert the package.json file exists on disk and is not private. */
  packagePath?: string;
}

/**
 * Curated for procurement relevance. The full discovery surface is
 * larger (see wellknown.controller.ts); the cards here are the subset
 * a CISO needs to click during a security review.
 */
export const PROOF_ARTIFACTS: readonly ProofArtifact[] = [
  {
    slug: 'audit-signing-jwks',
    label: '/.well-known/audit-signing-key',
    kind: 'discovery',
    oneLine: 'JWKS for the audit chain. Ed25519 public keys, present + historical.',
    whatItProves:
      'Any third party can fetch this JWKS and independently verify every signature on the audit chain without contacting AEGIS at runtime. Old keys remain published forever (validUntil marks when signing stopped, not when the chain stops being verifiable).',
    href: `${API_BASE}/.well-known/audit-signing-key`,
    routePath: 'audit-signing-key',
  },
  {
    slug: 'jwks-json',
    label: '/.well-known/jwks.json',
    kind: 'discovery',
    oneLine: 'RFC 7517 JWKS endpoint — the conventional alias.',
    whatItProves:
      'Tooling that follows RFC 7517 strictly (some OAuth client libraries, security scanners) finds the JWKS at the conventional path without needing to know the AEGIS-specific name.',
    href: `${API_BASE}/.well-known/jwks.json`,
    routePath: 'jwks.json',
  },
  {
    slug: 'aegis-configuration',
    label: '/.well-known/aegis-configuration',
    kind: 'discovery',
    oneLine: 'AEGIS-specific discovery — denial precedence, trust bands, scopes.',
    whatItProves:
      'The AEGIS-specific contract (denial-reason enum, trust-band thresholds, supported scope vocabularies) is fetchable as a structured document. A relying party can build against the live discovery rather than hand-coding the contract.',
    href: `${API_BASE}/.well-known/aegis-configuration`,
    routePath: 'aegis-configuration',
  },
  {
    slug: 'oauth-as-metadata',
    label: '/.well-known/oauth-authorization-server',
    kind: 'discovery',
    oneLine: 'RFC 8414 OAuth Authorization Server Metadata.',
    whatItProves:
      'AEGIS surfaces the OAuth-shaped contract any compliant OAuth 2.0 client expects to discover — issuer, supported scopes, response types, error envelope. A standards-shaped integration is one HTTP GET away.',
    href: `${API_BASE}/.well-known/oauth-authorization-server`,
    routePath: 'oauth-authorization-server',
  },
  {
    slug: 'security-txt',
    label: '/.well-known/security.txt',
    kind: 'discovery',
    oneLine: 'RFC 9116 security contact and disclosure policy.',
    whatItProves:
      'A security researcher with a vulnerability report can find the right contact without guessing. The file lists the disclosure policy, response cadence, and security team contact at a stable conventional path.',
    href: `${API_BASE}/.well-known/security.txt`,
    routePath: 'security.txt',
  },
  {
    slug: 'retention-policy',
    label: '/.well-known/retention-policy.json',
    kind: 'discovery',
    oneLine: 'Per-plan audit retention horizons in machine-readable form.',
    whatItProves:
      'A DPA negotiation does not require reading marketing copy — the per-tier retention floor is fetchable as JSON, mirrors the table customer contracts reference, and cannot silently drift from the binding agreement.',
    href: `${API_BASE}/.well-known/retention-policy.json`,
    routePath: 'retention-policy.json',
  },
  {
    slug: 'pricing-json',
    label: '/.well-known/pricing.json',
    kind: 'pricing',
    oneLine: 'Public pricing source — the canonical numbers behind /pricing.',
    whatItProves:
      'The pricing displayed on the marketing site is fetched from this endpoint at build/render time. Drift between the dashboard\'s pricing and the published numbers becomes a one-curl-command diagnostic for any prospect.',
    href: `${API_BASE}/.well-known/pricing.json`,
    routePath: 'pricing.json',
  },
  {
    slug: 'verifier-rp',
    label: '@aegis/verifier-rp',
    kind: 'library',
    oneLine: 'Open-source relying-party verifier. Verify tokens offline.',
    whatItProves:
      'A merchant, bank, or auditor can verify AEGIS-signed agent tokens without contacting AEGIS at runtime. The library accepts an injected fetch — the offline-verifier-rp example demonstrates zero outbound network calls during verification.',
    href: `${REPO}/tree/main/packages/verifier-rp`,
    packagePath: 'packages/verifier-rp',
  },
  {
    slug: 'audit-verifier',
    label: '@aegis/audit-verifier',
    kind: 'library',
    oneLine: 'Open-source audit-chain forensic verifier.',
    whatItProves:
      'A SOC 2 auditor or compliance reviewer can pull the NDJSON export of an audit chain, fetch the JWKS, and verify every signature plus prev-hash link locally. The library ships with manifest-corpus tests so the canonical algorithm cannot drift.',
    href: `${REPO}/tree/main/packages/audit-verifier`,
    packagePath: 'packages/audit-verifier',
  },
  {
    slug: 'intent-manifest',
    label: '@aegis/intent-manifest',
    kind: 'library',
    oneLine: 'Open-source intent-manifest issuer, signer, verifier, reconciler.',
    whatItProves:
      'Behavioral attestation — the cryptographic record of "the agent declared X before doing Y" — is implemented in a framework-free package. Same code in the API, the SDK, and any third-party tool that needs to verify intent-bound attestations.',
    href: `${REPO}/tree/main/packages/intent-manifest`,
    packagePath: 'packages/intent-manifest',
  },
  {
    slug: 'github-repo',
    label: 'github.com/klytics/aegis',
    kind: 'source',
    oneLine: 'The repository, read-only and discoverable.',
    whatItProves:
      'Every claim above is grounded in source code that a procurement reviewer can read. The ADR register lives at docs/decisions/, the refuse-to-build list at docs/NON_GOALS.md, the canonical algorithms in apps/api/src/common/crypto/. Nothing in this site is built on private code.',
    href: REPO,
  },
];

const KIND_LABEL: Record<Kind, string> = {
  discovery: 'Discovery endpoints (RFC 8414, RFC 7517, RFC 9116)',
  pricing: 'Commercial transparency',
  library: 'Verifier libraries',
  source: 'Source code',
};

const KIND_INTRO: Record<Kind, string> = {
  discovery:
    'Six live well-known endpoints. Each one resolves at the API base and follows the RFC convention for its category. A security scanner or compliance tool can discover the AEGIS posture without reading a single line of marketing copy.',
  pricing:
    'One endpoint for the commercial contract. The marketing site\'s pricing table is generated from this JSON, so drift between what the prospect reads and what the API serves becomes a one-curl diagnostic.',
  library:
    'Three open-source verifier libraries. The wedge is "an auditor can verify without trusting AEGIS" — the libraries are the artifact that makes the wedge falsifiable in code rather than in marketing.',
  source: 'The source repository is public; every file referenced on this site is one click away.',
};

export default function ProofPage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Proof · fetch the artifacts yourself</span>
          <h1>
            Every claim on this site is backed by{' '}
            <span className="accent">a fetchable artifact.</span>
          </h1>
          <p>
            Discovery endpoints follow the IETF conventions a security
            scanner already knows. Verifier libraries ship as open-source
            npm packages a relying party can inspect. The source repo is
            public. Nothing about evaluating AEGIS requires trusting AEGIS
            to be online at evaluation time. The parity gate{' '}
            <code style={{ background: 'var(--bg-elev)', padding: '2px 6px', borderRadius: 3 }}>
              marketing-proof-artifacts-parity.spec.ts
            </code>{' '}
            asserts every artifact below resolves to a real route or file
            in the source tree — a 404 cannot ship.
          </p>
          <div className="hero-proof" style={{ marginTop: 16 }}>
            <span>6 live discovery endpoints</span>
            <span>3 open-source verifier libraries</span>
            <span>1 source repository</span>
            <span>Every artifact parity-tested</span>
          </div>
        </div>
      </section>

      {(['discovery', 'pricing', 'library', 'source'] as const).map((kind) => (
        <section key={kind} className="reveal">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">{KIND_LABEL[kind]}</span>
              <h2>{kindHeadline(kind)}</h2>
              <p>{KIND_INTRO[kind]}</p>
            </div>

            <div className="layers" style={{ marginTop: 24 }}>
              {PROOF_ARTIFACTS.filter((a) => a.kind === kind).map((a) => (
                <ArtifactCard key={a.slug} artifact={a} />
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">The trust loop, complete</span>
            <h2>Four pages, one structural mirror of the source.</h2>
            <p>
              <a href="/security">/security</a> publishes the standards
              posture. <a href="/architecture">/architecture</a> publishes
              the decisions. <a href="/principles">/principles</a>{' '}
              publishes the refusals. <strong>/proof</strong> publishes the
              artifacts that let any of the above be verified independently.
              Each page exports a source-of-truth array; each parity test
              asserts sync with the engineering source. The marketing
              surface is structurally a mirror — drift between marketing
              copy and engineering reality cannot land without CI catching it.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
              <a href="/security" className="btn btn-ghost">
                Security posture →
              </a>
              <a href="/architecture" className="btn btn-ghost">
                Architecture commitments →
              </a>
              <a href="/principles" className="btn btn-ghost">
                Published refusals →
              </a>
              <a href="/try" className="btn btn-primary">
                Verify in your browser →
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function kindHeadline(kind: Kind): string {
  switch (kind) {
    case 'discovery':
      return 'Live well-known endpoints — IETF-conventional paths.';
    case 'pricing':
      return 'Pricing is a fetched contract, not a promise.';
    case 'library':
      return 'Verifiers in source, npm-publishable, framework-free.';
    case 'source':
      return 'The repository is the substrate.';
  }
}

function ArtifactCard({ artifact: a }: { artifact: ProofArtifact }): React.ReactElement {
  return (
    <div className="layer">
      <span className="layer-tag">
        <code style={{ fontSize: 11 }}>{a.label}</code>
      </span>
      <p style={{ color: 'var(--text)', fontWeight: 500, marginTop: 12, marginBottom: 12 }}>
        {a.oneLine}
      </p>
      <p style={{ fontSize: 13, marginBottom: 12 }}>{a.whatItProves}</p>
      <p style={{ fontSize: 13 }}>
        <a href={a.href} target="_blank" rel="noreferrer">
          Open {a.kind === 'library' ? 'package' : a.kind === 'source' ? 'repo' : 'endpoint'} →
        </a>
      </p>
    </div>
  );
}
