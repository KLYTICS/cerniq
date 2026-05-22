---
title: Authoring OKORO CLI plugins
audience: developers extending the `okoro` CLI surface
last-reviewed: 2026-05-02
---

# Authoring OKORO CLI plugins

The `okoro` binary uses kubectl-style plugin discovery: any executable
on `PATH` whose filename begins with `okoro-` is invoked as a
subcommand of `okoro`. Run `okoro foo bar baz` and `okoro-foo bar baz`
is exec'd with stdin / stdout / stderr inherited.

This is how the peer-owned `okoro-audit` binary integrates without any
in-source coupling. It's also how the TypeScript scaffold (currently
in `packages/cli/`) will become `okoro node ...` after the migration
documented in `packages/cli/MIGRATION_TS_TO_PLUGIN.md`.

## The contract

Plugin binaries MUST:

1. **Be a real executable.** The plugin discovery resolver checks the
   executable bit on POSIX; on Windows it relies on PATHEXT.
2. **Be named `okoro-<name>`.** No hyphens in `<name>` are reserved,
   but multi-word verbs (`okoro-foo-bar` → `okoro foo-bar`) work as
   expected.
3. **Forward all remaining arguments.** Everything after `okoro foo`
   on the command line is passed to the plugin as `argv[1:]`.
4. **Honor exit codes.** 0 = success. Non-zero = failure. The parent
   `okoro` binary propagates the exit code.
5. **Send status to stderr, data to stdout.** This is what makes
   `okoro foo --json | jq ...` work even when the plugin is also
   logging human-readable progress.
6. **Honor `--json` if the parent invocation set it.** The parent
   passes `--json` through unchanged; plugins should detect it and
   emit JSON-only output to stdout.
7. **Honor the standard env vars.** The parent exports
   `OKORO_API_KEY`, `OKORO_BASE_URL`, `OKORO_VERBOSE` to the plugin's
   environment. Plugins should not re-prompt; if a credential is
   missing, exit non-zero with a message pointing to `okoro login`.

Plugin binaries SHOULD:

- Provide `--help` output that matches the cobra style of built-in
  subcommands. Users who run `okoro foo --help` expect the same shape
  whether `foo` is built-in or a plugin.
- Provide shell completion via `okoro-foo completion <shell>`. The
  parent doesn't auto-discover plugin completions today, but the
  pattern is in place for when it does.

Plugin binaries MUST NOT:

- Re-implement `okoro login` or otherwise mutate the parent's
  credentials. Use the inherited `OKORO_API_KEY` (or read the keychain
  via the same `99designs/keyring` library the parent uses).
- Change the parent process's environment in a way that survives
  beyond the plugin invocation.
- Emit ANSI color when stdout is not a TTY. Either auto-detect or
  honor `NO_COLOR=1`.

## Distribution

There is no plugin registry. Distribution is whatever your platform
allows:

- **Homebrew tap**: `brew install your-org/tap/okoro-foo`.
- **Scoop bucket**: `scoop install okoro-foo`.
- **`go install`**: `go install your.dom/okoro-foo@latest`.
- **`npm install -g`**: bin field maps to `okoro-foo`.
- **One-line installer**: same `curl | sh` pattern OKORO itself uses.

## Discovery test

Drop your binary on `PATH`, then:

```sh
okoro doctor   # the "plugins discovered" check enumerates every
               # okoro-* binary it can see; your plugin should appear.
```

`okoro doctor` cannot validate that your plugin honors the contract —
that's the plugin author's responsibility. But it confirms PATH-level
visibility, which is the most common cause of "plugin not found".

## Examples in the wild

| Plugin       | Owner                | Status                                                  |
| ------------ | -------------------- | ------------------------------------------------------- |
| `okoro-audit` | peer `enterprise-plane` | active — claims `audit-CLI` namespace                |
| `okoro-node` | (TBD post-migration) | proposed — see `packages/cli/MIGRATION_TS_TO_PLUGIN.md` |
| `okoro-mcp`  | this repo            | candidate — `okoro mcp install` for Claude Desktop config |

## Reference

- `packages/cli/internal/plugin/plugin.go` — discovery implementation.
- `packages/cli/internal/plugin/plugin_test.go` — test cases (no-match,
  traversal rejection, PATH walk).
- kubectl plugins (the prior art):
  https://kubernetes.io/docs/tasks/extend-kubectl/kubectl-plugins/
- gh extensions (the alternative shape we did NOT adopt; gh
  extensions add a manifest layer we don't want for v1):
  https://cli.github.com/manual/gh_extension
