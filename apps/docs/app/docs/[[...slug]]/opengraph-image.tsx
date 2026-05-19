import { ImageResponse } from 'next/og';
import { source } from '@/lib/source';

export const runtime = 'nodejs';
export const alt = 'AEGIS Documentation';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  const title = page?.data.title ?? 'AEGIS Documentation';
  const description = page?.data.description ?? '';
  const section = (params.slug?.[0] ?? 'docs').toUpperCase();

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
            fontSize: 22,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#5BE0FF',
            fontWeight: 600,
            display: 'flex',
            gap: '12px',
          }}
        >
          <span>AEGIS</span>
          <span style={{ color: '#3F4869' }}>·</span>
          <span style={{ color: '#A8B0CC' }}>{section}</span>
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
            marginTop: '36px',
            color: '#F4F6FF',
            display: 'flex',
          }}
        >
          {title}
        </div>
        {description ? (
          <div
            style={{
              marginTop: '28px',
              fontSize: 28,
              color: '#A8B0CC',
              lineHeight: 1.4,
              maxWidth: '1000px',
              display: 'flex',
            }}
          >
            {description}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 'auto',
            fontSize: 20,
            color: '#6B7494',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#5BE0FF',
              boxShadow: '0 0 12px #5BE0FF',
            }}
          />
          <span>docs.aegislabs.io</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
