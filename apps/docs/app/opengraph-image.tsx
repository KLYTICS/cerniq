import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'OKORO — Neutral verification for autonomous agents';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background:
            'radial-gradient(ellipse at top, #0B1020 0%, #050714 60%)',
          padding: '80px',
          color: '#F4F6FF',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#5BE0FF',
            fontWeight: 600,
          }}
        >
          OKORO · Documentation
        </div>
        <div
          style={{
            fontSize: 96,
            fontWeight: 600,
            lineHeight: 1.04,
            letterSpacing: '-0.04em',
            marginTop: '40px',
            backgroundImage:
              'linear-gradient(135deg, #5BE0FF 0%, #8B6BFF 50%, #FF5BD0 100%)',
            backgroundClip: 'text',
            color: 'transparent',
            display: 'flex',
          }}
        >
          Verify before you act.
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 'auto',
            fontSize: 28,
            color: '#A8B0CC',
            lineHeight: 1.4,
            maxWidth: '900px',
          }}
        >
          Neutral verification, policy, and audit for AI agents. Public keys
          only, signed audit trail, vendor- and model-neutral.
        </div>
      </div>
    ),
    { ...size },
  );
}
