import './global.css';
import { RootProvider } from 'fumadocs-ui/provider';
import type { ReactNode } from 'react';

export const metadata = {
  // metadataBase enables Next.js to resolve absolute URLs for OG images,
  // Twitter cards, and canonical links. Defaults to the prod hostname so
  // share previews work even when NEXT_PUBLIC_DOCS_URL isn't set locally.
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.okoroapp.com'),
  title: 'OKORO Documentation',
  description:
    'Neutral verification, policy, and audit for AI agents. Live documentation rendered from the running platform.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="okoro-canvas flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
