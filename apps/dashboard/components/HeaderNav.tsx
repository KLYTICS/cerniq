'use client';

// Header nav with active-route detection + a Cmd-K trigger button. Lives in
// AppShell so the active highlight follows client-side soft-nav without a
// full page reload.

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { openCommandPalette } from './CommandPalette';

interface NavLink {
  href: Route;
  label: string;
}

const LINKS: ReadonlyArray<NavLink> = [
  { href: '/', label: 'Overview' },
  { href: '/agents', label: 'Agents' },
  { href: '/policies', label: 'Policies' },
  { href: '/mcp-servers', label: 'MCP' },
  { href: '/webhooks', label: 'Webhooks' },
  { href: '/audit', label: 'Audit' },
  { href: '/billing', label: 'Billing' },
  { href: '/quickstart', label: 'Quickstart' },
];

export function HeaderNav() {
  const pathname = usePathname() ?? '/';

  return (
    <header className="aegis-header">
      <span className="aegis-logo">AEGIS</span>
      <nav aria-label="Primary">
        {LINKS.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              data-active={active ? 'true' : undefined}
              prefetch
            >
              {l.label}
            </Link>
          );
        })}
        <a href="/v1/docs" target="_blank" rel="noreferrer">
          API
        </a>
      </nav>
      <span className="aegis-header-spacer" />
      <button
        type="button"
        className="kbd-trigger"
        onClick={openCommandPalette}
        aria-label="Open command palette"
        title="Command palette"
      >
        <span>Search</span>
        <span className="kbd">⌘</span>
        <span className="kbd">K</span>
      </button>
    </header>
  );
}
