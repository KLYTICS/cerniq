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
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
