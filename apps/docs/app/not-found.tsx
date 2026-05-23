import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-32 text-center">
      <p className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cerniq-cyan)]">
        404 · Not in the verified index
      </p>
      <h1 className="mb-6 text-4xl font-semibold tracking-tight md:text-5xl">
        This page <span className="cerniq-aurora">denied</span> your request
      </h1>
      <p className="mb-10 text-lg leading-relaxed text-[var(--cerniq-fog)]">
        The page you requested isn&apos;t in the docs index. Try the search bar at the top, or jump
        to one of these:
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-[var(--cerniq-cyan)] px-4 py-2 font-semibold text-[var(--cerniq-obsidian)] transition hover:brightness-110"
        >
          Quickstart
        </Link>
        <Link
          href="/docs/concepts/denial-precedence"
          className="rounded-lg border border-[var(--cerniq-mist)] px-4 py-2 text-[var(--cerniq-halo)] transition hover:border-[var(--cerniq-cyan)]"
        >
          Concepts
        </Link>
        <Link
          href="/docs/api/agents"
          className="rounded-lg border border-[var(--cerniq-mist)] px-4 py-2 text-[var(--cerniq-halo)] transition hover:border-[var(--cerniq-cyan)]"
        >
          API reference
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-[var(--cerniq-mist)] px-4 py-2 text-[var(--cerniq-halo)] transition hover:border-[var(--cerniq-cyan)]"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
