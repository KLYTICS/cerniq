# Changesets

We use [changesets](https://github.com/changesets/changesets) to version
public packages (`@aegis/sdk`, `@aegis/types`). Internal apps (api,
dashboard, worker, internal configs) are not versioned here — they deploy
on merge.

## Adding a changeset

```bash
pnpm changeset
```

Pick the package(s) the change affects and the bump type (patch / minor /
major). The CLI writes a Markdown file describing the change; commit it
alongside your PR.

## Releasing

When a release PR is merged to `main`, the CI release workflow runs
`changeset publish` and pushes new versions to npm.

The first GA release will pin both `@aegis/sdk` and `@aegis/types` to
`1.0.0`. Until then we ship `0.x.y` with breaking changes between minor
versions documented in `BREAKING.md` per release.
