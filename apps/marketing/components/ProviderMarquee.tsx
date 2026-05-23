// Pure-CSS infinite marquee. Server component — no JS. Doubled list so
// the loop seams are invisible (translate -50% wraps to the start of
// the duplicated half).

import { MARQUEE_FEATURED, type Integration } from '../lib/integrations';

function statusDotClass(status: Integration['status']): string {
  if (status === 'available' || status === 'beta') return 'dot';
  if (status === 'coming-soon') return 'dot soon';
  return 'dot planned';
}

export function ProviderMarquee() {
  const doubled = [...MARQUEE_FEATURED, ...MARQUEE_FEATURED];
  return (
    <div className="marquee" aria-label="Integrations supported by AEGIS">
      <div className="marquee-track">
        {doubled.map((p, i) => (
          <span key={`${p.slug}-${i}`} className="marquee-item">
            <span className={statusDotClass(p.status)} aria-hidden="true" />
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
