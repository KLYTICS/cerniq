import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AEGIS — Agent Gateway & Identity Stack',
  description: 'Cryptographic identity, scoped policy, and behavioral attestation for AI agents.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="aegis-shell">
        <header className="aegis-header">
          <span className="aegis-logo">AEGIS</span>
          <nav>
            <a href="/">Overview</a>
            <a href="/agents">Agents</a>
            <a href="/policies">Policies</a>
            <a href="http://localhost:4000/docs" target="_blank" rel="noreferrer">
              API
            </a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
