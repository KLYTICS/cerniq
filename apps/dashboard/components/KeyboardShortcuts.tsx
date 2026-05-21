'use client';

// Global keyboard chord handler.
//   g <k>  — `g`-prefixed two-key chord routes to the matching Command.
//   ?      — open shortcuts help overlay.
//   /      — focus the page's first <input> (search-bar style).
//   esc    — close the shortcuts overlay.
//
// The handler ignores keystrokes when the user is typing in an input/textarea
// or contentEditable surface. The chord-mode timeout window is 1.2s — long
// enough for human chord typing, short enough that stray `g` doesn't latch.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { COMMANDS } from '../lib/commands';

import { ShortcutsHelp } from './ShortcutsHelp';

const CHORD_PREFIX = 'g';
const CHORD_TIMEOUT_MS = 1_200;

export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let chordPending = false;
    let chordTimer: ReturnType<typeof setTimeout> | null = null;

    function clearChord(): void {
      chordPending = false;
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    }

    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function onKey(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = isTyping(e.target);

      if (!typing && e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === 'Escape' && helpOpen) {
        e.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (!typing && e.key === '/') {
        const input = document.querySelector<HTMLInputElement>(
          'main input[type="text"], main input[type="search"], main input:not([type])',
        );
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
          return;
        }
      }
      if (typing) return;

      const k = e.key.toLowerCase();

      if (chordPending) {
        const cmd = COMMANDS.find((c) => c.chord?.[0] === CHORD_PREFIX && c.chord[1] === k);
        clearChord();
        if (cmd) {
          e.preventDefault();
          if (cmd.external) {
            window.open(cmd.href, '_blank', 'noopener,noreferrer');
          } else {
            router.push(cmd.href);
          }
        }
        return;
      }

      if (k === CHORD_PREFIX) {
        chordPending = true;
        chordTimer = setTimeout(clearChord, CHORD_TIMEOUT_MS);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearChord();
    };
  }, [helpOpen, router]);

  return helpOpen ? <ShortcutsHelp onClose={() => { setHelpOpen(false); }} /> : null;
}
