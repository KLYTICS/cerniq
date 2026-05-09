package cmd

import (
	"github.com/klytics/aegis/packages/cli/internal/keychain"
	"github.com/klytics/aegis/packages/cli/internal/ui"
	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(logoutCmd)
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Remove the cached AEGIS credential from the OS keychain",
	Long: `Remove the cached AEGIS credential from the OS keychain.

This is idempotent — running it when already logged out is a no-op.
The on-disk config (~/.config/aegis/config.toml) is left intact so a
later 'aegis login' picks up the same base URL and profile.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := keychain.Remove(keychain.KeyAPIKey); err != nil {
			return err
		}
		ui.AutoDisable(cmd.OutOrStdout())
		ui.OK(cmd.OutOrStdout(), "credential removed from OS keychain")
		return nil
	},
}
