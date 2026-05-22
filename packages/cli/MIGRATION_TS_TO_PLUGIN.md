# TS-scaffold → `okoro-node` plugin migration

**Status**: proposed (operator decision needed) · 2026-05-02 · sid=adoption-frictionless-cli

## What happened

Two parallel sessions built `packages/cli/` simultaneously on
2026-05-02:

- **Earlier**: a TypeScript scaffold using `commander` + `@noble/ed25519`
  (files: `package.json`, `tsconfig.json`, `tsup.config.ts`, `src/bin.ts`,
  `src/{client,credentials,output,index}.ts`, `src/commands/{agents,
  audit,bootstrap,kms,mcp,policies,whoami}.ts`).
- **Later**: a Go scaffold using `cobra` + `99designs/keyring` (files:
  `main.go`, `go.mod`, `cmd/{root,login,logout,whoami,doctor,init,
  agents,policy,verify,version,completion,env}.go`, `internal/{client,
  config,keychain,plugin,templates,ui,version}/**`).

`OPERATOR_DECISIONS.md` OD-010 (locked 2026-05-02) selects the Go
binary as the canonical `okoro` distribution. The TS scaffold is real
work — it implements the same verb shapes as the Go binary minus
plugin discovery — and should not be deleted. Both binaries cannot
ship under the same name (`npm install -g @okoro/cli` collides with
`brew install okoro`).

## Proposed resolution

Convert the TS scaffold into an `okoro-node` plugin. The kubectl-style
plugin discovery in `internal/plugin/plugin.go` resolves `okoro foo` to
`okoro-foo` on `PATH`, so a TS binary published as `okoro-node`
appears as `okoro node ...` automatically. No verb shapes change. No
code is deleted. The Go binary owns the `okoro` name; the TS binary
becomes a recognized plugin.

### Concrete steps

1. **Move files**: `packages/cli/{package.json,tsconfig.json,tsup.config.ts,src/}`
   → `packages/cli-node/`. Keep the TS file contents as-is for the
   first pass — only the path and the bin name change.
2. **Rename binary**: in `packages/cli-node/package.json`, change
   `"bin": { "okoro": "./dist/bin.js" }` to `"bin": { "okoro-node":
   "./dist/bin.js" }`. Rename `src/bin.ts` to `src/okoro-node.ts` for
   consistency.
3. **Rename package**: change `"name": "@okoro/cli"` to
   `"name": "@okoro/cli-node"`. Bump to `0.1.0` of the new package.
4. **Adopt plugin contract**: read `docs/PLUGIN_AUTHORS.md`. Concretely:
   - Status messages go to stderr; data goes to stdout (already done in
     the TS scaffold's `output.ts`).
   - Honor `--json` from the parent `okoro` invocation (already done).
   - Exit codes: 0 success, non-zero on any failure.
   - Forward the `OKORO_API_KEY` and `OKORO_BASE_URL` env vars without
     re-prompting (parent `okoro` exports them on plugin invocation).
5. **Document**: add `okoro-node` to the `Available plugins` list in
   `docs/PLUGIN_AUTHORS.md`, and append to the `okoro doctor`
   plugin-discovery output (no code change needed — `internal/plugin/
   plugin.go` already enumerates by PATH prefix).
6. **Decommission `@okoro/cli`**: keep the npm name reserved — publish
   one final `0.0.99-deprecated` version that prints "this package was
   renamed to @okoro/cli-node; the canonical CLI is the Go binary at
   https://get.okoro.dev/install.sh".

### Why this works

- Zero TS-to-Go rewrite. The TS implementation keeps shipping value,
  just under a different name.
- The plugin discovery contract is what `okoro-audit` (peer-owned) is
  already going to use, so we exercise the same machinery twice — good
  proof that the plugin system is real, not theoretical.
- The operator can pick later whether the Node-side commands eventually
  port to Go (consolidation) or stay as plugins (keeps the Node
  ecosystem reachable for users who already have it).

## Operator decision needed

This migration is non-destructive but it does shuffle file paths. The
operator should pick one of:

1. **Approve the migration as proposed.** I will execute steps 1–6 in
   a follow-on commit, on a fresh peer-claim
   (`okoro:cli-node-plugin-rename`).
2. **Keep the TS scaffold inside `packages/cli/` indefinitely.** No
   move. The two binaries coexist in the same dir. Risk: confusion
   when contributors `cd packages/cli && go build` and get a different
   binary than `cd packages/cli && pnpm build`.
3. **Decommission the TS scaffold entirely.** Delete `package.json`,
   `tsconfig.json`, `tsup.config.ts`, `src/`. The Go binary is
   sufficient. Risk: throws away the work and the Node-ecosystem
   reachability.

The default (silence past 7 days = consent) is **#1 — execute the
migration**. Captured as a follow-on operator decision; will file as
OD-013 if the operator does not respond inline.

## Until then

- The Go binary builds and runs (`cd packages/cli && go build -o okoro .`).
- The TS scaffold builds and runs (`cd packages/cli && pnpm build`).
- They emit binaries with the same name (`okoro`). Only the last one
  installed wins on a developer machine. Be aware until the migration
  lands.
