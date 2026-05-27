// Package cmd hosts the cobra command tree for the cerniq CLI.
//
// The root command:
//  1. Defines global flags (--config, --api-key, --base-url, --json,
//     --no-color, --verbose) which subcommands inherit.
//  2. Registers every built-in subcommand.
//  3. Hooks plugin discovery: when an unknown subcommand is invoked,
//     the resolver looks for `cerniq-<name>` on PATH (kubectl model)
//     and execs it, forwarding arguments and inheriting stdin/stdout.
//     This is what lets the peer-owned `cerniq-audit` binary appear as
//     `cerniq audit ...` without code coupling between the two binaries.
package cmd

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"

	"github.com/klytics/cerniq/packages/cli/internal/plugin"
	"github.com/klytics/cerniq/packages/cli/internal/version"
)

// rootCmd is the top-level cobra command tree.
var rootCmd = &cobra.Command{
	Use:   "cerniq",
	Short: "CERNIQ — neutral identity / policy / audit gateway for AI agents",
	Long: `cerniq is the operator-grade CLI for the CERNIQ agent gateway.

Built for parity with the public API: every verb you see in
docs.cerniq.io exists here, plus terminal-first ergonomics
(login via device-code OAuth, OS-keychain credential caching,
Bloomberg-density status output, kubectl-style plugin discovery).

Get started:
  cerniq login              # one-time auth via device-code OAuth
  cerniq doctor             # check connectivity + onboarding state
  cerniq init --industry fintech-payments  # scaffold a relying-party project
  cerniq agents register    # register your first agent
  cerniq policy create      # mint a scoped policy
  cerniq verify <token>     # run a verification round-trip

Plugins: any binary named 'cerniq-<x>' on PATH is invoked as 'cerniq x'.
The 'audit' subcommand is shipped as a separate plugin binary
(cerniq-audit) and is not part of this binary's source tree.

See ` + "`docs/personas/developer.md`" + ` for the developer-onboarding
path and ` + "`docs/INDUSTRY_QUICKSTARTS.md`" + ` for the per-vertical
golden paths.`,
	Version:       version.String(),
	SilenceUsage:  true,
	SilenceErrors: true,
}

// Global flags. Bound on rootCmd.PersistentFlags() so every subcommand
// can read them without re-declaring.
var (
	flagConfig  string
	flagAPIKey  string
	flagBaseURL string
	flagJSON    bool
	flagNoColor bool
	flagVerbose bool
)

func init() {
	rootCmd.PersistentFlags().StringVar(&flagConfig, "config", "",
		"path to config file (default: $XDG_CONFIG_HOME/cerniq/config.toml)")
	rootCmd.PersistentFlags().StringVar(&flagAPIKey, "api-key", "",
		"CERNIQ API key (overrides keychain + CERNIQ_API_KEY env)")
	rootCmd.PersistentFlags().StringVar(&flagBaseURL, "base-url", "",
		"CERNIQ API base URL (default: from config or https://api.cerniq.io)")
	rootCmd.PersistentFlags().BoolVar(&flagJSON, "json", false,
		"emit machine-readable JSON instead of human-formatted output")
	rootCmd.PersistentFlags().BoolVar(&flagNoColor, "no-color", false,
		"disable ANSI color output (auto-detected on non-TTY)")
	rootCmd.PersistentFlags().BoolVarP(&flagVerbose, "verbose", "v", false,
		"verbose log output (request/response headers, timing)")

	rootCmd.SetVersionTemplate("{{.Version}}\n")
}

// Execute runs the root command. main() calls this and exits non-zero
// on error. Plugin dispatch is hooked here: cobra's normal flow returns
// "unknown command" before plugin discovery runs, so we intercept that
// case in pre-execution.
func Execute() error {
	args := os.Args[1:]
	if len(args) > 0 && !isBuiltinOrFlag(args[0]) {
		// Try plugin dispatch before cobra's "unknown command" path.
		if path, ok := plugin.Find(args[0]); ok {
			return execPlugin(path, args[1:])
		}
	}
	if err := rootCmd.Execute(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			os.Exit(exitErr.ExitCode())
		}
		return fmt.Errorf("cerniq: %w", err)
	}
	return nil
}

// isBuiltinOrFlag returns true if arg is a registered subcommand (so
// cobra should handle it normally) or a flag (so cobra parses globals).
func isBuiltinOrFlag(arg string) bool {
	if strings.HasPrefix(arg, "-") {
		return true
	}
	for _, c := range rootCmd.Commands() {
		if c.Name() == arg {
			return true
		}
		for _, alias := range c.Aliases {
			if alias == arg {
				return true
			}
		}
	}
	return false
}

// execPlugin replaces the current process image with the plugin binary,
// forwarding all remaining arguments. Stdin/stdout/stderr are inherited
// so the plugin sees a real terminal when one is present.
func execPlugin(path string, args []string) error {
	cmd := exec.Command(path, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	return cmd.Run()
}
