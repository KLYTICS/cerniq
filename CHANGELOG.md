# Changelog

All notable changes to the OKORO CLI are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/).

The CLI is shipped as a single static Go binary; this changelog covers
that artifact. The API and SDK changelogs live under their own packages.

## [Unreleased]

### Added

- `okoro agents register` — full wire to `POST /v1/agents/register` with
  optional local `--generate-keypair` (Ed25519, base64url; private key
  printed once and never sent to OKORO, honoring CLAUDE.md invariant 1)
  or `--public-key <path|->` for an existing key.
- `okoro agents show / status / revoke` — wired to the corresponding
  spec endpoints. `status` is the public read (no API key required).
- `okoro policy create / list / revoke / inspect` — full policy surface
  with imperative flags (`--scope`, `--max-per-tx`, `--allowed-domains`,
  `--ttl`) or `--file <json>`. `inspect` decodes a JWT without verifying
  the signature for offline debugging — calls /verify for trust.
- `okoro verify` — POST /v1/verify with `--token`, `--action`, `--amount`,
  `--currency`, `--merchant-id`, `--merchant-domain`, `--context k=v`.
  Renders the canonical 9-reason denial precedence from CLAUDE.md, NOT
  the alphabetical order in the OpenAPI enum (spec drift logged for peer).
  Each denial reason carries a one-line operator-actionable next step.
- `okoro events list / tail / export` — cursor-paginated read view of
  the audit chain. `tail` polls every `--interval` (default 1s) and
  exits cleanly on Ctrl-C. `export` streams NDJSON to `--out` or stdout
  without buffering, suitable for multi-GB tenants.
- `okoro report` — submit a behavioral signal to BATE with `--type`,
  `--severity`, `--evidence k=v` or `--evidence-file <json>`.
- `cliutil` package — shared credential resolution (flag > env >
  keychain), JSON-mode rendering, signal-aware contexts.
- `--verify-key` flag on `okoro verify` plus `KeyVerifyKey` keychain
  entry — relying parties can hold a verify-only credential separately
  from the management API key (least privilege).
- CI workflow at `.github/workflows/cli.yml` — go vet + race tests on
  Linux/macOS/Windows, golangci-lint, goreleaser snapshot with
  cross-compiled artifact upload.

### Changed

- `internal/client` package split from a single file into per-resource
  files (agents, policies, verify, audit, report) with paired tests via
  `httptest.Server`. Hand-rolled rather than oapi-codegen — at 8
  endpoints the install-path simplicity outweighs the codegen value.
  The `//go:generate` recipe is recorded in `types.go` for the moment
  the surface grows past ~20 endpoints.

### Notes

- `okoro login` device-code OAuth flow (OD-009) remains stubbed pending
  the peer's auth0 module exposing `/v1/idp/auth0/device/{authorize,token}`
  endpoints. The `--api-key` fallback is fully wired.
- `okoro listen` (webhook subscription tail) is deferred — the server-side
  webhook subscription endpoint is not in `OKORO_API_SPEC.yaml` today.
- The OpenAPI denial-reason enum at spec line 572-581 lists reasons
  alphabetically; CLAUDE.md invariant 6 mandates the canonical 9-reason
  precedence. The CLI renders against the canonical order; spec fix is
  filed for the spec-owning peer.
