package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/klytics/cerniq/packages/cli/internal/version"
)

func init() {
	rootCmd.AddCommand(versionCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version, commit, and build date",
	RunE: func(cmd *cobra.Command, args []string) error {
		if flagJSON {
			return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{
				"version":   version.Version,
				"commit":    version.Commit,
				"buildDate": version.BuildDate,
				"userAgent": version.UserAgent(),
			})
		}
		fmt.Fprintln(cmd.OutOrStdout(), version.String())
		return nil
	},
}
