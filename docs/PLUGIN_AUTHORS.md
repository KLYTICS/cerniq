---
title: Authoring CERNIQ CLI plugins
audience: developers extending the `cerniq` CLI surface
last-reviewed: 2026-05-02
---

# Authoring CERNIQ CLI plugins

The `cerniq` binary uses kubectl-style plugin discovery: any executable
on `PATH` whose filename begins with `cerniq-` is invoked as a
subcommand of `cerniq`. Run `cerniq foo bar baz` and `cerniq-foo bar baz`
is exec'd with stdin / stdout / stderr inherited.

This is how the peer-owned `cerniq-audit` binary integrates without any
in-source coupling. It's also how the TypeScript scaffold (currently
in `packages/cli/`) will become `cerniq node ...` after the migration
documented in `packages/cli/MIGRATION_TS_TO_PLUGIN.md`.

## The contract

Plugin binaries MUST:

1. **Be a real executable.** The plugin discovery resolver checks the
   executable bit on POSIX; on Windows it relies on PATHEXT.
2. **Be named `cerniq-<name>`.** No hyphens in `<name>` are reserved,
   but multi-word verbs (`cerniq-foo-bar` → `cerniq foo-bar`) work as
   expected.
3. **Forward all remaining arguments.** Everything after `cerniq foo`
   on the command line is passed to the plugin as `argv[1:]`.
4. **Honor exit codes.** 0 = success. Non-zero = failure. The parent
   `cerniq` binary propagates the exit code.
5. **Send status to stderr, data to stdout.** This is what makes
   `cerniq foo --json | jq ...` work even when the plugin is also
   logging human-readable progress.
6. **Honor `--json` if the parent invocation set it.** The parent
   passes `--json` through unchanged; plugins should detect it and
   emit JSON-only output to stdout.
7. **Honor the standard env vars.** The parent exports
   `CERNIQ_API_KEY`, `CERNIQ_BASE_URL`, `CERNIQ_VERBOSE` to the plugin's
   environment. Plugins should not re-prompt; if a credential is
   missing, exit non-zero with a message pointing to `cerniq login`.

Plugin binaries SHOULD:

- Provide `--help` output that matches the cobra style of built-in
  subcommands. Users who run `cerniq foo --help` expect the same shape
  whether `foo` is built-in or a plugin.
- Provide shell completion via `cerniq-foo completion <shell>`. The
  parent doesn't auto-discover plugin completions today, but the
  pattern is in place for when it does.

Plugin binaries MUST NOT:

- Re-implement `cerniq login` or otherwise mutate the parent's
  credentials. Use the inherited `CERNIQ_API_KEY` (or read the keychain
  via the same `99designs/keyring` library the parent uses).
- Change the parent process's environment in a way that survives
  beyond the plugin invocation.
- Emit ANSI color when stdout is not a TTY. Either auto-detect or
  honor `NO_COLOR=1`.

## Distribution

There is no plugin registry. Distribution is whatever your platform
allows:

- **Homebrew tap**: `brew install your-org/tap/cerniq-foo`.
- **Scoop bucket**: `scoop install cerniq-foo`.
- **`go install`**: `go install your.dom/cerniq-foo@latest`.
- **`npm install -g`**: bin field maps to `cerniq-foo`.
- **One-line installer**: same `curl | sh` pattern CERNIQ itself uses.

## Discovery test

Drop your binary on `PATH`, then:

```sh
cerniq doctor   # the "plugins discovered" check enumerates every
               # cerniq-* binary it can see; your plugin should appear.
```

`cerniq doctor` cannot validate that your plugin honors the contract —
that's the plugin author's responsibility. But it confirms PATH-level
visibility, which is the most common cause of "plugin not found".

## Examples in the wild

| Plugin         | Owner                   | Status                                                     |
| -------------- | ----------------------- | ---------------------------------------------------------- |
| `cerniq-audit` | peer `enterprise-plane` | active — claims `audit-CLI` namespace                      |
| `cerniq-node`  | (TBD post-migration)    | proposed — see `packages/cli/MIGRATION_TS_TO_PLUGIN.md`    |
| `cerniq-mcp`   | this repo               | candidate — `cerniq mcp install` for Claude Desktop config |

## Reference

- `packages/cli/internal/plugin/plugin.go` — discovery implementation.
- `packages/cli/internal/plugin/plugin_test.go` — test cases (no-match,
  traversal rejection, PATH walk).
- kubectl plugins (the prior art):
  https://kubernetes.io/docs/tasks/extend-kubectl/kubectl-plugins/
- gh extensions (the alternative shape we did NOT adopt; gh
  extensions add a manifest layer we don't want for v1):
  https://cli.github.com/manual/gh_extension
