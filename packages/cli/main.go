// Command okoro is the operator-grade CLI for the OKORO agent gateway.
//
// OKORO is the neutral identity / policy / audit layer for AI agents.
// This binary mirrors the public API surface 1:1 (OpenAPI-derived) and
// adds operator ergonomics: device-code OAuth, OS-keychain credential
// caching, kubectl-style plugin discovery, and Bloomberg-density terminal
// output.
//
// Architecture invariants honored from the parent repo CLAUDE.md:
//   - Private keys never leave the local machine. The CLI generates
//     keypairs locally and only uploads public material.
//   - One curve, one library: crypto/ed25519 (stdlib) + go-jose for EdDSA
//     JWTs. No third-party Ed25519 implementations.
//   - The verify hot path is portable. The CLI's verify subcommand calls
//     the same algorithm package the API exports, so behavior cannot
//     drift between origin and edge.
//
// See OPERATOR_DECISIONS.md OD-009 (CLI auth model), OD-010 (binary
// distribution), and WORK_BOARD M-040* sub-tickets for scope.
package main

import (
	"fmt"
	"os"

	"github.com/klytics/okoro/packages/cli/cmd"
)

func main() {
	if err := cmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
