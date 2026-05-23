// MDX-friendly wrapper around a CodeSandbox / StackBlitz embed iframe.
// Lazy-loaded; sandboxed; on-brand frame. Use in quickstarts:
//
//   <RunnableExample
//     url="https://stackblitz.com/edit/cerniq-fintech?embed=1&file=src/server.ts"
//     title="Fintech payments quickstart"
//     height={680}
//   />

interface Props {
  url: string;
  title?: string;
  height?: number;
  provider?: 'stackblitz' | 'codesandbox' | 'other';
}

const PROVIDER_LABEL: Record<NonNullable<Props['provider']>, string> = {
  stackblitz: 'StackBlitz',
  codesandbox: 'CodeSandbox',
  other: 'Sandbox',
};

export function RunnableExample({
  url,
  title = 'Runnable example',
  height = 600,
  provider = 'stackblitz',
}: Props) {
  return (
    <figure className="my-6 overflow-hidden rounded-lg border border-[var(--cerniq-mist)] bg-[var(--cerniq-ink)]">
      <iframe
        src={url}
        title={title}
        loading="lazy"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin"
        style={{ width: '100%', height, display: 'block', border: 0 }}
      />
      <figcaption className="flex items-center justify-between border-t border-[var(--cerniq-mist)] bg-[var(--cerniq-graphite)] px-4 py-2 text-xs text-[var(--cerniq-shadow)]">
        <span>{title}</span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[var(--cerniq-cyan)] hover:underline"
        >
          Open in {PROVIDER_LABEL[provider]} ↗
        </a>
      </figcaption>
    </figure>
  );
}
