// Package templates exposes the embedded industry-vertical scaffolds
// that `aegis init --industry <name>` writes onto disk.
//
// Each template is a directory tree under templates/<name>/ at build
// time. The contents are embedded into the binary via go:embed so
// `aegis init` works without network access — important for the
// air-gapped / restricted-egress environments the operator's enterprise
// targets care about.
//
// Adding a new template:
//   1. Drop the tree under packages/cli/internal/templates/<name>/.
//   2. Append the name + one-line description to descriptions below.
//   3. The go:embed directive picks it up automatically.
//
// The description list is the single source of truth surfaced by
// `aegis init` with no --industry flag.
package templates

import (
	"embed"
	"io/fs"
	"sort"
)

//go:embed all:fintech-payments all:ai-platform-tool-call all:saas-seat-provisioning
var trees embed.FS

// descriptions maps template name → one-line description shown in the
// menu. Keep entries one short sentence each — the menu is dense.
var descriptions = map[string]string{
	"fintech-payments":        "Stripe-style checkout server with AEGIS verify gate before authorization",
	"ai-platform-tool-call":   "MCP agent → AEGIS verify → downstream API (pairs with @aegis/mcp-server)",
	"saas-seat-provisioning":  "SCIM-flavored agent provisioning + per-seat policies + audit slice export",
}

// List returns the available template names in stable order.
func List() []string {
	names := make([]string, 0, len(descriptions))
	for name := range descriptions {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Describe returns the human-readable summary for a template name, or
// "(no description)" if the entry is missing — visible to the operator
// as a hint that the descriptions map drifted from the embed roots.
func Describe(name string) string {
	if d, ok := descriptions[name]; ok {
		return d
	}
	return "(no description)"
}

// Get returns an fs.FS rooted at the named template's directory. The
// second return is false when no such template exists. Callers walk
// the FS to copy each file into the target directory.
func Get(name string) (fs.FS, bool) {
	if _, ok := descriptions[name]; !ok {
		return nil, false
	}
	sub, err := fs.Sub(trees, name)
	if err != nil {
		return nil, false
	}
	return sub, true
}
