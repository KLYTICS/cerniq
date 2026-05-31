package cmd

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/klytics/cerniq/packages/cli/internal/templates"
	"github.com/klytics/cerniq/packages/cli/internal/ui"
)

func init() {
	initCmd.Flags().StringP("industry", "i", "",
		"vertical template (fintech-payments | ai-platform-tool-call | saas-seat-provisioning)")
	initCmd.Flags().StringP("dir", "d", ".",
		"target directory (created if missing)")
	initCmd.Flags().Bool("force", false,
		"overwrite existing files in the target directory")
	rootCmd.AddCommand(initCmd)
}

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Scaffold a relying-party project from an industry template",
	Long: `Scaffold a relying-party project from an industry template.

Templates are embedded in the binary so 'cerniq init' works offline.
The available industries match OPERATOR_DECISIONS.md OD-011: fintech-
payments, ai-platform-tool-call, and saas-seat-provisioning. Each
template is a runnable, tested integration that demonstrates the
relying-party pattern for that vertical.

Examples:
  cerniq init --industry fintech-payments --dir ./checkout-svc
  cerniq init -i ai-platform-tool-call -d ./agent-runner

Refuses to write into a non-empty directory unless --force is set.`,
	RunE: runInit,
}

func runInit(cmd *cobra.Command, args []string) error {
	industry, _ := cmd.Flags().GetString("industry")
	dir, _ := cmd.Flags().GetString("dir")
	force, _ := cmd.Flags().GetBool("force")

	if industry == "" {
		out := cmd.OutOrStdout()
		ui.AutoDisable(out)
		ui.Heading(out, "Available industry templates")
		for _, name := range templates.List() {
			ui.Row(out, name, templates.Describe(name))
		}
		fmt.Fprintln(out)
		return errors.New("--industry is required (see list above)")
	}

	src, ok := templates.Get(industry)
	if !ok {
		return fmt.Errorf("unknown industry %q — run `cerniq init` with no flags to list available templates", industry)
	}

	abs, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("resolve --dir: %w", err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return fmt.Errorf("create target dir: %w", err)
	}
	if !force {
		entries, err := os.ReadDir(abs)
		if err != nil {
			return err
		}
		if len(entries) > 0 {
			return fmt.Errorf("target dir %s is not empty — pass --force to overwrite", abs)
		}
	}

	out := cmd.OutOrStdout()
	ui.AutoDisable(out)
	ui.Heading(out, "Scaffolding "+industry+" → "+abs)

	count := 0
	err = fs.WalkDir(src, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == "." {
			return nil
		}
		dst := filepath.Join(abs, path)
		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		body, err := fs.ReadFile(src, path)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dst, body, 0o644); err != nil {
			return err
		}
		ui.Row(out, "wrote", path)
		count++
		return nil
	})
	if err != nil {
		return err
	}
	ui.OK(out, fmt.Sprintf("scaffolded %d files", count))
	ui.Row(out, "next", "cd "+dir+" && cat README.md")
	return nil
}
