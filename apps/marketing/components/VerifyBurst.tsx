'use client';

// Hero centerpiece — cycles through verify scenarios so the page is "alive"
// the moment it loads. Each scenario is a deterministic still frame (no
// Math.random in the value layer per CLAUDE.md §quality-bar), with the
// rotation interval driving the "burst" feel. Honors prefers-reduced-motion
// by stopping the rotation but keeping a single representative still frame.

import { useEffect, useState } from 'react';

interface Scenario {
  action: string;
  amount: string;
  agent: string;
  state: 'verifying' | 'valid' | 'denied';
  reason?: string;
  trustScore?: number;
}

const SCENARIOS: Scenario[] = [
  { action: 'orders.create',       amount: '$  99.00', agent: 'agt_b7c2f',  state: 'valid',  trustScore: 712 },
  { action: 'payments.transfer',   amount: '$2,499.00', agent: 'agt_92ae0', state: 'denied', reason: 'TRUST_SCORE_TOO_LOW' },
  { action: 'mcp.gh.merge_pr',     amount: '       —',  agent: 'agt_d54f1', state: 'valid',  trustScore: 884 },
  { action: 'treasury.fx_convert', amount: '$50,000.00', agent: 'agt_a01ab', state: 'denied', reason: 'SCOPE_NOT_GRANTED' },
  { action: 'docs.read',           amount: '       —',  agent: 'agt_e7720', state: 'valid',  trustScore: 645 },
];

const VERIFY_DURATION_MS = 700;
const HOLD_DURATION_MS = 2400;
const CYCLE_TOTAL_MS = VERIFY_DURATION_MS + HOLD_DURATION_MS;

export function VerifyBurst() {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'verifying' | 'resolved'>('resolved');

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setPhase('verifying');
      const resolve = setTimeout(() => {
        if (cancelled) return;
        setPhase('resolved');
      }, VERIFY_DURATION_MS);
      const next = setTimeout(() => {
        if (cancelled) return;
        setIdx((i) => (i + 1) % SCENARIOS.length);
        tick();
      }, CYCLE_TOTAL_MS);
      return () => { clearTimeout(resolve); clearTimeout(next); };
    };

    // Respect reduced motion — render a single representative still.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const cleanup = tick();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const s = SCENARIOS[idx]!;
  const showVerifying = phase === 'verifying';
  const result = showVerifying ? null : s;

  return (
    <div className="verify-stage" aria-label="AEGIS verify demo">
      <div className="verify-row">
        <span className="label">Agent</span>
        <span className="value mono">{s.agent}</span>
      </div>
      <div className="verify-row">
        <span className="label">Action</span>
        <span className="value mono">{s.action}</span>
      </div>
      <div className="verify-row">
        <span className="label">Amount</span>
        <span className="value mono">{s.amount}</span>
      </div>
      <div className="verify-row">
        <span className="label">Token</span>
        <span className="verify-token mono">aegis_sk_…</span>
      </div>
      <div className="verify-divider" />
      <div className="verify-row">
        <span className="label">Verify</span>
        <span className="value">
          {showVerifying ? (
            <span>
              <span className="verify-spinner" aria-hidden="true" />
              <span style={{ color: 'var(--text-dim)' }}>POST /v1/verify…</span>
            </span>
          ) : result?.state === 'valid' ? (
            <span className="verify-result">
              <span className="pill pill-ok">VALID</span>
              <span style={{ marginLeft: 8, color: 'var(--text-dim)', fontSize: 10 }}>
                trustScore <span style={{ color: 'var(--accent)' }}>{result.trustScore}</span>
              </span>
            </span>
          ) : (
            <span className="verify-result">
              <span className="pill pill-deny">DENIED</span>
              <span style={{ marginLeft: 8, color: 'var(--text-dim)', fontSize: 10 }}>
                {result?.reason}
              </span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
