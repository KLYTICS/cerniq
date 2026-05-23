// Next 16 App Router file-based sitemap generator.
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap

import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aegis.klytics.io';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL,                   lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/try`,          lastModified: now, changeFrequency: 'weekly',  priority: 0.98 },
    { url: `${SITE_URL}/quickstart`,   lastModified: now, changeFrequency: 'weekly',  priority: 0.95 },
    { url: `${SITE_URL}/integrations`, lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/everywhere`,   lastModified: now, changeFrequency: 'weekly',  priority: 0.85 },
    { url: `${SITE_URL}/security`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/use-cases`,    lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/changelog`,    lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/privacy`,      lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/terms`,        lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/dpa`,          lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];
}
