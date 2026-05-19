// llms.txt — a curated, plain-text index of this docs site for AI agents
// and crawlers. Convention: https://llmstxt.org/
//
// We expose the page list because the docs themselves are designed for
// machine consumption (denial precedence as a wire constant, OpenAPI as the
// source of truth). Agents that read this file can route directly to the
// right page without crawling the HTML tree.

import { source } from '@/lib/source';

export const dynamic = 'force-static';

const SITE = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.aegislabs.io';

export function GET() {
  const pages = source.getPages();
  const sections = new Map<string, typeof pages>();
  for (const page of pages) {
    const section = page.slugs[0] ?? 'overview';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(page);
  }

  const body = [
    '# AEGIS Documentation',
    '',
    '> Neutral verification, policy enforcement, and behavioral attestation',
    '> for AI agents. Public keys only, signed audit trail, vendor- and',
    '> model-neutral.',
    '',
    '## Wire contracts',
    '',
    `- [API spec (OpenAPI)](https://github.com/klytics/aegis/blob/main/docs/spec/AEGIS_API_SPEC.yaml)`,
    `- [Denial precedence (wire constant)](${SITE}/docs/concepts/denial-precedence)`,
    `- [Trust band thresholds (wire constant)](${SITE}/docs/concepts/trust-bands)`,
    `- [Webhook event catalog (wire constant)](${SITE}/docs/concepts/webhooks)`,
    `- [Pricing (well-known)](${SITE.replace('docs.', 'api.')}/.well-known/pricing.json)`,
    '',
    ...[...sections.entries()].flatMap(([section, ps]) => [
      `## ${section.charAt(0).toUpperCase()}${section.slice(1)}`,
      '',
      ...ps.map(
        (p) => `- [${p.data.title}](${SITE}${p.url}): ${p.data.description ?? ''}`,
      ),
      '',
    ]),
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
