// /changelog — newest-first release notes. Sourced from
// lib/changelog.ts which is append-only (peers add entries when work
// lands; never edit past entries — changelog mirrors the audit chain).

import type { Metadata } from 'next';
import { CHANGELOG, TYPE_LABEL, TYPE_COLOR, entryCount } from '../../lib/changelog';

export const metadata: Metadata = {
  title: 'Changelog — AEGIS',
  description:
    'AEGIS release notes. Append-only. Every entry is dated, scoped, and tagged by type (release / feature / breaking / security / fix / docs).',
};

function groupByMonth(): Array<{ month: string; entries: typeof CHANGELOG }> {
  const groups = new Map<string, typeof CHANGELOG>();
  for (const e of CHANGELOG) {
    const month = e.date.slice(0, 7); // YYYY-MM
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(e);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, entries]) => ({ month, entries }));
}

function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDate(iso: string): string {
  const date = new Date(iso + 'T00:00:00Z');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function ChangelogPage() {
  const groups = groupByMonth();
  const counts = entryCount();
  const total = CHANGELOG.length;

  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Changelog</span>
          <h1>What we shipped. <span className="accent">When we shipped it.</span></h1>
          <p>
            Append-only. Every entry is scoped, dated, and tagged. Peers add entries when their work
            lands — the file at <code>apps/marketing/lib/changelog.ts</code> is the source of truth and
            mirrors the discipline of the AEGIS audit chain itself (no edits, only appends).
          </p>
          <div className="hero-proof" style={{ marginTop: 24 }}>
            <span>{total} entries</span>
            <span>{counts.release} releases</span>
            <span>{counts.feature} features</span>
            <span>{counts.security} security items</span>
            <span>{counts.breaking} breaking changes</span>
          </div>
        </div>
      </section>

      {/* ─── Entry stream — by month ─────────────────────────────── */}
      {groups.map((g) => (
        <section key={g.month} className="reveal" id={g.month}>
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">{formatMonth(g.month)}</span>
              <h2 style={{ fontSize: 24 }}>{g.entries.length} entries</h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              {g.entries.map((e, idx) => (
                <article
                  key={`${e.date}-${e.title}`}
                  style={{
                    background: 'var(--bg-elev)',
                    padding: '20px 24px',
                    borderBottom: idx === g.entries.length - 1 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-mute)', letterSpacing: '0.05em' }}>
                      {formatDate(e.date)}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 2,
                        border: `1px solid ${TYPE_COLOR[e.type]}`,
                        color: TYPE_COLOR[e.type],
                        background: 'transparent',
                      }}
                    >
                      {TYPE_LABEL[e.type]}
                    </span>
                    <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text)' }}>{e.title}</h3>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 12px', lineHeight: 1.6 }}>
                    {e.body}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10 }}>
                    {e.scope.map((s) => (
                      <span
                        key={s}
                        className="mono"
                        style={{
                          padding: '2px 6px',
                          border: '1px solid var(--border-strong)',
                          borderRadius: 2,
                          color: 'var(--text-dim)',
                          background: 'var(--bg)',
                        }}
                      >
                        {s}
                      </span>
                    ))}
                    {e.refs?.map((r) => (
                      <span
                        key={r}
                        className="mono"
                        style={{
                          padding: '2px 6px',
                          color: 'var(--text-mute)',
                        }}
                      >
                        ↳ {r}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* ─── Footer note ─────────────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Append-only by design.</h2>
              <p>
                The changelog mirrors the AEGIS audit chain&rsquo;s discipline: append-only, scoped,
                cryptographically anchored. No silent edits, no retconning history. Subscribe via
                the RSS feed (coming soon) or follow KLYTICS/aegis on GitHub.
              </p>
            </div>
            <div className="cta-band-actions">
              <a href="https://github.com/klytics/aegis" className="btn btn-primary">View on GitHub →</a>
              <a href="/" className="btn btn-ghost">Back to overview</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
