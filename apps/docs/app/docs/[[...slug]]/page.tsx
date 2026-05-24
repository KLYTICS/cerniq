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
    // page.data is typed `any` by fumadocs source; coerce explicitly to
    // satisfy @typescript-eslint/restrict-template-expressions. A non-
    // string title renders visibly (e.g. "[object Object] · CERNIQ Docs"),
    // so misformatted frontmatter fails loud rather than silent.
    //
    // typescript-eslint may upgrade the inferred type to `string` once
    // fumadocs' generated types tighten — at which point the rules below
    // would flag these as unnecessary. The runtime defense is intentional
    // (fumadocs source is `any` at the value level even when typed string),
    // so we keep the conversions and silence the static-only rules here.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
    title: `${String(page.data.title)} · CERNIQ Docs`,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    description: page.data.description as string | undefined,
  };
}
