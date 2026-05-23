'use client';

// /try playground — full interactive AEGIS demo in the browser.
// Real @noble/ed25519 crypto via lib/aegis-browser.ts. Zero network.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AegisBrowser, type AuditRow, type VerifyResult, b64UrlEncode } from '../lib/aegis-browser';

interface Preset {
  label: string;
  action: string;
  amount?: number;
  amountMax: number;
  expected: 'VALID' | 'DENIED';
  reason?: string;
  description: string;
}

const PRESETS: Preset[] = [
  {
    label: '01 · Fintech ACP payment (happy)',
    action: 'orders.create',
    amount: 99,
    amountMax: 1000,
    expected: 'VALID',
    description: 'Agent has policy allowing orders.create up to $1000. Signs $99 payment.',
  },
  {
    label: '02 · Spend limit exceeded',
    action: 'orders.create',
    amount: 5000,
    amountMax: 1000,
    expected: 'DENIED',
    reason: 'SPEND_LIMIT_EXCEEDED',
    description: 'Same policy, but agent attempts $5000 against $1000 cap.',
  },
  {
    label: '03 · Scope not granted',
    action: 'payments.transfer',
    amount: 99,
    amountMax: 1000,
    expected: 'DENIED',
    reason: 'SCOPE_NOT_GRANTED',
    description: 'Policy grants orders.create only. Agent attempts payments.transfer.',
  },
  {
    label: '04 · MCP read_file (happy)',
    action: 'mcp.fs.read_file',
    amountMax: 0,
    expected: 'VALID',
    description: 'Per-tool MCP scoping — policy allows mcp.fs.read_file.',
  },
  {
    label: '05 · MCP write_file (denied)',
    action: 'mcp.fs.write_file',
    amountMax: 0,
    expected: 'DENIED',
    reason: 'SCOPE_NOT_GRANTED',
    description: 'Policy allows mcp.fs.read_file only. write_file fails per-tool check.',
  },
];

interface PlaygroundState {
  engine: AegisBrowser | null;
  agentId: string | null;
  agentPubKey: string | null;
  policyAction: string;
  policyAmountMax: string;
  signAction: string;
  signAmount: string;
  currentToken: string | null;
  lastResult: VerifyResult | null;
  chain: AuditRow[];
  offlineVerify: { valid: boolean; brokenAt?: number; reason?: string } | null;
  busy: boolean;
}

function truncate(s: string, n = 10): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function reasonColor(reason?: string): string {
  if (!reason) return 'var(--text-mute)';
  return 'var(--danger)';
}

export function Playground() {
  const engineRef = useRef<AegisBrowser | null>(null);
  const [state, setState] = useState<PlaygroundState>({
    engine: null,
    agentId: null,
    agentPubKey: null,
    policyAction: 'orders.create',
    policyAmountMax: '1000',
    signAction: 'orders.create',
    signAmount: '99',
    currentToken: null,
    lastResult: null,
    chain: [],
    offlineVerify: null,
    busy: false,
  });

  useEffect(() => {
    let cancelled = false;
    AegisBrowser.create().then((engine) => {
      if (cancelled) return;
      engineRef.current = engine;
      setState((s) => ({ ...s, engine }));
    });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(() => {
    if (!engineRef.current) return;
    const agent = engineRef.current.getAgent();
    setState((s) => ({
      ...s,
      agentId: agent?.id ?? null,
      agentPubKey: agent ? b64UrlEncode(agent.publicKey) : null,
      chain: [...engineRef.current!.getAuditChain()],
    }));
  }, []);

  const handleGenerateAgent = useCallback(async () => {
    if (!engineRef.current) return;
    setState((s) => ({ ...s, busy: true }));
    await engineRef.current.generateAgent();
    refresh();
    setState((s) => ({ ...s, busy: false, offlineVerify: null }));
  }, [refresh]);

  const handleAttachPolicy = useCallback(() => {
    if (!engineRef.current) return;
    const actions = state.policyAction.split(',').map((s) => s.trim()).filter(Boolean);
    const amountMax = Number(state.policyAmountMax);
    engineRef.current.attachPolicy({
      actions,
      amountMax: Number.isFinite(amountMax) && amountMax > 0 ? amountMax : undefined,
    });
    refresh();
  }, [state.policyAction, state.policyAmountMax, refresh]);

  const handleSignAndVerify = useCallback(async () => {
    if (!engineRef.current || !engineRef.current.getAgent()) return;
    setState((s) => ({ ...s, busy: true }));
    const amount = state.signAmount ? Number(state.signAmount) : undefined;
    const token = await engineRef.current.signAction(state.signAction, amount);
    const result = await engineRef.current.verify(token, { action: state.signAction, amount });
    setState((s) => ({ ...s, currentToken: token, lastResult: result, busy: false, offlineVerify: null }));
    refresh();
  }, [state.signAction, state.signAmount, refresh]);

  const handleVerifyChain = useCallback(async () => {
    if (!engineRef.current) return;
    setState((s) => ({ ...s, busy: true }));
    const result = await engineRef.current.verifyAuditChainOffline();
    setState((s) => ({ ...s, offlineVerify: result, busy: false }));
  }, []);

  const handleTamper = useCallback((seq: number) => {
    if (!engineRef.current) return;
    engineRef.current.tamperWithRow(seq, 'TAMPERED_BY_USER');
    refresh();
    setState((s) => ({ ...s, offlineVerify: null }));
  }, [refresh]);

  const handleFlagAnomaly = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.flagAnomaly(1);
    refresh();
  }, [refresh]);

  const handleRevokeAgent = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.revokeAgent();
    refresh();
  }, [refresh]);

  const handleReset = useCallback(async () => {
    if (!engineRef.current) return;
    engineRef.current.reset();
    setState((s) => ({
      ...s,
      agentId: null,
      agentPubKey: null,
      currentToken: null,
      lastResult: null,
      chain: [],
      offlineVerify: null,
    }));
  }, []);

  const handleLoadPreset = useCallback(async (preset: Preset) => {
    if (!engineRef.current) return;
    setState((s) => ({ ...s, busy: true }));
    engineRef.current.reset();
    await engineRef.current.generateAgent();
    engineRef.current.attachPolicy({
      actions: ['orders.create'], // Default — overridden below for MCP presets
      amountMax: preset.amountMax > 0 ? preset.amountMax : undefined,
    });
    // For MCP presets, override the policy to grant read_file only
    if (preset.action.startsWith('mcp.fs.')) {
      engineRef.current.attachPolicy({
        actions: ['mcp.fs.read_file'],
      });
    }
    const token = await engineRef.current.signAction(preset.action, preset.amount);
    const result = await engineRef.current.verify(token, { action: preset.action, amount: preset.amount });
    refresh();
    setState((s) => ({
      ...s,
      policyAction: preset.action.startsWith('mcp.fs.') ? 'mcp.fs.read_file' : 'orders.create',
      policyAmountMax: String(preset.amountMax),
      signAction: preset.action,
      signAmount: preset.amount ? String(preset.amount) : '',
      currentToken: token,
      lastResult: result,
      busy: false,
      offlineVerify: null,
    }));
  }, [refresh]);

  if (!state.engine) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 12 }}>
        Initializing signing keypair…
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      {/* ── LEFT COLUMN — controls ────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Preset selector */}
        <PanelCard title="Load preset scenario" eyebrow="Quick start">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => handleLoadPreset(p)}
                className="btn"
                style={{ justifyContent: 'flex-start', fontSize: 11, padding: '8px 10px', textAlign: 'left' }}
                disabled={state.busy}
              >
                {p.label}
              </button>
            ))}
          </div>
        </PanelCard>

        {/* Step 1: Agent */}
        <PanelCard title="1 · Agent identity" eyebrow="L1">
          <div className="kv">
            <span className="k">agent.id</span>
            <span className="v mono">{state.agentId ?? '— not generated —'}</span>
          </div>
          <div className="kv">
            <span className="k">publicKey</span>
            <span className="v mono">{state.agentPubKey ? truncate(state.agentPubKey, 30) + '…' : '—'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={handleGenerateAgent} disabled={state.busy}>
              {state.agentId ? 'Regenerate' : 'Generate keypair'}
            </button>
            {state.agentId && (
              <>
                <button className="btn btn-ghost" onClick={handleFlagAnomaly} disabled={state.busy}>
                  Flag anomaly (−100)
                </button>
                <button className="btn btn-ghost" onClick={handleRevokeAgent} disabled={state.busy}>
                  Revoke agent
                </button>
              </>
            )}
          </div>
        </PanelCard>

        {/* Step 2: Policy */}
        <PanelCard title="2 · Policy" eyebrow="L2">
          <FieldRow label="actions (comma-separated)">
            <input
              type="text"
              value={state.policyAction}
              onChange={(e) => setState((s) => ({ ...s, policyAction: e.target.value }))}
            />
          </FieldRow>
          <FieldRow label="amount_max (0 = none)">
            <input
              type="number"
              value={state.policyAmountMax}
              onChange={(e) => setState((s) => ({ ...s, policyAmountMax: e.target.value }))}
            />
          </FieldRow>
          <button className="btn" onClick={handleAttachPolicy} disabled={state.busy || !state.agentId}>
            Attach policy
          </button>
        </PanelCard>

        {/* Step 3: Sign + verify */}
        <PanelCard title="3 · Sign action and verify" eyebrow="L1 + L2 + L4">
          <FieldRow label="action">
            <input
              type="text"
              value={state.signAction}
              onChange={(e) => setState((s) => ({ ...s, signAction: e.target.value }))}
            />
          </FieldRow>
          <FieldRow label="amount (optional)">
            <input
              type="number"
              value={state.signAmount}
              onChange={(e) => setState((s) => ({ ...s, signAmount: e.target.value }))}
              placeholder="(none)"
            />
          </FieldRow>
          <button
            className="btn btn-primary"
            onClick={handleSignAndVerify}
            disabled={state.busy || !state.agentId}
          >
            Sign + verify →
          </button>

          {state.currentToken && (
            <div style={{ marginTop: 12, padding: 10, background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                token (base64url)
              </div>
              <code style={{ fontSize: 10, color: 'var(--accent)', wordBreak: 'break-all', display: 'block' }}>
                {truncate(state.currentToken, 80)}
              </code>
            </div>
          )}

          {state.lastResult && (
            <div style={{ marginTop: 10 }}>
              <ResultPill result={state.lastResult} />
            </div>
          )}
        </PanelCard>
      </div>

      {/* ── RIGHT COLUMN — audit chain + verifier ────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PanelCard title="4 · Audit chain (live)" eyebrow="L4">
          {state.chain.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-mute)', textAlign: 'center', fontFamily: 'var(--mono)' }}>
              — no events yet —
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
              {state.chain.map((row) => <AuditRowDisplay key={row.seq} row={row} onTamper={handleTamper} />)}
            </div>
          )}
        </PanelCard>

        <PanelCard title="5 · Offline chain verification" eyebrow="L4 — independent verifier">
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 10px' }}>
            Walks every row, verifies the Ed25519 signature against the AEGIS audit-signing public key, and confirms the hash-chain link to the previous row. Tampering with any row breaks this verification.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={handleVerifyChain} disabled={state.chain.length === 0 || state.busy}>
              Verify all rows
            </button>
            <button className="btn btn-ghost" onClick={handleReset} disabled={state.busy}>
              Reset
            </button>
          </div>
          {state.offlineVerify && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 4, border: '1px solid ' + (state.offlineVerify.valid ? 'var(--ok)' : 'var(--danger)'), background: state.offlineVerify.valid ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'color-mix(in srgb, var(--danger) 8%, transparent)' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: state.offlineVerify.valid ? '#6EE7B7' : '#FDA4AF', fontWeight: 600 }}>
                {state.offlineVerify.valid ? '✓ chain intact' : `✗ chain broken at seq ${state.offlineVerify.brokenAt}`}
              </div>
              {!state.offlineVerify.valid && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                  reason: {state.offlineVerify.reason}
                </div>
              )}
            </div>
          )}
        </PanelCard>

        <PanelCard title="What just happened" eyebrow="The pitch">
          <ul style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0, paddingLeft: 18 }}>
            <li>Real Ed25519 signatures via <code style={{ color: 'var(--accent)' }}>@noble/ed25519</code> — same library AEGIS production uses.</li>
            <li>Denial precedence per CLAUDE.md §6 — locked, deterministic, auditable.</li>
            <li>Every row is hash-chained + Ed25519-signed by AEGIS — offline verifiable.</li>
            <li>Try the tamper button: change any row, re-verify, watch it break.</li>
            <li>No network calls; runs entirely in your browser.</li>
          </ul>
        </PanelCard>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function PanelCard({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <article style={{
      background: 'var(--bg-elev)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {eyebrow && (
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2,
          textTransform: 'uppercase', color: 'var(--accent)',
        }}>{eyebrow}</span>
      )}
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--text)' }}>{title}</h3>
      {children}
    </article>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
      <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mute)', fontFamily: 'var(--mono)' }}>
        {label}
      </span>
      <span style={{ display: 'flex' }}>
        <style>{`label input { width: 100%; font-family: var(--mono); font-size: 12px; padding: 6px 8px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 3px; outline: none; } label input:focus { border-color: var(--accent-strong); box-shadow: 0 0 0 3px var(--accent-ring); }`}</style>
        {children}
      </span>
    </label>
  );
}

function ResultPill({ result }: { result: VerifyResult }) {
  const isValid = result.valid;
  return (
    <div style={{
      padding: 10,
      borderRadius: 4,
      border: '1px solid ' + (isValid ? 'var(--ok)' : 'var(--danger)'),
      background: isValid ? 'color-mix(in srgb, var(--ok) 10%, transparent)' : 'color-mix(in srgb, var(--danger) 10%, transparent)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 12, color: isValid ? '#6EE7B7' : '#FDA4AF', letterSpacing: 1 }}>
          {isValid ? '✓ VALID' : '✗ DENIED'}
        </span>
        {result.reason && (
          <span className="mono" style={{ fontSize: 10, color: reasonColor(result.reason) }}>
            {result.reason}
          </span>
        )}
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
          trust {result.trustScore} ({result.trustBand})
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
          seq #{result.auditSeq}
        </span>
      </div>
    </div>
  );
}

function AuditRowDisplay({ row, onTamper }: { row: AuditRow; onTamper: (seq: number) => void }) {
  const tampered = row.action === 'TAMPERED_BY_USER';
  return (
    <div style={{
      padding: '8px 10px',
      background: tampered ? 'color-mix(in srgb, var(--danger) 6%, var(--bg))' : 'var(--bg)',
      border: '1px solid ' + (tampered ? 'var(--danger)' : 'var(--border)'),
      borderRadius: 3,
      display: 'grid',
      gridTemplateColumns: '40px 1fr auto',
      gap: 10,
      alignItems: 'center',
      fontFamily: 'var(--mono)',
      fontSize: 11,
    }}>
      <span style={{ color: 'var(--text-mute)' }}>#{row.seq}</span>
      <span>
        <span style={{
          color: row.result === 'VALID' ? '#6EE7B7' : '#FDA4AF',
          fontWeight: 600,
        }}>
          {row.result === 'VALID' ? '✓' : '✗'}
        </span>{' '}
        <span style={{ color: 'var(--text)' }}>{row.action}</span>
        {row.amount !== undefined && <span style={{ color: 'var(--text-mute)' }}> ${row.amount}</span>}
        {row.reason && <span style={{ color: 'var(--danger)', marginLeft: 6 }}>{row.reason}</span>}
      </span>
      <button
        onClick={() => onTamper(row.seq)}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-dim)',
          padding: '2px 6px',
          borderRadius: 2,
          fontFamily: 'var(--mono)',
          fontSize: 9,
          cursor: 'pointer',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
        title="Mutate this row to break the chain"
      >
        Tamper
      </button>
    </div>
  );
}
