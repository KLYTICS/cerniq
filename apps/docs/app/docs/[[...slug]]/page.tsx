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
  return {
    // page.data.title was typed `any` by older fumadocs versions; explicit
    // String() coercion was added to satisfy restrict-template-expressions.
    // Modern fumadocs (via pretypecheck-generated types) types it as string,
    // so the coercion and `as` assertion are now provably unnecessary and
    // typescript-eslint flags them. If fumadocs ever loosens the type back
    // to `any`, restrict-template-expressions will re-fire here and the
    // coercion can be added back with rationale.
    title: `${page.data.title} · CERNIQ Docs`,
    description: page.data.description,
  };
}
