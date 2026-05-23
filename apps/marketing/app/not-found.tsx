// Custom 404 — maintains the cinematic brand. Static-rendered.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '404 — AEGIS',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section className="hero" style={{ minHeight: '70vh' }}>
      <div className="container hero-inner">
        <span className="eyebrow">DENIAL_REASON: ROUTE_NOT_FOUND</span>
        <h1>
          404 — <span className="accent">that route does not exist.</span>
        </h1>
        <p>
          The page you&rsquo;re looking for isn&rsquo;t here. AEGIS&rsquo; locked denial precedence
          (CLAUDE.md invariant #6) does not include a 404 code, so this one is on us.
        </p>
        <p style={{ marginTop: 16, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-mute)' }}>
          ↳ Try the home page, the integrations catalogue, or the quickstart.
        </p>
        <div className="hero-ctas" style={{ marginTop: 28 }}>
          <a href="/" className="btn btn-primary">Back to home</a>
          <a href="/integrations" className="btn btn-ghost">Browse integrations</a>
          <a href="/quickstart" className="btn btn-ghost">Quickstart</a>
        </div>
      </div>
    </section>
  );
}
