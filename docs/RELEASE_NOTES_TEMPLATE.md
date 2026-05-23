# CERNIQ CLI v{X.Y.Z} — release notes template

> Copy this file to a fresh title (e.g. `docs/releases/v0.1.0.md`) when
> cutting a release. The same prose is used as the goreleaser changelog
> body and the GitHub release description.

## TL;DR

One-paragraph summary of the change. Lead with the user-facing impact
("you can now …"), not the implementation ("we shipped …"). 2 sentences.

## Install / upgrade

```sh
# Homebrew
brew upgrade klytics/cerniq/cerniq

# Scoop
scoop update cerniq

# curl installer
curl -fsSL https://get.cerniq.dev/install.sh | sh

# Verify the release
cosign verify-blob \
  --certificate checksums.txt.pem \
  --signature checksums.txt.sig \
  --certificate-identity-regexp 'https://github.com/klytics/cerniq/.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  checksums.txt
```

## What changed

Pull the relevant section verbatim from `CHANGELOG.md` and trim — the
template here is the merchandiser's view, not the engineer's diff.

### Added

- One-line user benefit. Reference the command (`cerniq foo bar`).

### Changed

- Behaviour change. Highlight any breaking change in **bold** at the top.

### Fixed

- Bug + the real-world symptom that motivated the fix.

## Migration

Empty for non-breaking releases. For a breaking release, give the exact
upgrade command sequence and what fails if skipped.

## Verify the upgrade

```sh
cerniq version            # prints {X.Y.Z}, commit, build date
cerniq doctor             # 10-check battery; expect zero failures
cerniq agents status agt_KNOWN_GOOD   # round-trips a public endpoint
```

## Compatibility

- CERNIQ API: requires v{X.Y} or later (matches /v1 + this release's
  added endpoints, if any).
- Plugin contract: unchanged from v{prior}. Plugins built against the
  prior release continue to work.
- Config file at `$XDG_CONFIG_HOME/cerniq/config.toml`: forward-compatible.
  No migration required.

## Known issues

- (none) | (link to GitHub issue) — drop the section if empty.

## Acknowledgements

Thanks to {peer-session-id} for landing {feature/fix} that this release
depends on.
