// Next 16 file-based OG image generator (Satori under the hood).
// Renders a 1200x630 PNG on demand at /opengraph-image. Referenced
// automatically by Next.js in <meta property="og:image"> and the
// equivalent twitter:image. Uses inline styles only — Satori does not
// support CSS classes or external stylesheets.

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AEGIS — Cryptographic identity for AI agents';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#020617',
          padding: 80,
          position: 'relative',
        }}
      >
        {/* Hero glow */}
        <div
          style={{
            position: 'absolute',
            top: -200,
            right: -200,
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(165,180,252,0.20) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Top eyebrow */}
        <div
          style={{
            display: 'flex',
            fontFamily: 'monospace',
            fontSize: 18,
            letterSpacing: 6,
            color: '#A5B4FC',
            textTransform: 'uppercase',
            marginBottom: 32,
          }}
        >
          Agent Gateway & Identity
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 76,
            fontWeight: 600,
            color: '#F8FAFC',
            lineHeight: 1.08,
            letterSpacing: -2,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex' }}>Verify every AI agent.</div>
          <div style={{ display: 'flex' }}>Sign every action.</div>
          <div style={{ display: 'flex', color: '#C4B5FD' }}>Audit every outcome.</div>
        </div>

        {/* Sub */}
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            color: '#94A3B8',
            lineHeight: 1.4,
            maxWidth: 920,
            marginBottom: 'auto',
          }}
        >
          Cryptographic verification layer for the agent economy. Ed25519, FAPI 2.0-aligned, ACP-compatible.
        </div>

        {/* Proof bar */}
        <div
          style={{
            display: 'flex',
            gap: 40,
            fontFamily: 'monospace',
            fontSize: 18,
            color: '#64748B',
            letterSpacing: 1,
            marginTop: 32,
          }}
        >
          <div style={{ display: 'flex' }}>&lt;80ms p99</div>
          <div style={{ display: 'flex' }}>Ed25519 · RFC 8032</div>
          <div style={{ display: 'flex' }}>RFC 9396 RAR</div>
          <div style={{ display: 'flex' }}>SOC 2 in flight</div>
        </div>

        {/* Brand mark bottom-left */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            bottom: 80,
            right: 80,
            fontFamily: 'monospace',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 10,
            color: '#818CF8',
          }}
        >
          AEGIS
        </div>
      </div>
    ),
    { ...size },
  );
}
