#!/usr/bin/env tsx
// check-migration-immutability.ts
//
// Enforces a hard rule: once a Prisma migration is committed to git, its
// `migration.sql` file is byte-immutable. Forward-only — corrections go
// in a NEW migration that adds the fix, never by editing the old one.
//
// Why this matters:
//   • Prisma replays migrations by content hash. Mutating an applied
//     migration silently breaks `prisma migrate deploy` on every deploy
//     target that has already run the old version.
//   • Backups + audit chains also assume migrations are content-stable;
//     a mutation creates an unrecoverable schema drift between the
//     production DB and the schema.prisma at HEAD.
//
// What this script does:
//   For each `apps/api/prisma/migrations/*/migration.sql` whose path is
//   tracked in git, compare working-tree content against the committed
//   blob. Any mismatch → fail loud with the diff path and a remediation
//   recipe.
//
//   New migrations (path not yet in git) are allowed.
//   Deleted migrations (in git, missing on disk) are flagged — they almost
//   always indicate someone moved/renamed instead of adding a new one.
//
// Exit codes:
//   0  — clean (or no committed migrations yet)
//   1  — at least one violation
//   2  — environment problem (not a git repo / git not on PATH)

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ES-module-safe __dirname. The scripts/ workspace is `type: module`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR_GLOB = 'apps/api/prisma/migrations/';

interface Violation {
  kind: 'modified' | 'deleted';
  path: string;
  hint: string;
}

function gitOrFail(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    process.stderr.write(`migration-immutability: git command failed: ${cmd}\n`);
    process.stderr.write(String((err as Error).message));
    process.exit(2);
  }
}

function listCommittedMigrationSqls(): string[] {
  // ls-tree on HEAD; if no HEAD yet (fresh repo), nothing is committed.
  let out: string;
  try {
    out = gitOrFail('git ls-tree -r --name-only HEAD');
  } catch {
    return [];
  }
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p.startsWith(MIGRATIONS_DIR_GLOB) && p.endsWith('/migration.sql'));
}

function committedBlob(path: string): string {
  return gitOrFail(`git show HEAD:${path}`);
}

function main(): void {
  const committed = listCommittedMigrationSqls();
  if (committed.length === 0) {
    process.stdout.write('migration-immutability: no committed migrations yet — skipping.\n');
    process.exit(0);
  }

  const violations: Violation[] = [];

  for (const path of committed) {
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) {
      violations.push({
        kind: 'deleted',
        path,
        hint:
          `Restore the file from HEAD (\`git checkout HEAD -- ${path}\`) and add a NEW migration ` +
          `for any schema correction. Migrations are forward-only.`,
      });
      continue;
    }
    const onDisk = readFileSync(abs, 'utf8');
    const inGit = committedBlob(path);
    if (onDisk !== inGit) {
      violations.push({
        kind: 'modified',
        path,
        hint:
          `Revert the file to its committed state (\`git checkout HEAD -- ${path}\`) and add a NEW migration ` +
          `containing only the delta. Mutating a committed migration breaks \`prisma migrate deploy\` on every ` +
          `target that already ran the previous version.`,
      });
    }
  }

  if (violations.length === 0) {
    process.stdout.write(
      `migration-immutability: ${committed.length} committed migration(s) all immutable.\n`,
    );
    process.exit(0);
  }

  process.stderr.write(`migration-immutability: ${violations.length} VIOLATION(S)\n\n`);
  for (const v of violations) {
    process.stderr.write(`  [${v.kind.toUpperCase()}] ${v.path}\n`);
    process.stderr.write(`    → ${v.hint}\n\n`);
  }
  process.stderr.write(
    `Why this matters: see docs/IMMUTABILITY.md § "Migrations". Bypassing this check ` +
      `requires both an ADR and operator sign-off.\n`,
  );
  process.exit(1);
}

main();
