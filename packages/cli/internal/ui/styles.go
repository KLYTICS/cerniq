// Package ui centralizes Bloomberg-density terminal output styling.
//
// The operator's preference (memory: feedback_less_cards) is dense
// data rows, not card grids. This package supplies the lipgloss styles
// the CLI uses to render those rows: monochrome ASCII tables, single
// accent color for status, dim secondary text. Color auto-disables on
// non-TTY output and can be force-disabled via --no-color.
package ui

import (
	"fmt"
	"io"
	"os"

	"github.com/charmbracelet/lipgloss"
	"golang.org/x/term"
)

// Styles is the palette every rendering helper draws from.
var Styles = struct {
	Heading lipgloss.Style
	Label   lipgloss.Style
	Value   lipgloss.Style
	Dim     lipgloss.Style
	OK      lipgloss.Style
	Warn    lipgloss.Style
	Err     lipgloss.Style
}{
	Heading: lipgloss.NewStyle().Bold(true),
	Label:   lipgloss.NewStyle().Foreground(lipgloss.Color("245")),
	Value:   lipgloss.NewStyle(),
	Dim:     lipgloss.NewStyle().Foreground(lipgloss.Color("240")),
	OK:      lipgloss.NewStyle().Foreground(lipgloss.Color("82")),
	Warn:    lipgloss.NewStyle().Foreground(lipgloss.Color("214")),
	Err:     lipgloss.NewStyle().Foreground(lipgloss.Color("196")),
}

// Disable strips color from every Styles entry. Called when --no-color
// is set or stdout is not a TTY.
func Disable() {
	noop := lipgloss.NewStyle()
	Styles.Heading = noop.Bold(true)
	Styles.Label = noop
	Styles.Value = noop
	Styles.Dim = noop
	Styles.OK = noop
	Styles.Warn = noop
	Styles.Err = noop
}

// AutoDisable disables color when stdout is not a real terminal. Honors
// the NO_COLOR environment convention from no-color.org.
func AutoDisable(w io.Writer) {
	if os.Getenv("NO_COLOR") != "" {
		Disable()
		return
	}
	if f, ok := w.(*os.File); ok {
		if !term.IsTerminal(int(f.Fd())) {
			Disable()
		}
	}
}

// Row writes a single label/value row in Bloomberg-density format:
// "label (right-padded to 18) : value". Used by cerniq whoami, doctor,
// agents show, etc.
func Row(w io.Writer, label, value string) {
	fmt.Fprintf(w, "%s  %s\n",
		Styles.Label.Width(18).Render(label),
		Styles.Value.Render(value),
	)
}

// Heading writes a bold section heading bracketed by box-drawing
// characters — the same shape used by examples/node-quickstart's
// expected-output sample so the operator sees consistent framing.
func Heading(w io.Writer, title string) {
	fmt.Fprintln(w, Styles.Heading.Render("── "+title+" ──"))
}

// OK / Warn / Err render a single-line status indicator. The leading
// glyph is monochrome on no-color terminals so meaning is preserved.
func OK(w io.Writer, msg string) {
	fmt.Fprintf(w, "%s %s\n", Styles.OK.Render("✓"), msg)
}

func Warn(w io.Writer, msg string) {
	fmt.Fprintf(w, "%s %s\n", Styles.Warn.Render("!"), msg)
}

func Err(w io.Writer, msg string) {
	fmt.Fprintf(w, "%s %s\n", Styles.Err.Render("✗"), msg)
}
