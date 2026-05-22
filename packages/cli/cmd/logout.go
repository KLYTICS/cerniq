package cmd

import (
	"github.com/klytics/okoro/packages/cli/internal/keychain"
	"github.com/klytics/okoro/packages/cli/internal/ui"
	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(logoutCmd)
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Remove the cached OKORO credential from the OS keychain",
	Long: `Remove the cached OKORO credential from the OS keychain.

This is idempotent — running it when already logged out is a no-op.
The on-disk config (~/.config/okoro/config.toml) is left intact so a
later 'okoro login' picks up the same base URL and profile.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := keychain.Remove(keychain.KeyAPIKey); err != nil {
			return err
		}
		ui.AutoDisable(cmd.OutOrStdout())
		ui.OK(cmd.OutOrStdout(), "credential removed from OS keychain")
		return nil
	},
}
