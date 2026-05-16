import type { NextConfig } from 'next';

// Pull the API base from env at build time so redirects point at the right
// host per deploy environment. Default to production API for safety.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.aegis.dev';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Strict-Transport-Security — Vercel terminates TLS and adds this
          // header at the edge in prod; declaring here so dev parity is honest.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },

  // /.well-known/* routes redirect to the API, which is the canonical
  // discovery surface (RFC 9116 security.txt, JWKS, etc.). The marketing
  // site never serves these directly.
  async redirects() {
    return [
      {
        source: '/.well-known/security.txt',
        destination: `${API_BASE_URL}/.well-known/security.txt`,
        permanent: true,
      },
      {
        source: '/.well-known/jwks.json',
        destination: `${API_BASE_URL}/.well-known/jwks.json`,
        permanent: true,
      },
      {
        source: '/.well-known/openid-configuration',
        destination: `${API_BASE_URL}/.well-known/openid-configuration`,
        permanent: true,
      },
      {
        source: '/.well-known/audit-signing-key',
        destination: `${API_BASE_URL}/.well-known/audit-signing-key`,
        permanent: true,
      },
      {
        source: '/.well-known/pricing.json',
        destination: `${API_BASE_URL}/.well-known/pricing.json`,
        permanent: false, // Pricing may move to a CDN-hosted mirror; keep this rewritable.
      },
    ];
  },
};

export default nextConfig;
