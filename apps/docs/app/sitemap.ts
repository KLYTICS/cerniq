import type { MetadataRoute } from 'next';

import { source } from '@/lib/source';

const SITE = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.cerniq.io';

export default function sitemap(): MetadataRoute.Sitemap {
  const docPages = source.getPages().map((page) => ({
    url: `${SITE}${page.url}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
  return [
    { url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    ...docPages,
  ];
}
