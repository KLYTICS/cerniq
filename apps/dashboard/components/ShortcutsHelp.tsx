'use client';

// Help overlay listing every global shortcut. Triggered by `?`. Closes on
// `Esc` (handled by KeyboardShortcuts) or backdrop click.

import { useEffect } from 'react';

import { COMMANDS } from '../lib/commands';

interface Props {
  onClose: () => void;
}

export function ShortcutsHelp({ onClose }: Props) {
  // Lock body scroll while overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="help-shell">
        <h2>Keyboard shortcuts</h2>
        <p className="muted">Press the chord — release between keys, no need to hold.</p>
        <div className="help-grid" role="list">
          <div role="listitem">
            <span>Open command palette</span>
            <span className="keys">
              <span className="kbd">⌘</span><span className="kbd">K</span>
            </span>
          </div>
          <div role="listitem">
            <span>Focus search on this page</span>
            <span className="keys">
              <span className="kbd">/</span>
            </span>
          </div>
          <div role="listitem">
            <span>Show this overlay</span>
            <span className="keys">
              <span className="kbd">?</span>
            </span>
          </div>
          <div role="listitem">
            <span>Dismiss any overlay</span>
            <span className="keys">
              <span className="kbd">esc</span>
            </span>
          </div>
          {COMMANDS.filter((c) => c.chord).map((c) => (
            <div role="listitem" key={c.id}>
              <span>{c.title}</span>
              <span className="keys">
                {(c.chord ?? []).map((k) => (
                  <span className="kbd" key={k}>
                    {k}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="muted">
          Pro tip: <span className="kbd">⌘</span><span className="kbd">K</span> opens the palette and
          accepts substring queries — type <code>aud</code> to jump to audit, <code>reg</code> to
          register an agent.
        </p>
      </div>
    </div>
  );
}
