import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { AppShell } from '../components/AppShell';

export const metadata: Metadata = {
  title: 'CERNIQ — Agent Gateway & Identity Stack',
  description: 'Cryptographic identity, scoped policy, and behavioral attestation for AI agents.',
};

export const viewport: Viewport = {
  themeColor: '#07090b',
  width: 'device-width',
  initialScale: 1,
  // Allow zoom — accessibility floor.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="cerniq-shell">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
