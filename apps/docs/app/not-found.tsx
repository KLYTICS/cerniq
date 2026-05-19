import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-32 text-center">
      <p className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--aegis-cyan)]">
        404 · Not in the verified index
      </p>
      <h1 className="mb-6 text-4xl font-semibold tracking-tight md:text-5xl">
        This page <span className="aegis-aurora">denied</span> your request
      </h1>
      <p className="mb-10 text-lg leading-relaxed text-[var(--aegis-fog)]">
        The page you requested isn&apos;t in the docs index. Try the
        search bar at the top, or jump to one of these:
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-[var(--aegis-cyan)] px-4 py-2 font-semibold text-[var(--aegis-obsidian)] transition hover:brightness-110"
        >
          Quickstart
        </Link>
        <Link
          href="/docs/concepts/denial-precedence"
          className="rounded-lg border border-[var(--aegis-mist)] px-4 py-2 text-[var(--aegis-halo)] transition hover:border-[var(--aegis-cyan)]"
        >
          Concepts
        </Link>
        <Link
          href="/docs/api/agents"
          className="rounded-lg border border-[var(--aegis-mist)] px-4 py-2 text-[var(--aegis-halo)] transition hover:border-[var(--aegis-cyan)]"
        >
          API reference
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-[var(--aegis-mist)] px-4 py-2 text-[var(--aegis-halo)] transition hover:border-[var(--aegis-cyan)]"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
