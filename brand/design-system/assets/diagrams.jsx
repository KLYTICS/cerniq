// AEGIS — canonical diagrams
// Per brand foundation §9.3: 1.5px slate-700 stroke, slate-100 fill,
// indigo highlight on the verify hot path. text-sm Inter, mono only
// for endpoints. Always one highlighted path.

const D_INDIGO = '#3730A3';
const D_INDIGO_50 = '#EEF2FF';
const D_SLATE_700 = '#334155';
const D_SLATE_500 = '#64748B';
const D_SLATE_400 = '#94A3B8';
const D_SLATE_200 = '#E2E8F0';
const D_SLATE_100 = '#F1F5F9';
const D_SLATE_50  = '#F8FAFC';
const D_SLATE_900 = '#0F172A';
const D_EMERALD = '#10B981';
const D_ROSE    = '#F43F5E';
const D_AMBER   = '#F59E0B';

function diagBox({ x, y, w, h, label, sub, highlighted, mono }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6"
            fill={highlighted ? D_INDIGO_50 : D_SLATE_100}
            stroke={highlighted ? D_INDIGO : D_SLATE_700}
            strokeWidth="1.5" />
      <text x={x + w/2} y={y + h/2 - (sub ? 6 : 0)}
            fontSize="13" fontFamily={mono ? 'JetBrains Mono, monospace' : 'Inter, sans-serif'}
            fontWeight="500" textAnchor="middle"
            fill={highlighted ? D_INDIGO : D_SLATE_900}
            dominantBaseline="middle">{label}</text>
      {sub && (
        <text x={x + w/2} y={y + h/2 + 12}
              fontSize="11" fontFamily="Inter, sans-serif"
              textAnchor="middle" fill={D_SLATE_500}
              dominantBaseline="middle">{sub}</text>
      )}
    </g>
  );
}

function arrow({ x1, y1, x2, y2, highlighted, label, dashed }) {
  const id = `ar-${x1}-${y1}-${x2}-${y2}`;
  return (
    <g>
      <defs>
        <marker id={id} viewBox="0 0 8 8" refX="7" refY="4"
                markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={highlighted ? D_INDIGO : D_SLATE_500} />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={highlighted ? D_INDIGO : D_SLATE_500}
            strokeWidth={highlighted ? 2 : 1.5}
            strokeDasharray={dashed ? '4 3' : 'none'}
            markerEnd={`url(#${id})`} />
      {label && (
        <text x={(x1+x2)/2} y={(y1+y2)/2 - 6}
              fontSize="10" fontFamily="Inter, sans-serif"
              textAnchor="middle" fill={highlighted ? D_INDIGO : D_SLATE_500}
              fontWeight="500">{label}</text>
      )}
    </g>
  );
}

// 4-LAYER STACK — the canonical motif
function FourLayerStack() {
  const W = 720, H = 480;
  const layerW = 540, layerH = 64, lx = 90;
  const layers = [
    { y: 360, label: 'Identity',    sub: 'Public-key registry · principal binding',     hi: false },
    { y: 280, label: 'Policy',      sub: 'Scopes · spend caps · denial precedence',      hi: false },
    { y: 200, label: 'Verify',      sub: 'Ed25519 signature check · <80ms p99',          hi: true  },
    { y: 120, label: 'Audit',       sub: 'Hash-chained event log · forensic primitive',  hi: false }
  ];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={W} height={H} fill={D_SLATE_50} />
      <text x="40" y="50" fontSize="12" fontFamily="Inter, sans-serif"
            fontWeight="600" letterSpacing="2" fill={D_SLATE_500}>THE AEGIS STACK</text>
      <text x="40" y="78" fontSize="22" fontFamily="Inter, sans-serif"
            fontWeight="600" fill={D_SLATE_900}>Four layers · one signed primitive</text>
      {layers.map((l, i) => (
        <g key={l.label}>{diagBox({
          x: lx, y: l.y, w: layerW, h: layerH,
          label: l.label, sub: l.sub, highlighted: l.hi
        })}</g>
      ))}
      {/* Hot path overlay arrow */}
      <text x={lx + layerW + 20} y="232" fontSize="10" fontFamily="Inter, sans-serif"
            fontWeight="600" letterSpacing="1" fill={D_INDIGO}>HOT PATH</text>
      <line x1={lx + layerW + 12} y1="244" x2={lx + layerW + 12} y2="220"
            stroke={D_INDIGO} strokeWidth="2" />
      <text x={lx} y={H - 24} fontSize="11" fontFamily="JetBrains Mono, monospace"
            fill={D_SLATE_500}>POST /v1/verify  →  signed response  →  audit append</text>
    </svg>
  );
}

// VERIFY HOT PATH — the request lifecycle
function VerifyHotPath() {
  const W = 880, H = 360;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={W} height={H} fill={D_SLATE_50} />
      <text x="40" y="44" fontSize="12" fontFamily="Inter, sans-serif"
            fontWeight="600" letterSpacing="2" fill={D_SLATE_500}>VERIFY HOT PATH</text>
      <text x="40" y="72" fontSize="22" fontFamily="Inter, sans-serif"
            fontWeight="600" fill={D_SLATE_900}>From request to signed decision · &lt;80ms p99</text>

      {diagBox({ x: 40,  y: 140, w: 130, h: 70, label: 'Agent',          sub: 'private key' })}
      {diagBox({ x: 230, y: 140, w: 130, h: 70, label: 'Relying Party',  sub: 'merchant API' })}
      {diagBox({ x: 420, y: 140, w: 150, h: 70, label: 'AEGIS Verify',   sub: 'Ed25519 + policy', highlighted: true, mono: false })}
      {diagBox({ x: 630, y: 140, w: 130, h: 70, label: 'Policy Engine',  sub: 'denial precedence' })}
      {diagBox({ x: 420, y: 260, w: 150, h: 60, label: 'Audit Chain',    sub: 'append-only', mono: false })}

      {arrow({ x1: 170, y1: 175, x2: 230, y2: 175, label: 'signed action' })}
      {arrow({ x1: 360, y1: 175, x2: 420, y2: 175, label: 'verify()', highlighted: true })}
      {arrow({ x1: 570, y1: 175, x2: 630, y2: 175, label: 'evaluate' })}
      {arrow({ x1: 630, y1: 195, x2: 570, y2: 195, label: 'allow / deny', highlighted: true })}
      {arrow({ x1: 495, y1: 210, x2: 495, y2: 260, label: 'append', dashed: true })}
      {arrow({ x1: 420, y1: 195, x2: 360, y2: 195, label: 'signed receipt', highlighted: true })}

      <text x={W - 40} y={H - 20} fontSize="11" fontFamily="JetBrains Mono, monospace"
            textAnchor="end" fill={D_SLATE_500}>p99 = 78ms · us-east · 2026-05-08</text>
    </svg>
  );
}

// DENIAL PRECEDENCE LADDER — the security model
function DenialLadder() {
  const W = 560, H = 460;
  const rungs = [
    { rank: 1, label: 'Revocation',          sub: 'agent or key revoked',           color: D_ROSE },
    { rank: 2, label: 'Scope mismatch',      sub: 'action outside granted scopes',  color: D_ROSE },
    { rank: 3, label: 'Spend cap exceeded',  sub: 'over policy budget',             color: D_ROSE },
    { rank: 4, label: 'Anomaly threshold',   sub: 'BATE score below floor',         color: D_AMBER },
    { rank: 5, label: 'Default allow',       sub: 'all checks passed',              color: D_EMERALD }
  ];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={W} height={H} fill={D_SLATE_50} />
      <text x="40" y="44" fontSize="12" fontFamily="Inter, sans-serif"
            fontWeight="600" letterSpacing="2" fill={D_SLATE_500}>DENIAL PRECEDENCE</text>
      <text x="40" y="72" fontSize="22" fontFamily="Inter, sans-serif"
            fontWeight="600" fill={D_SLATE_900}>Fixed order. Public. Auditable.</text>

      {rungs.map((r, i) => {
        const y = 110 + i * 64;
        return (
          <g key={r.rank}>
            <line x1="60" y1={y + 24} x2="500" y2={y + 24}
                  stroke={D_SLATE_200} strokeWidth="1" />
            <circle cx="80" cy={y + 24} r="14" fill={r.color} fillOpacity="0.12"
                    stroke={r.color} strokeWidth="1.5" />
            <text x="80" y={y + 28} fontSize="12" fontFamily="JetBrains Mono, monospace"
                  fontWeight="500" textAnchor="middle" fill={r.color}>{r.rank}</text>
            <text x="110" y={y + 20} fontSize="15" fontFamily="Inter, sans-serif"
                  fontWeight="600" fill={D_SLATE_900}>{r.label}</text>
            <text x="110" y={y + 36} fontSize="12" fontFamily="Inter, sans-serif"
                  fill={D_SLATE_500}>{r.sub}</text>
            <rect x="430" y={y + 12} width="80" height="22" rx="3"
                  fill={r.color} fillOpacity="0.08" />
            <text x="470" y={y + 27} fontSize="10" fontFamily="JetBrains Mono, monospace"
                  fontWeight="500" textAnchor="middle" fill={r.color}>
              {r.rank < 4 ? 'DENY' : r.rank === 4 ? 'WARN' : 'ALLOW'}
            </text>
          </g>
        );
      })}
      <text x="40" y={H - 24} fontSize="11" fontFamily="JetBrains Mono, monospace"
            fill={D_SLATE_500}>first-match-wins · top-to-bottom · never reordered</text>
    </svg>
  );
}

// BATE TRUST SCORE GAUGE
function BATEGauge({ value = 86 }) {
  const W = 360, H = 320;
  const cx = 180, cy = 200, r = 100;
  const startAngle = Math.PI * 0.85;
  const endAngle = Math.PI * 0.15;
  const angle = startAngle + (endAngle - startAngle + (endAngle < startAngle ? 2 * Math.PI : 0)) * (value / 100);
  const arcEnd = {
    x: cx + r * Math.cos(angle - 2 * Math.PI),
    y: cy + r * Math.sin(angle - 2 * Math.PI)
  };
  const trackEnd = {
    x: cx + r * Math.cos(endAngle),
    y: cy + r * Math.sin(endAngle)
  };
  const trackStart = {
    x: cx + r * Math.cos(startAngle),
    y: cy + r * Math.sin(startAngle)
  };
  const largeArcTrack = 1;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={W} height={H} fill={D_SLATE_50} />
      <text x={W/2} y="40" fontSize="11" fontFamily="Inter, sans-serif"
            fontWeight="600" letterSpacing="2" textAnchor="middle"
            fill={D_SLATE_500}>BATE TRUST SCORE</text>
      <path d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArcTrack} 1 ${trackEnd.x} ${trackEnd.y}`}
            stroke={D_SLATE_200} strokeWidth="14" fill="none" strokeLinecap="round" />
      <path d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${value > 50 ? 1 : 0} 1 ${arcEnd.x} ${arcEnd.y}`}
            stroke={D_INDIGO} strokeWidth="14" fill="none" strokeLinecap="round" />
      <text x={cx} y={cy + 4} fontSize="56" fontFamily="Inter, sans-serif"
            fontWeight="700" textAnchor="middle" fill={D_SLATE_900}
            letterSpacing="-2">{value}</text>
      <text x={cx} y={cy + 28} fontSize="11" fontFamily="JetBrains Mono, monospace"
            textAnchor="middle" fill={D_SLATE_500}>/ 100</text>
      <text x={cx - 88} y={cy + 60} fontSize="10" fontFamily="JetBrains Mono, monospace"
            fill={D_SLATE_400}>0</text>
      <text x={cx + 80} y={cy + 60} fontSize="10" fontFamily="JetBrains Mono, monospace"
            fill={D_SLATE_400}>100</text>
      <text x={cx} y={H - 24} fontSize="12" fontFamily="Inter, sans-serif"
            textAnchor="middle" fontWeight="500" fill={D_INDIGO}>HEALTHY · stable 7d</text>
    </svg>
  );
}

// CODE SAMPLE TREATMENT — the bold-italic AEGIS-call signature
function CodeSample() {
  const W = 720, H = 360;
  return (
    <div style={{ width: W, height: H, background: D_SLATE_50, fontFamily: 'Inter, sans-serif',
                  display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 28px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, color: D_SLATE_500 }}>
          CODE SAMPLE TREATMENT
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: D_SLATE_900, marginTop: 6 }}>
          AEGIS calls render bold-italic — the typographic signature
        </div>
      </div>
      <div style={{ margin: '0 28px 28px', border: `1px solid ${D_SLATE_200}`, borderRadius: 6,
                    background: '#fff', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 14px', borderBottom: `1px solid ${D_SLATE_200}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 11, color: D_SLATE_500 }}>
          <span style={{ letterSpacing: 1.5, fontWeight: 600 }}>TYPESCRIPT · server.ts</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>copy</span>
        </div>
        <pre style={{ margin: 0, padding: '16px 18px', fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 13, lineHeight: '22px', color: D_SLATE_900,
                      flex: 1, position: 'relative' }}>
{`import { aegis } from '@aegis/sdk';

`}<span style={{ color: D_SLATE_500 }}>{`// verify the signed agent action`}</span>{`
const result = await `}<span style={{ color: D_INDIGO, fontWeight: 600, fontStyle: 'italic' }}>aegis.verify</span>{`({
  token:   req.headers['x-aegis-token'],
  scopes:  [`}<span style={{ color: '#059669' }}>{`'payments.transfer'`}</span>{`],
  cap_usd: `}<span style={{ color: D_INDIGO, fontWeight: 600 }}>500</span>{`,
});

if (!result.ok) return res.status(`}<span style={{ color: D_INDIGO, fontWeight: 600 }}>403</span>{`).json(result.error);
`}
        </pre>
        <div style={{ position: 'absolute' }} />
      </div>
    </div>
  );
}

// HERO TEXTURE — sparse grid + faded radial + mark at 4%
function HeroTexture() {
  const W = 720, H = 360;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke={D_SLATE_200} strokeWidth="1" />
        </pattern>
        <radialGradient id="glow" cx="30%" cy="40%" r="60%">
          <stop offset="0%" stopColor={D_INDIGO} stopOpacity="0.08" />
          <stop offset="100%" stopColor={D_INDIGO} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={D_SLATE_50} />
      <rect width={W} height={H} fill="url(#grid)" />
      <rect width={W} height={H} fill="url(#glow)" />
      <g opacity="0.04" transform="translate(540, 90)">
        <path d="M64 0 L120 110 H100 L92 92 H36 L28 110 H8 Z" fill={D_INDIGO} />
      </g>
      <text x="48" y="180" fontSize="48" fontFamily="Inter, sans-serif"
            fontWeight="700" fill={D_SLATE_900} letterSpacing="-1.5">
        Sign every action.
      </text>
      <text x="48" y="220" fontSize="48" fontFamily="Inter, sans-serif"
            fontWeight="700" fill={D_INDIGO} letterSpacing="-1.5">
        Verify in 80ms.
      </text>
      <text x="48" y="260" fontSize="48" fontFamily="Inter, sans-serif"
            fontWeight="700" fill={D_SLATE_900} letterSpacing="-1.5">
        Hold zero keys.
      </text>
      <text x="48" y="304" fontSize="13" fontFamily="JetBrains Mono, monospace"
            fill={D_SLATE_500}>$ npm install @aegis/sdk</text>
    </svg>
  );
}

// COLOR TOKEN REFERENCE
function ColorTokens() {
  const W = 720, H = 320;
  const slate = [
    { name: 'slate-50',  hex: '#F8FAFC' },
    { name: 'slate-100', hex: '#F1F5F9' },
    { name: 'slate-200', hex: '#E2E8F0' },
    { name: 'slate-400', hex: '#94A3B8' },
    { name: 'slate-700', hex: '#334155' },
    { name: 'slate-900', hex: '#0F172A' },
    { name: 'slate-950', hex: '#020617' }
  ];
  const aegis = [
    { name: 'aegis-50',  hex: '#EEF2FF' },
    { name: 'aegis-100', hex: '#E0E7FF' },
    { name: 'aegis-300', hex: '#A5B4FC' },
    { name: 'aegis-500', hex: '#3730A3' },
    { name: 'aegis-700', hex: '#1E1B4B' }
  ];
  const semantic = [
    { name: 'success', hex: '#10B981' },
    { name: 'warning', hex: '#F59E0B' },
    { name: 'danger',  hex: '#F43F5E' }
  ];
  const swatch = (s, x, y) => (
    <g key={s.name + x}>
      <rect x={x} y={y} width="68" height="56" rx="4" fill={s.hex}
            stroke={D_SLATE_200} strokeWidth="1" />
      <text x={x} y={y + 76} fontSize="11" fontFamily="JetBrains Mono, monospace"
            fill={D_SLATE_900} fontWeight="500">{s.name}</text>
      <text x={x} y={y + 90} fontSize="10" fontFamily="JetBrains Mono, monospace"
            fill={D_SLATE_500}>{s.hex}</text>
    </g>
  );
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={W} height={H} fill={D_SLATE_50} />
      <text x="40" y="40" fontSize="11" fontFamily="Inter, sans-serif"
            fontWeight="600" letterSpacing="2" fill={D_SLATE_500}>COLOR TOKENS</text>
      <text x="40" y="64" fontSize="13" fontFamily="Inter, sans-serif"
            fontWeight="500" fill={D_SLATE_500}>Neutral spine</text>
      {slate.map((s, i) => swatch(s, 40 + i * 84, 76))}
      <text x="40" y="200" fontSize="13" fontFamily="Inter, sans-serif"
            fontWeight="500" fill={D_SLATE_500}>Aegis indigo</text>
      {aegis.map((s, i) => swatch(s, 40 + i * 84, 212))}
      <text x="500" y="200" fontSize="13" fontFamily="Inter, sans-serif"
            fontWeight="500" fill={D_SLATE_500}>Semantic</text>
      {semantic.map((s, i) => swatch(s, 500 + i * 76, 212))}
    </svg>
  );
}

Object.assign(window, {
  FourLayerStack, VerifyHotPath, DenialLadder, BATEGauge,
  CodeSample, HeroTexture, ColorTokens
});
