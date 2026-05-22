import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

// Canonical domain per wedge re-positioning 2026-05-15: aegis.klytics.io is
// canonical; aegis.dev is a parked redirect. All defaults reflect canonical.
// Title + description follow ~/Desktop/AEGIS_WEDGE_FINANCIAL_STANDARDS_2026-05-15.md
// § 11, reconciled against docs/spec/05_FAPI_2_0_PROFILE.md § 5 forbidden-claims
// table (no DPoP/RFC 9421/ISO 20022 in present tense).
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aegis.klytics.io'),
  title: 'AEGIS — FAPI 2.0 authorization & audit for AI agents on financial rails',
  description:
    'Sign every order. Scope every transfer. Audit every fill. FAPI 2.0 JAR (RFC 9101) + OAuth 2.0 RAR (RFC 9396) + hash-chained Ed25519 audit trail for AI agents acting on broker, payments, and banking APIs. DPoP and HTTP Message Signatures on the roadmap.',
  applicationName: 'AEGIS',
  openGraph: {
    title: 'AEGIS — FAPI 2.0 authorization for AI agents in financial services',
    description:
      'The standards layer between AI agents and the financial APIs they call. SOC 2 + ISO 27001 evidence built in via a signed, append-only audit chain.',
    type: 'website',
    url: '/',
    siteName: 'AEGIS',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AEGIS — FAPI 2.0 auth & audit for AI agents on financial rails',
    description: 'Sign every order. Scope every transfer. Audit every fill. The standards layer for AI agents on financial APIs.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aegis.klytics.io';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'https://app.aegis.klytics.io';
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? '/quickstart';
const STATUS_URL = process.env.NEXT_PUBLIC_STATUS_URL ?? 'https://status.aegis.klytics.io';
const SECURITY_EMAIL = process.env.NEXT_PUBLIC_SECURITY_EMAIL ?? 'security@aegislabs.io';
const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL ?? 'sales@aegislabs.io';

// JSON-LD structured data — Organization + SoftwareApplication + WebSite.
// Helps search engines render rich results (sitelinks, knowledge panel) +
// surfaces AEGIS as a recognized product to AI crawlers.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: 'KLYTICS LLC',
      url: SITE_URL,
      logo: `${SITE_URL}/icon-512.png`,
      sameAs: ['https://github.com/klytics/aegis'],
      contactPoint: [
        { '@type': 'ContactPoint', contactType: 'security',  email: SECURITY_EMAIL },
        { '@type': 'ContactPoint', contactType: 'sales',     email: SALES_EMAIL },
      ],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#product`,
      name: 'AEGIS — FAPI 2.0 authorization & audit for AI agents',
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Web · Edge · Node · Python · Go',
      description:
        'FAPI 2.0 JAR (RFC 9101) + OAuth 2.0 RAR (RFC 9396) + Ed25519 (RFC 8032) hash-chained audit trail for AI agents acting on financial APIs. The standards layer between AI agents and broker, payments, and banking systems.',
      offers: [
        { '@type': 'Offer', name: 'Developer',  price: '49',   priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', referenceQuantity: { '@type': 'QuantitativeValue', value: 50000, unitCode: 'C62' }, billingDuration: 'P1M' } },
        { '@type': 'Offer', name: 'Team',       price: '299',  priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', referenceQuantity: { '@type': 'QuantitativeValue', value: 500000, unitCode: 'C62' }, billingDuration: 'P1M' } },
        { '@type': 'Offer', name: 'Scale',      price: '1499', priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', referenceQuantity: { '@type': 'QuantitativeValue', value: 5000000, unitCode: 'C62' }, billingDuration: 'P1M' } },
      ],
      provider: { '@id': `${SITE_URL}/#org` },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#site`,
      url: SITE_URL,
      name: 'AEGIS',
      publisher: { '@id': `${SITE_URL}/#org` },
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* JSON-LD structured data for search engines + AI crawlers. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <header className="site-header">
          <div className="container site-header-inner">
            <a href="/" className="brand" aria-label="AEGIS home">AEGIS</a>
            <nav>
              <a href="/try">Try</a>
              <a href="/use-cases">Use cases</a>
              <a href="/integrations">Integrations</a>
              <a href="/security">Security</a>
              <a href="/#pricing">Pricing</a>
              <a href={DOCS_URL}>Docs</a>
              <a href={`${DASHBOARD_URL}/login`}>Log in</a>
              <a href="/#pricing" className="btn btn-primary" style={{ padding: '6px 14px' }}>
                Start free
              </a>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="site-footer">
          <div className="container site-footer-inner">
            <span className="brand">AEGIS</span>
            <span>© {new Date().getFullYear()} KLYTICS LLC</span>
            <nav>
              <a href="/use-cases">Use cases</a>
              <a href="/integrations">Integrations</a>
              <a href="/security">Security</a>
              <a href="/principles">Principles</a>
              <a href="/architecture">Architecture</a>
              <a href="/proof">Proof</a>
              <a href={DOCS_URL}>Docs</a>
              <a href="/changelog">Changelog</a>
              <a href={STATUS_URL}>Status</a>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="/dpa">DPA</a>
              <a href={`mailto:${SECURITY_EMAIL}`}>security@</a>
              <a href={`mailto:${SALES_EMAIL}`}>sales@</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
