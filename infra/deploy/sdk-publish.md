# SDK / CLI / MCP — publish workflow

> **Detail for**: §§7-9 of [LAUNCH.md](../../LAUNCH.md).
> **Constraint**: operator wants to wire secrets before any actual publish runs.
> **Goal**: make every required infrastructure piece sit dry, ready to fire when `NPM_TOKEN` / PyPI trusted publisher / Homebrew tap are configured.

## What ships and where

| Package / artifact | Registry | License | Workspace |
| --- | --- | --- | --- |
| `@cerniq/sdk` | npm public | MIT | `packages/sdk-ts` |
| `@cerniq/types` | npm public | MIT | `packages/types` |
| `@cerniq/verifier-rp` | npm public | MIT | `packages/verifier-rp` |
| `@cerniq/mcp-server` | npm public | MIT | `packages/mcp-server` |
| `@cerniq/mcp-bridge` | npm public | MIT | `packages/mcp-bridge` |
| `cerniq` (Python) | PyPI | MIT | `packages/sdk-py` |
| `cerniq` (CLI binary) | GitHub Releases + Homebrew tap | MIT | `packages/cli` |

Private (never published): `@cerniq/api`, `@cerniq/dashboard`, `@cerniq/cli` (the workspace; the released artifact is the Go binary), `@cerniq/eslint-config`, `@cerniq/tsconfig`, `@cerniq/cf-verify`, `@cerniq/audit-verifier`, `@cerniq/scripts`.

## What's already wired

- `.changeset/config.json` — base config with `@cerniq/sdk` + `@cerniq/types` linked
- `.github/workflows/release.yml` — changesets-driven PR + publish on merge
- `scripts/publish-dry-run.ts` — validates registry readiness without publishing

## Gaps to close before launch

These are the launch-blocking items in the publish path. Listed in order of "do this first." None require editing files outside my isolated worktree, so I'll flag them rather than auto-edit (the OD-024 peer session is still active).

### G.1 — Extend `.changeset/config.json` linked set
Current `linked`: `[["@cerniq/sdk", "@cerniq/types"]]`. Add the other public packages so major-version bumps stay in lockstep per [RELEASE_PROCESS.md §2](../../docs/RELEASE_PROCESS.md):

```json
{
  "linked": [
    ["@cerniq/sdk", "@cerniq/types", "@cerniq/verifier-rp"]
  ],
  "ignore": [
    "@cerniq/api",
    "@cerniq/dashboard",
    "@cerniq/cf-verify",
    "@cerniq/eslint-config",
    "@cerniq/tsconfig",
    "@cerniq/cli",
    "@cerniq/audit-verifier",
    "@cerniq/scripts"
  ]
}
```
(MCP packages stay independently versioned since they have a different consumer surface.)

### G.2 — Extend release.yml build step
Today: `pnpm --filter '@cerniq/types' --filter '@cerniq/sdk' build`. Needs to also build the other public packages so their `dist/` is fresh at publish:

```yaml
- name: Build all publishable packages
  run: pnpm --filter '@cerniq/types' --filter '@cerniq/sdk' --filter '@cerniq/verifier-rp' --filter '@cerniq/mcp-server' --filter '@cerniq/mcp-bridge' build
```

### G.3 — Author `.github/workflows/release-sdk-py.yml`
Triggered on tag `sdk-py-v*`. Uses PyPI OIDC trusted publisher (no API token). Template:

```yaml
name: Release SDK-Py
on:
  push:
    tags: ['sdk-py-v*']
permissions:
  id-token: write
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: pypi
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - working-directory: packages/sdk-py
        run: |
          python -m pip install --upgrade pip build
          python -m build
      - uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: packages/sdk-py/dist
```

PyPI side: create the project at `pypi.org/project/cerniq`, add a Trusted Publisher pointing to `KLYTICS/cerniq` / `release-sdk-py.yml` / env `pypi`.

### G.4 — Author `packages/cli/.goreleaser.yaml` + release workflow
Builds darwin/linux/windows × amd64/arm64. Tag: `cli-v*`. Goreleaser pushes to GitHub Releases and updates `KLYTICS/homebrew-cerniq` tap. Template at end of this doc.

### G.5 — Confirm `github.repository` case-match in release.yml
Line 25 in `release.yml`: `if: github.repository == 'klytics/cerniq'`. GitHub treats repo names case-insensitively, so this matches `KLYTICS/cerniq`. Keep as-is — no fix needed.

---

## Publish playbook (when operator says "go")

### Wave 1 — npm public (sdk + types + verifier-rp + mcp-*)
```sh
# 1. Author changesets (one per surface area being changed)
pnpm changeset

# 2. Open the "Version Packages" PR
git checkout -b release/initial-public
pnpm changeset version
git add -A
git commit -m "release: initial public 0.1.0"
git push origin release/initial-public
gh pr create --title "release: initial public 0.1.0" \
  --body "First public release. Wave 1 of LAUNCH.md §7."

# 3. Merge the PR. release.yml runs on merge:
#    - if there are unreleased changesets, opens a Version PR
#    - if version PR has merged, runs `changeset publish` against NPM_TOKEN

# 4. Verify on npm
npm view @cerniq/sdk version
npm view @cerniq/types version
npm view @cerniq/verifier-rp version

# 5. Smoke
./scripts/launch-smoke.sh sdk-ts
```

### Wave 2 — PyPI
```sh
# 1. Bump version in packages/sdk-py/pyproject.toml
# 2. Commit, push
git tag sdk-py-v0.1.0
git push origin sdk-py-v0.1.0
# 3. release-sdk-py.yml runs, publishes to PyPI
# 4. Smoke
./scripts/launch-smoke.sh sdk-py
```

### Wave 3 — CLI (goreleaser)
```sh
# 1. Tag
git tag cli-v0.1.0
git push origin cli-v0.1.0
# 2. release-cli.yml runs goreleaser
# 3. Verify in GitHub Releases UI; brew tap updated automatically
brew install KLYTICS/cerniq/cerniq
cerniq --version
./scripts/launch-smoke.sh cli
```

---

## Required GitHub Actions secrets

| Secret | Where | Notes |
| --- | --- | --- |
| `NPM_TOKEN` | Repo → Settings → Secrets → Actions | npm automation token, scope `@cerniq` publish |
| `HOMEBREW_TAP_TOKEN` | Repo → Settings → Secrets → Actions | Fine-grained PAT with `contents: write` on `KLYTICS/homebrew-cerniq` |
| (no PyPI token) | — | Trusted publisher uses OIDC |

`NPM_CONFIG_PROVENANCE: true` is already set in release.yml — npm provenance attestations will appear at `npmjs.com/package/@cerniq/sdk` once a published version exists. Good for enterprise consumers verifying supply-chain.

---

## Pre-publish gate

Run before opening any release PR:

```sh
./scripts/launch-preflight.sh
pnpm -r build
pnpm tsx scripts/publish-dry-run.ts
```

Every check must be green. The dry-run validates that each public package's `package.json` has the right `name`, `version`, `main`/`exports`, `files`, `repository`, `license`, and that the workspace `:` placeholder in `dependencies` has been resolved to a real version.

---

## Goreleaser template (for G.4)

`packages/cli/.goreleaser.yaml`:

```yaml
version: 2
project_name: cerniq

before:
  hooks:
    - go mod tidy

builds:
  - id: cerniq
    main: ./cmd/cerniq
    binary: cerniq
    ldflags:
      - -s -w -X main.version={{.Version}} -X main.commit={{.Commit}} -X main.date={{.Date}}
    env:
      - CGO_ENABLED=0
    goos: [darwin, linux, windows]
    goarch: [amd64, arm64]
    ignore:
      - goos: windows
        goarch: arm64

archives:
  - format_overrides:
      - goos: windows
        format: zip
    name_template: "cerniq_{{ .Os }}_{{ .Arch }}_{{ .Version }}"

checksum:
  name_template: "checksums.txt"

snapshot:
  name_template: "{{ incpatch .Version }}-next"

changelog:
  use: github
  sort: asc
  groups:
    - title: Features
      regexp: '^.*?feat(\([[:word:]]+\))??!?:.+$'
    - title: Bug fixes
      regexp: '^.*?fix(\([[:word:]]+\))??!?:.+$'
    - title: Other
      order: 999

brews:
  - name: cerniq
    repository:
      owner: KLYTICS
      name: homebrew-cerniq
      token: "{{ .Env.HOMEBREW_TAP_TOKEN }}"
    homepage: https://cerniq.io
    description: "CERNIQ — Agent identity, policy, and audit CLI."
    license: MIT
    test: |
      system "#{bin}/cerniq", "--version"
```

`.github/workflows/release-cli.yml`:

```yaml
name: Release CLI
on:
  push:
    tags: ['cli-v*']
permissions:
  contents: write
jobs:
  goreleaser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v5
        with: { go-version-file: 'packages/cli/go.mod' }
      - uses: goreleaser/goreleaser-action@v6
        with:
          distribution: goreleaser
          version: '~> v2'
          args: release --clean
          workdir: packages/cli
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
```

Note: `KLYTICS/homebrew-cerniq` must exist as a public repo before the first CLI release. Create it empty; goreleaser populates it.

---

## After publish — smoke

```sh
export CERNIQ_API_BASE=https://api.cerniq.io
./scripts/launch-smoke.sh all
```

Expected: every block green. Investigate any failure before announcing publicly.
