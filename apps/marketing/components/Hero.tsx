// Hero — server component that composes the verify-burst demo and live
// counter. The dramatic entrance is CSS-driven (see globals.css
// .hero-inner > * staggered fade-up-in keyframes).

import { LiveCounter } from './LiveCounter';
import { VerifyBurst } from './VerifyBurst';

interface HeroProps {
  /**
   * Secondary CTA href ("Talk to the team") — until Phase 0 closes this is
   * a `mailto:` (see docs/LAUNCH_RUNBOOK.md § Phase 0); post-v1.1 this
   * becomes a Flow-B checkout-session URL. Primary CTA ("Verify your first
   * agent → $0") routes to `/try` unconditionally — no authentication
   * required.
   */
  primaryHref: string;
}

export function Hero({ primaryHref }: HeroProps) {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-cinematic-layout">
          <div className="hero-inner">
            <span className="eyebrow">FAPI 2.0 · OAuth 2.0 RAR · Ed25519 audit chain</span>
            <h1>
              Your AI agent&rsquo;s first Plaid call.<br />
              <span className="accent">Your auditor&rsquo;s last sleepless night.</span>
            </h1>
            <p>
              AEGIS implements FAPI 2.0 JAR (RFC 9101) + OAuth 2.0 RAR (RFC 9396) for AI agents,
              so every order, transfer, and fund move is signed, scoped, and immutably audited.
              Generate SOC 2, ISO 27001, and SR 11-7 evidence with one integration.
            </p>
            <div className="hero-ctas">
              <a href="/try" className="btn btn-primary">Verify your first agent → $0</a>
              <a href={primaryHref} className="btn btn-ghost">Talk to the team</a>
            </div>
            <div className="hero-proof">
              <span>RFC 9101 JAR</span>
              <span>RFC 9396 RAR</span>
              <span>Ed25519 · RFC 8032</span>
              <span>OAuth AS Metadata · RFC 8414</span>
              <span>Hash-chained audit · ADR-0015</span>
              <span>SOC 2 evidence pack</span>
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
