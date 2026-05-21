// Lint-staged config — runs on every git commit via .husky/pre-commit's
// `pnpm lint-staged` call. Prior to this file landing, lint-staged was
// declared as a devDep but had no config, so `pnpm lint-staged` errored
// silently and the format step the hook intended to run never executed.
// See PR #40's audit handoff for the gap report (Finding A).
//
// Design choices:
//
//   - Prettier-only, no `eslint --fix`. Prettier is purely cosmetic and
//     deterministic; eslint --fix can have surprising auto-fixes that
//     change semantics (e.g. arrow-body-style, prefer-const on a let
//     that's reassigned by a later commit). CI runs full eslint anyway,
//     so the per-commit gate stays fast and predictable.
//
//   - Extensions mirror the root `package.json` "format" script exactly,
//     plus mjs/cjs for completeness. Anything `pnpm format` would touch,
//     lint-staged also touches on the staged subset.
//
//   - `.prettierignore` at the repo root governs what prettier actually
//     formats — that's where lock files, build outputs, and Prisma
//     migrations are excluded. No need to duplicate those exclusions
//     here; lint-staged hands files to prettier, prettier respects its
//     own ignore file.
//
//   - Returns the command string (not an array) so lint-staged invokes
//     prettier exactly once per pattern with all matching staged files
//     concatenated — much faster than per-file invocation on large diffs.

module.exports = {
  '*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml}': 'prettier --write',
};
