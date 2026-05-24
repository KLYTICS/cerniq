import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';

import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) return {};
  // fumadocs' source.getPage returns `page.data` as `any` in the CI
  // type environment (the .source types aren't materialized until a
  // build pass). Narrow once to the expected frontmatter shape so the
  // rest of the function works against typed fields — satisfies
  // restrict-template-expressions, no-unnecessary-type-conversion, and
  // no-unnecessary-type-assertion together.
  const data = page.data as { title: string; description?: string };
  return {
    title: `${data.title} · CERNIQ Docs`,
    description: data.description,
  };
}
