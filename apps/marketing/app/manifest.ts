// Next 16 App Router file-based PWA manifest.
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AEGIS — Agent Gateway & Identity',
    short_name: 'AEGIS',
    description:
      'Cryptographic identity, policy enforcement, behavioral attestation, and signed audit rails for AI agents.',
    start_url: '/',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#3730A3',
    icons: [
      // Operator: drop favicon.png + 192/512 PNG icons into apps/marketing/public/
      // and these entries will resolve. Until then the manifest is valid but icon-less.
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
