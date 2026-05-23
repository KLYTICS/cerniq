import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // typedRoutes moved out of experimental in Next 16 (now GA).
  typedRoutes: true,
};

export default config;
