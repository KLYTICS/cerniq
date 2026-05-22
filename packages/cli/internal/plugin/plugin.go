// Package plugin implements kubectl-style plugin discovery.
//
// The contract: any executable on PATH whose name starts with `okoro-`
// becomes an `okoro ...` subcommand. Discovery is purely PATH-based;
// there is no manifest, no registry, no plugin API to maintain. This
// follows the kubectl / git / gh model and is what lets the peer-owned
// `okoro-audit` binary ship in a separate repo and integrate without
// any code dependency.
//
// See docs/PLUGIN_AUTHORS.md for the publishing contract: argv handling,
// exit codes, --json flag forwarding, etiquette around stdout vs stderr.
package plugin

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Prefix is the binary-name prefix that marks a file as an okoro plugin.
// Every plugin binary must start with this prefix; everything else on
// PATH is ignored.
const Prefix = "okoro-"

// Find resolves a plugin name (e.g. "audit") to its absolute path on the
// host PATH. It returns false if no such plugin exists. The first match
// wins, so the same PATH-precedence rules as the shell apply.
func Find(name string) (string, bool) {
	if name == "" || strings.ContainsAny(name, "/\\") {
		return "", false
	}
	bin := Prefix + name
	if path, err := exec.LookPath(bin); err == nil {
		return path, true
	}
	return "", false
}

// List enumerates every okoro-* binary on the current PATH, returning
// (name, fullpath) pairs. Used by the future `okoro plugins list`
// subcommand and by `okoro doctor` to surface installed plugins.
//
// The implementation walks each PATH entry and keeps the first
// occurrence of each plugin name to mirror the shell-resolution order
// the user actually sees.
func List() []Plugin {
	seen := map[string]bool{}
	out := []Plugin{}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if !strings.HasPrefix(name, Prefix) {
				continue
			}
			short := strings.TrimPrefix(name, Prefix)
			if short == "" || seen[short] {
				continue
			}
			full := filepath.Join(dir, name)
			info, err := os.Stat(full)
			if err != nil || info.Mode()&0o111 == 0 {
				continue
			}
			seen[short] = true
			out = append(out, Plugin{Name: short, Path: full})
		}
	}
	return out
}

// Plugin describes one discovered plugin binary.
type Plugin struct {
	Name string
	Path string
}
