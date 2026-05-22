import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readJsonVersion(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
    return parsed.version;
  } catch {
    return undefined;
  }
}

function readPyVersion(path: string): string | undefined {
  try {
    const text = readFileSync(path, 'utf8');
    const match = /^version\s*=\s*"([^"]+)"/m.exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

interface Badge { name: string; version: string | undefined; install: string }

function loadBadges(): Badge[] {
  // Resolve from apps/docs/ up to the monorepo root.
  const repoRoot = join(process.cwd(), '..', '..');
  return [
    {
      name: '@okoro/sdk',
      version: readJsonVersion(join(repoRoot, 'packages', 'sdk-ts', 'package.json')),
      install: 'npm install @okoro/sdk',
    },
    {
      name: 'okoro (python)',
      version: readPyVersion(join(repoRoot, 'packages', 'sdk-py', 'pyproject.toml')),
      install: 'pip install okoro',
    },
    {
      name: 'okoro (cli)',
      version: readJsonVersion(join(repoRoot, 'packages', 'cli', 'package.json')),
      install: 'brew install klytics/okoro/okoro',
    },
  ];
}

export function SdkVersionBadges() {
  const badges = loadBadges();
  return (
    <div className="flex flex-wrap gap-3">
      {badges.map((b) => (
        <div
          key={b.name}
          className="inline-flex items-center gap-3 rounded-lg border border-[var(--okoro-mist)] bg-[var(--okoro-ink)] px-4 py-2"
        >
          <span className="font-mono text-xs text-[var(--okoro-fog)]">{b.name}</span>
          <span className="rounded bg-[var(--okoro-graphite)] px-2 py-0.5 font-mono text-xs text-[var(--okoro-cyan)]">
            {b.version ? `v${b.version}` : 'unreleased'}
          </span>
          <code className="font-mono text-xs text-[var(--okoro-shadow)]">{b.install}</code>
        </div>
      ))}
    </div>
  );
}
