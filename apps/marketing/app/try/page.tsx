// /try — interactive AEGIS playground. Runs entirely in the browser.
// Real @noble/ed25519 crypto via lib/aegis-browser.ts. Zero network.
// No signup, no card, no API. The visceral pitch.

import type { Metadata } from 'next';
import { Playground } from '../../components/Playground';

export const metadata: Metadata = {
  title: 'Try — AEGIS',
  description:
    'Try AEGIS in your browser. Generate an Ed25519 agent keypair, sign an action, verify against a policy, watch the audit chain build, and tamper with a row to see the offline verifier detect it. No signup, no card, no network.',
};

export default function TryPage() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 32 }}>
        <div className="container hero-inner">
          <span className="eyebrow">Try AEGIS</span>
          <h1>Run AEGIS in your browser. <span className="accent">No signup.</span></h1>
          <p>
            Real Ed25519 keypair. Real signed audit chain. Real denial precedence. Real RFC-9396
            RAR evaluator. Everything below runs locally via <code style={{ background: 'var(--bg-elev)', padding: '2px 6px', borderRadius: 3 }}>@noble/ed25519</code> —
            the same library AEGIS uses in production. Zero network calls, zero state stored, no card required.
          </p>
          <div className="hero-proof" style={{ marginTop: 16 }}>
            <span>Real Ed25519 — RFC 8032</span>
            <span>Real canonical JSON</span>
            <span>CLAUDE.md §6 denial precedence</span>
            <span>Tamper-detection live</span>
          </div>
        </div>
      </section>

      <section className="reveal">
        <div className="container">
          <Playground />
        </div>
      </section>

      <section className="reveal">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Ready for the production endpoint?</h2>
              <p>
                The browser engine implements the same denial precedence as the AEGIS API. Get your real
                AEGIS key — first 10,000 verifies free.
              </p>
            </div>
            <div className="cta-band-actions">
              <a href="/#pricing" className="btn btn-primary">Get your AEGIS key →</a>
              <a href="/quickstart" className="btn btn-ghost">Quickstart docs</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
