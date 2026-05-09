'use client';

// Client shell that hosts global providers + always-mounted UI surfaces:
//   - ToastProvider (context for toast.push)
//   - HeaderNav (active-link highlight + cmd-K trigger)
//   - CommandPalette (Cmd/Ctrl-K)
//   - KeyboardShortcuts (g-prefixed chords, /, ?, esc)
//
// Children are server components rendered inside <main>; the 'use client'
// directive does not propagate down — the boundary is just at this file.

import type { ReactNode } from 'react';

import { CommandPalette } from './CommandPalette';
import { HeaderNav } from './HeaderNav';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { ToastProvider } from './ToastProvider';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <HeaderNav />
      <main>{children}</main>
      <CommandPalette />
      <KeyboardShortcuts />
    </ToastProvider>
  );
}
