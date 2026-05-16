import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aegis.dev'),
  title: 'AEGIS — Cryptographic identity for AI agents',
  description:
    'Neutral verification layer between AI agents and the services they act on. Ed25519-signed identity, policy enforcement, behavioral attestation, and signed audit trails. ACP-compatible. FAPI 2.0-aligned. <80ms p99 verify.',
  applicationName: 'AEGIS',
  openGraph: {
    title: 'AEGIS — Cryptographic identity for AI agents',
    description:
      'Sign every action. Scope every permission. Audit every outcome. The neutral verification layer for AI agents.',
    type: 'website',
    url: '/',
    siteName: 'AEGIS',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AEGIS — Cryptographic identity for AI agents',
    description: 'Verify every AI agent. Sign every action. Audit every outcome.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aegis.dev';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'https://app.aegis.dev';
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? '/quickstart';
const STATUS_URL = process.env.NEXT_PUBLIC_STATUS_URL ?? 'https://status.aegis.dev';
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
      name: 'AEGIS — Agent Gateway & Identity',
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Web · Edge · Node · Python · Go',
      description:
        'Cryptographic identity, policy enforcement, behavioral attestation, and signed audit rails for AI agents. Ed25519-signed. ACP-compatible. FAPI 2.0-aligned.',
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
