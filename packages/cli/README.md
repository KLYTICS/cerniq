# `aegis` — operator CLI for AEGIS

> **Canonical binary post-2026-05-02**: Go single static binary
> (`main.go` + `cmd/` + `internal/`). See `OPERATOR_DECISIONS.md`
> OD-010 for the locked rationale (5 MB vs 50 MB Bun/Node, no runtime
> dep, edge / air-gap viable, honors CLAUDE.md "one curve, one library,
> audited").
>
> The TypeScript scaffold below (`package.json`, `src/**`) was authored
> in parallel before OD-010 landed. It will be converted to an
> `aegis-node` plugin so it surfaces as `aegis node ...` via the
> kubectl-style plugin discovery in `internal/plugin/` — no code is
> deleted, the verb shapes stay live, the binary collision goes away.
> See `MIGRATION_TS_TO_PLUGIN.md` in this directory for the conversion
> plan.

```bash
# install (post-goreleaser drop)
curl -fsSL https://get.aegis.dev/install.sh | sh

# or from source
cd packages/cli && go build -o aegis . && ./aegis --help
```

## Commands

```text
aegis bootstrap                              configure ~/.aegis/credentials.json
aegis whoami                                 show current context
aegis agents create -n <name>                generate keypair locally + register agent
aegis agents list [--limit N] [--json]
aegis agents get <id>
aegis agents revoke <id> [--reason "..."]
aegis policies create -a <agent> -s scopes.json [--ttl 86400]
aegis policies list [-a <agent>] [-s ACTIVE|REVOKED|EXPIRED]
aegis policies revoke <id>
aegis audit search [-a <agent>] [--from ISO] [--to ISO]
aegis audit verify [--from ISO] [--to ISO]   recompute chain locally vs JWKS
aegis kms list [-p AUDIT|JWT|WEBHOOK]
aegis kms rotate <purpose>                   prints the cloud-KMS rotation runbook
aegis mcp install [--host claude-desktop|cursor]
```

## Pipe-friendly output

Status messages go to stderr; data goes to stdout. So this works:

```bash
aegis agents list --json | jq '.agents[] | select(.status == "REVOKED")'
```

## Reference

- ADR-0008: `docs/decisions/0008-mcp-as-control-plane.md` (powers `aegis mcp install`)
- ADR-0011: `docs/decisions/0011-key-rotation-kms.md` (powers `aegis kms rotate`)
- OD-009 (CLI auth model — device-code OAuth primary, `--api-key` for CI)
- OD-010 (binary distribution — Go single static binary)
- OD-011 (first three industry quickstarts — fintech-payments,
  ai-platform-tool-call, saas-seat-provisioning)
- OD-012 (onboarding state — server-persisted)
- WORK_BOARD: M-027 (umbrella) / M-040a..h (sub-tickets)
- `MIGRATION_TS_TO_PLUGIN.md` (TS-scaffold → `aegis-node` plugin path)
- `docs/PLUGIN_AUTHORS.md` (plugin publishing contract — covers both
  the peer-owned `aegis-audit` and the future `aegis-node`)

## Polyglot directory layout

```
packages/cli/
├── main.go              ← canonical CLI binary entry
├── go.mod               ← Go module manifest
├── cmd/                 ← cobra subcommand tree (login, doctor, init, …)
├── internal/            ← Go-side plumbing (config, keychain, plugin, …)
├── README.md            ← you are here
├── package.json         ← @aegis/cli npm package (legacy / TS scaffold)
├── tsconfig.json        ← TS scaffold config
├── tsup.config.ts       ← TS bundler config
├── src/                 ← TS scaffold sources — being relocated to
│                          packages/cli-node/ as the plugin per
│                          MIGRATION_TS_TO_PLUGIN.md
└── MIGRATION_TS_TO_PLUGIN.md
```
