// Structured docs index — the machine-readable companion to /llms.txt.
// AI agents and external integrations can fetch this once and route
// directly to the right page without parsing HTML.
//
// Cache-Control: public, max-age=3600 (same as the pricing well-known
// endpoint). Force-static so the response is baked into the build output.

import { source } from '@/lib/source';

export const dynamic = 'force-static';

const SITE = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.cerniq.io';

export function GET() {
  const pages = source.getPages();
  return Response.json(
    {
      site: 'CERNIQ Documentation',
      url: SITE,
      generated_at: new Date().toISOString(),
      spec_version: '1.0.0',
      llms_txt: `${SITE}/llms.txt`,
      sitemap: `${SITE}/sitemap.xml`,
      search_endpoint: `${SITE}/api/search`,
      pages: pages.map((p) => ({
        url: `${SITE}${p.url}`,
        slug: p.slugs,
        section: p.slugs[0] ?? 'overview',
        title: p.data.title,
        description: p.data.description,
      })),
    },
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
