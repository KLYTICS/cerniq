package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/klytics/okoro/packages/cli/internal/client"
	"github.com/klytics/okoro/packages/cli/internal/config"
	"github.com/klytics/okoro/packages/cli/internal/keychain"
	"github.com/klytics/okoro/packages/cli/internal/ui"
	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(whoamiCmd)
}

var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show the principal the CLI is authenticated as",
	Long: `Show the principal the CLI is authenticated as.

Round-trips GET /v1/me on every call so the answer is authoritative,
not cached from the last login. Returns non-zero when no credential is
configured or when the credential is rejected.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load(flagConfig)
		if err != nil {
			return err
		}
		apiKey := resolveAPIKey()
		if apiKey == "" {
			return client.ErrNotAuthenticated
		}
		c, err := client.New(cfg.ResolveBaseURL(flagBaseURL), apiKey)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		me, err := c.Me(ctx)
		if err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && apiErr.IsUnauthorized() {
				return errors.New("credential rejected — run `okoro login` to refresh")
			}
			return err
		}

		out := cmd.OutOrStdout()
		if flagJSON {
			return json.NewEncoder(out).Encode(me)
		}
		ui.AutoDisable(out)
		ui.Heading(out, "Authenticated principal")
		ui.Row(out, "id", me.ID)
		ui.Row(out, "email", me.Email)
		ui.Row(out, "tier", me.Tier)
		ui.Row(out, "base url", cfg.ResolveBaseURL(flagBaseURL))
		fmt.Fprintln(out)
		return nil
	},
}

// resolveAPIKey applies precedence: --api-key flag > OKORO_API_KEY env
// > OS keychain. Centralizes the lookup so every subcommand gets the
// same answer.
func resolveAPIKey() string {
	if flagAPIKey != "" {
		return flagAPIKey
	}
	if env := getEnv("OKORO_API_KEY"); env != "" {
		return env
	}
	v, _ := keychain.Get(keychain.KeyAPIKey)
	return v
}

// getEnv exists as a one-line wrapper purely so tests can swap it.
// Inlined os.Getenv would work today but the indirection costs nothing.
func getEnv(name string) string {
	return envGetter(name)
}

// envGetter is a package-level variable callers may reassign in tests.
var envGetter = func(name string) string {
	return osGetenv(name)
}
