# `okoro` — operator CLI for OKORO

> **Canonical binary post-2026-05-02**: Go single static binary
> (`main.go` + `cmd/` + `internal/`). See `OPERATOR_DECISIONS.md`
> OD-010 for the locked rationale (5 MB vs 50 MB Bun/Node, no runtime
> dep, edge / air-gap viable, honors CLAUDE.md "one curve, one library,
> audited").
>
> The TypeScript scaffold below (`package.json`, `src/**`) was authored
> in parallel before OD-010 landed. It will be converted to an
> `okoro-node` plugin so it surfaces as `okoro node ...` via the
> kubectl-style plugin discovery in `internal/plugin/` — no code is
> deleted, the verb shapes stay live, the binary collision goes away.
> See `MIGRATION_TS_TO_PLUGIN.md` in this directory for the conversion
> plan.

```bash
# install (post-goreleaser drop)
curl -fsSL https://get.okoro.dev/install.sh | sh

# or from source
cd packages/cli && go build -o okoro . && ./okoro --help
```

## Commands

```text
okoro bootstrap                              configure ~/.okoro/credentials.json
okoro whoami                                 show current context
okoro agents create -n <name>                generate keypair locally + register agent
okoro agents list [--limit N] [--json]
okoro agents get <id>
okoro agents revoke <id> [--reason "..."]
okoro policies create -a <agent> -s scopes.json [--ttl 86400]
okoro policies list [-a <agent>] [-s ACTIVE|REVOKED|EXPIRED]
okoro policies revoke <id>
okoro audit search [-a <agent>] [--from ISO] [--to ISO]
okoro audit verify [--from ISO] [--to ISO]   recompute chain locally vs JWKS
okoro kms list [-p AUDIT|JWT|WEBHOOK]
okoro kms rotate <purpose>                   prints the cloud-KMS rotation runbook
okoro mcp install [--host claude-desktop|cursor]
```

## Pipe-friendly output

Status messages go to stderr; data goes to stdout. So this works:

```bash
okoro agents list --json | jq '.agents[] | select(.status == "REVOKED")'
```

## Reference

- ADR-0008: `docs/decisions/0008-mcp-as-control-plane.md` (powers `okoro mcp install`)
- ADR-0011: `docs/decisions/0011-key-rotation-kms.md` (powers `okoro kms rotate`)
- OD-009 (CLI auth model — device-code OAuth primary, `--api-key` for CI)
- OD-010 (binary distribution — Go single static binary)
- OD-011 (first three industry quickstarts — fintech-payments,
  ai-platform-tool-call, saas-seat-provisioning)
- OD-012 (onboarding state — server-persisted)
- WORK_BOARD: M-027 (umbrella) / M-040a..h (sub-tickets)
- `MIGRATION_TS_TO_PLUGIN.md` (TS-scaffold → `okoro-node` plugin path)
- `docs/PLUGIN_AUTHORS.md` (plugin publishing contract — covers both
  the peer-owned `okoro-audit` and the future `okoro-node`)

## Polyglot directory layout

```
packages/cli/
├── main.go              ← canonical CLI binary entry
├── go.mod               ← Go module manifest
├── cmd/                 ← cobra subcommand tree (login, doctor, init, …)
├── internal/            ← Go-side plumbing (config, keychain, plugin, …)
├── README.md            ← you are here
├── package.json         ← @okoro/cli npm package (legacy / TS scaffold)
├── tsconfig.json        ← TS scaffold config
├── tsup.config.ts       ← TS bundler config
├── src/                 ← TS scaffold sources — being relocated to
│                          packages/cli-node/ as the plugin per
│                          MIGRATION_TS_TO_PLUGIN.md
└── MIGRATION_TS_TO_PLUGIN.md
```
