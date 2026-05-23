import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.cerniq.io';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
