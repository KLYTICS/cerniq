// Hero — server component that composes the verify-burst demo and live
// counter. The dramatic entrance is CSS-driven (see globals.css
// .hero-inner > * staggered fade-up-in keyframes).

import { LiveCounter } from './LiveCounter';
import { VerifyBurst } from './VerifyBurst';

interface HeroProps {
  /** Primary CTA href — usually a Stripe Payment Link or signup route. */
  primaryHref: string;
  /** Secondary CTA href — usually #quickstart or /docs. */
  secondaryHref: string;
}

export function Hero({ primaryHref, secondaryHref }: HeroProps) {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-cinematic-layout">
          <div className="hero-inner">
            <span className="eyebrow">The Agent Economy Has Arrived</span>
            <h1>
              Verify every AI agent. <br />
              Sign every action. <br />
              <span className="accent">Audit every outcome.</span>
            </h1>
            <p>
              AEGIS is the cryptographic verification layer between AI agents and the services
              they act on. Ed25519-signed identity, policy-bound scopes, behavioral attestation,
              and a hash-chained audit log — built for the new age of autonomous software.
            </p>
            <div className="hero-ctas">
              <a href={primaryHref} className="btn btn-primary">Get your AEGIS key →</a>
              <a href="/try" className="btn btn-ghost">Try in your browser — no signup</a>
              <a href={secondaryHref} className="btn btn-ghost">Quickstart</a>
            </div>
            <div className="hero-proof">
              <span>&lt;80ms p99 verify</span>
              <span>Ed25519 · RFC 8032</span>
              <span>FAPI 2.0-aligned</span>
              <span>ACP-compatible</span>
              <span>SOC 2 in progress</span>
            </div>
            <div style={{ marginTop: 18 }}>
              <LiveCounter />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <VerifyBurst />
          </div>
        </div>
      </div>
    </section>
  );
}
