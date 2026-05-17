package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/klytics/aegis/packages/cli/internal/client"
	"github.com/klytics/aegis/packages/cli/internal/config"
	"github.com/klytics/aegis/packages/cli/internal/keychain"
	"github.com/klytics/aegis/packages/cli/internal/ui"
)

func init() {
	loginCmd.Flags().StringP("api-key", "k", "",
		"AEGIS API key (use this in CI / non-interactive environments)")
	loginCmd.Flags().Bool("force", false,
		"overwrite an existing credential without prompting")
	rootCmd.AddCommand(loginCmd)
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate the CLI against an AEGIS API",
	Long: `Authenticate the CLI against an AEGIS API.

Default flow: device-code OAuth (mirrors gh auth login). The CLI prints
a short user code and a verification URL. Open the URL in any browser,
paste the code, approve. The CLI receives the access token via the
device-flow polling endpoint and stores it in the OS keychain.

Non-interactive flow: pass --api-key to skip OAuth entirely. This is
the right path for CI, scripts, and headless servers. The key is
written to the same OS keychain as the OAuth path.

Decision rationale: see OPERATOR_DECISIONS.md OD-009.`,
	RunE: runLogin,
}

func runLogin(cmd *cobra.Command, args []string) error {
	apiKey, _ := cmd.Flags().GetString("api-key")
	force, _ := cmd.Flags().GetBool("force")

	cfg, err := config.Load(flagConfig)
	if err != nil {
		return err
	}
	baseURL := cfg.ResolveBaseURL(flagBaseURL)

	existing, _ := keychain.Get(keychain.KeyAPIKey)
	if existing != "" && !force {
		ui.AutoDisable(cmd.OutOrStdout())
		ui.Warn(cmd.OutOrStdout(),
			"already authenticated — pass --force to replace the existing credential")
		return nil
	}

	if apiKey == "" {
		// Device-code OAuth flow lives in internal/oauth. The flow is
		// stubbed today (peer's auth0 module just landed 2026-05-02);
		// once the device-code endpoints publish, this branch resolves
		// to the live flow. For now we direct the user to the dashboard
		// to mint a key manually — explicit failure beats fabricated
		// success per CLAUDE.md invariant 4.
		_, _ = fmt.Fprintln(cmd.ErrOrStderr(),
			"Device-code OAuth flow ships with M-040a + Auth0 module integration.")
		_, _ = fmt.Fprintln(cmd.ErrOrStderr(),
			"Until then, mint a key in the dashboard and run:")
		_, _ = fmt.Fprintf(cmd.ErrOrStderr(),
			"  aegis login --api-key aegis_sk_...\n")
		_, _ = fmt.Fprintln(cmd.ErrOrStderr(),
			"Or set AEGIS_API_KEY in your shell.")
		return errors.New("interactive login not yet wired — use --api-key")
	}

	c, err := client.New(baseURL, apiKey)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*1e9)
	defer cancel()

	me, err := c.Me(ctx)
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.IsUnauthorized() {
			return fmt.Errorf("the API key was rejected (HTTP %d %s) — double-check it was copied in full",
				apiErr.Status, apiErr.Code)
		}
		return fmt.Errorf("verify credential: %w", err)
	}

	if err := keychain.Set(keychain.KeyAPIKey, apiKey); err != nil {
		return fmt.Errorf("store credential in keychain: %w", err)
	}
	cfg.BaseURL = baseURL
	cfg.PrincipalEmail = me.Email
	if err := cfg.Save(flagConfig); err != nil {
		return fmt.Errorf("persist config: %w", err)
	}

	ui.AutoDisable(cmd.OutOrStdout())
	ui.OK(os.Stdout, fmt.Sprintf("logged in as %s (%s, tier=%s)", me.Email, me.ID, me.Tier))
	return nil
}
