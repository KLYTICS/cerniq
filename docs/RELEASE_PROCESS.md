# CERNIQ — Release Process

> Operator-facing checklist for cutting a release of the public packages.
> Owned by Round 16 / Lane E. Tooling lives in `scripts/`. Update this
> file whenever release semantics change.

This process covers the **publishable** packages:

| Package               | Workspace dir          | Registry | License |
| --------------------- | ---------------------- | -------- | ------- |
| `@cerniq/sdk`         | `packages/sdk-ts`      | npm      | MIT     |
| `@cerniq/types`       | `packages/types`       | npm      | MIT     |
| `@cerniq/verifier-rp` | `packages/verifier-rp` | npm      | MIT     |
| `cerniq` (Python)     | `packages/sdk-py`      | PyPI     | MIT     |

Internal packages (`@cerniq/api`, `@cerniq/dashboard`, `@cerniq/scripts`,
`@cerniq/cli`, `@cerniq/eslint-config`, `@cerniq/tsconfig`,
`@cerniq/audit-verifier`, `@cerniq/mcp-bridge`, `@cerniq/mcp-server`) are
either `private: true` or otherwise not published from this repo.

---

## 0. Pre-flight (no exceptions)

All of these must be true **on the release branch** before you start:

- [ ] `git status` is clean (no untracked, no modified, no staged).
- [ ] `pnpm typecheck` passes across the workspace — 0 errors.
- [ ] `pnpm test` passes across the workspace.
- [ ] `pnpm -r build` has been run; every publishable package has a fresh `dist/`.
- [ ] No peer Claude session holds an active claim on the packages you
      are about to release. Check `~/.claude/peers/bin/claude-peers status`
      for the `cerniq` channel.
- [ ] `docs/SECURITY.md` denial precedence and the API version reflect
      any breaking changes. (Per CLAUDE.md invariant 6, denial precedence
      changes require an API version bump.)
- [ ] You have an `npm` login with publish rights on the `@cerniq` scope
      (`npm whoami` reports the right account, `npm access ls-packages`
      lists `@cerniq/sdk`).

If any item is red, fix it before proceeding. The publish-dry-run will
also catch most of the technical items, but the human items
(peer claims, security doc) are on you.

---

## 1. Generate the changelog

```bash
pnpm --filter @cerniq/scripts run gen:changelog --since <YYYY-MM-DD>
```

Where `<YYYY-MM-DD>` is the date of the previous release tag (or the
last entry in the existing per-package CHANGELOGs).

Behavior:

- Reads `docs/SESSION_HANDOFF.md` and buckets entries by package via
  path-token scan (`packages/sdk-ts/`, `packages/verifier-rp/`, etc.).
- Writes a `CHANGELOG.md` inside each touched package using
  Keep-A-Changelog format with `## [unreleased]` on top, then dated
  sections in date-desc order.
- Falls back to `git log --since=<date> --name-only` if the handoff log
  has no matching entries.

Always preview first:

```bash
pnpm --filter @cerniq/scripts run gen:changelog --since <date> --dry-run
```

Then commit:

```bash
git add packages/*/CHANGELOG.md
git commit -m "chore(release): regenerate changelogs since <date>"
```

If a single package needs a manual touch-up:

```bash
pnpm --filter @cerniq/scripts run gen:changelog --package sdk-ts --since <date>
# edit packages/sdk-ts/CHANGELOG.md by hand, then commit
```

---

## 2. Bump versions (semver per package)

Versioning rules:

- **Patch** — bug fixes, doc changes, dependency bumps that don't change
  the public surface.
- **Minor** — additive changes to the public API (new exports, new
  optional fields). Backward-compatible.
- **Major** — breaking changes. **Lockstep across the SDK packages**:
  if `@cerniq/sdk` breaks, `@cerniq/verifier-rp` and the Python SDK
  bump majors at the same time so cross-version compatibility doesn't
  drift. `@cerniq/types` may bump independently when only schema field
  names change, but a breaking `@cerniq/types` bump always implies a
  major bump for both SDKs.

Bump in place by editing each package's `package.json` and `CHANGELOG.md`
(replace `## [unreleased]` with `## [x.y.z] — YYYY-MM-DD`, then add a
fresh `## [unreleased]` placeholder above it).

For the Python SDK, also bump `version` in `packages/sdk-py/pyproject.toml`.

Commit:

```bash
git add packages/*/package.json packages/*/CHANGELOG.md packages/sdk-py/pyproject.toml
git commit -m "chore(release): @cerniq/sdk@x.y.z, @cerniq/verifier-rp@x.y.z, ..."
```

---

## 3. Publish dry-run

```bash
pnpm --filter @cerniq/scripts run publish:dry-run:all
```

This iterates every public `@cerniq/*` package and asserts:

| Class                    | Check                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tarball must NOT contain | `node_modules/`, `.env*`, `*.spec.ts`, `*.test.ts`, `coverage/`, `*.tsbuildinfo`                                                          |
| Tarball must NOT contain | source maps that leak absolute filesystem paths                                                                                           |
| Tarball MUST contain     | `README.md`, `LICENSE` (warn if absent), `package.json`, every entrypoint declared in `main`/`module`/`types`/`bin`/`exports`             |
| `package.json` requires  | `name`, `version` (valid semver), `description`, `license`, `repository.url` referencing the cerniq repo, `engines.node`, `keywords` (≥3) |
| Dependencies must NOT be | `link:*` or `file:*` (they don't survive publish)                                                                                         |
| Dependencies WARN if     | `workspace:*` (pnpm rewrites these on publish; the warning reminds you to confirm)                                                        |

Exit codes:

- `0` — all checks pass.
- `1` — at least one failure (or any warning under `--strict`).
- `2` — setup error (couldn't find repo root, `--package` matched
  nothing, etc.).

To machine-consume the report (e.g. for CI):

```bash
pnpm --filter @cerniq/scripts run publish:dry-run -- --all --json > pre-publish.json
```

Strict mode for "everything must be perfect" releases:

```bash
pnpm --filter @cerniq/scripts run publish:dry-run -- --all --strict
```

**Do not proceed if exit code is non-zero.** Fix the offending package
(rebuild, add missing field, etc.), re-run, and only continue when the
gate is green.

---

## 4. Tag and publish

Once the dry-run is green:

```bash
# Tag the release.
git tag -a v$(node -p "require('./packages/sdk-ts/package.json').version") -m "CERNIQ SDK release"

# Publish each public package. pnpm rewrites workspace:* automatically.
pnpm --filter @cerniq/sdk publish --access public
pnpm --filter @cerniq/types publish --access public
pnpm --filter @cerniq/verifier-rp publish --access public

# Python SDK.
cd packages/sdk-py
python -m build
python -m twine upload dist/*
cd -

# Push the tag.
git push origin --tags
```

Verify:

```bash
npm view @cerniq/sdk version       # should match
npm view @cerniq/verifier-rp version
pip index versions cerniq
```

---

## 5. Post-release

- [ ] Append an entry to `docs/SESSION_HANDOFF.md` summarizing what was
      released, with the version of each package.
- [ ] If the release closed any items in `WORK_BOARD.md`, flip them to
      `STATUS: shipped`.
- [ ] Announce in the appropriate channel (operator's call).

---

## Rollback

If a published version is broken and a fix isn't ready:

```bash
# Mark the bad version as deprecated. Customers see this on `npm install`.
npm deprecate @cerniq/sdk@<bad-version> "Broken — use @cerniq/sdk@<good-version> or later."

# For a range:
npm deprecate "@cerniq/sdk@>=1.2.0 <1.2.4" "Broken — see GH issue #N. Upgrade to 1.2.4."
```

`npm unpublish` is **not** an option for releases older than 72 hours
(npm policy) and is generally a worse experience than `deprecate`. Always
prefer `deprecate` + a fixed follow-up release.

For Python:

```bash
# PyPI does not support unpublish. The workflow is "yank":
python -m twine yank cerniq==<bad-version> --reason "Broken — use <good-version>."
```

---

## Coordination with peer sessions

Per CLAUDE.md, parallel Claude sessions claim work via
`~/.claude/peers/bin/claude-peers`. Before a release, claim
`cerniq:release-<date>` so other sessions don't tag/publish in parallel:

```bash
~/.claude/peers/bin/claude-peers claim cerniq release-2026-05 --note "publishing v0.2.0 across SDKs" --ttl 7200
# ... do the release ...
~/.claude/peers/bin/claude-peers release cerniq:release-2026-05
```

---

## Tooling contract

All three release tools live under `scripts/` and have these guarantees:

- **Deterministic** — same input ⇒ same output. The changelog generator
  sorts dates desc and headings asc within a date.
- **Hermetic** — no network calls, no real publishes during dry-run.
  `npm pack --dry-run` never uploads. Tests stub the executor entirely.
- **No new dependencies** — `child_process.execFile` only. We're not
  pulling in `semver`, `conventional-changelog`, etc. for this scope.
- **Per CLAUDE.md** — no `any` without `// type-rationale:`, every
  branching function has a spec, no `Math.random` in hot paths.

Source files:

- `scripts/generate-changelog.ts` + `.spec.ts`
- `scripts/publish-dry-run.ts` + `.spec.ts`
- `scripts/lib/package-introspect.ts` (shared helpers)
