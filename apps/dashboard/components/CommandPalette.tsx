'use client';

// Cmd-K command palette. Mounted globally by AppShell. Listens for Cmd/Ctrl-K
// and a custom `aegis:open-palette` event so chord shortcuts can also trigger
// it. Uses native portal-free fixed positioning + focus trap on input.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import { searchCommands, type Command } from '../lib/commands';

const OPEN_EVENT = 'aegis:open-palette';

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Open via global keyboard shortcut + dispatched event.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
      const cmdK = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (cmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpenEvent(): void {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  // Reset input + selection on (re-)open and focus the input synchronously.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Wait one frame for paint so the input element is mounted.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  const results = useMemo(() => searchCommands(query), [query]);

  // Keep activeIdx in range as results shrink.
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(Math.max(0, results.length - 1));
  }, [activeIdx, results.length]);

  // Scroll the active row into view when navigating with arrow keys.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  function execute(cmd: Command): void {
    setOpen(false);
    if (cmd.external) {
      window.open(cmd.href, '_blank', 'noopener,noreferrer');
    } else {
      // Commands carry runtime-string hrefs (`?action=register`, etc.) that
      // typedRoutes can't statically analyze — cast to Route at the boundary.
      router.push(cmd.href as Route);
    }
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) execute(r.cmd);
    }
  }

  if (!open) return null;

  return (
    <div
      className="cmdk-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        // Click outside the shell closes; clicks inside don't bubble here.
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="cmdk-shell" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Type a command — agents, audit, register, …"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search commands"
        />
        <div className="cmdk-list" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="cmdk-empty">No commands match “{query}”.</div>
          ) : null}
          {results.map((r, i) => (
            <div
              key={r.cmd.id}
              className="cmdk-item"
              role="option"
              aria-selected={i === activeIdx}
              data-idx={i}
              data-active={i === activeIdx ? 'true' : undefined}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                execute(r.cmd);
              }}
            >
              <span>{highlight(r.cmd.title, r.matchSpans)}</span>
              {r.cmd.hint ? <span className="cmdk-hint">{r.cmd.hint}</span> : null}
            </div>
          ))}
        </div>
        <div className="cmdk-footer">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> execute
          </span>
          <span>
            <span className="kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}

function highlight(title: string, spans: Array<[number, number]>): React.ReactNode {
  if (spans.length === 0) return title;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (cursor < start) out.push(<span key={`${cursor}-pre`}>{title.slice(cursor, start)}</span>);
    out.push(<mark key={`${start}-m`}>{title.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < title.length) out.push(<span key={`${cursor}-tail`}>{title.slice(cursor)}</span>);
  return out;
}

/** Programmatic open — used by chord shortcuts and the kbd-trigger button. */
export function openCommandPalette(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}
