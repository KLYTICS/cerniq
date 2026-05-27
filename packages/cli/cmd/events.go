package cmd

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/klytics/cerniq/packages/cli/internal/client"
	"github.com/klytics/cerniq/packages/cli/internal/cliutil"
	"github.com/klytics/cerniq/packages/cli/internal/ui"
)

func init() {
	eventsListCmd.Flags().Int("limit", 100, "page size (max 1000 per spec)")
	eventsListCmd.Flags().String("from", "", "RFC3339 lower bound (inclusive)")
	eventsListCmd.Flags().String("to", "", "RFC3339 upper bound (exclusive)")
	eventsListCmd.Flags().String("cursor", "", "resume cursor from a prior --json run")

	eventsTailCmd.Flags().Duration("interval", time.Second,
		"poll interval; the audit chain is monotonic so any value > 250ms is safe")

	eventsExportCmd.Flags().String("out", "-",
		"output file ('-' = stdout); large exports are streamed and never buffered in memory")

	eventsCmd.AddCommand(eventsListCmd, eventsTailCmd, eventsExportCmd)
	rootCmd.AddCommand(eventsCmd)
}

var eventsCmd = &cobra.Command{
	Use:     "events",
	Aliases: []string{"event"},
	Short:   "Audit-event read surface (list, tail, export)",
	Long: `Read audit events for an agent.

The audit chain is append-only and signed (CLAUDE.md invariant 3) so:

  list   — paginated cursor-based read (RFC3339 from/to, limit ≤ 1000)
  tail   — live cursor-poll loop; Bloomberg-density per-event row,
           Ctrl-C exits cleanly
  export — streaming NDJSON dump to stdout or --out <file>

The audit-admin surface (chain integrity check, key rotation) ships
as a separate plugin binary 'cerniq-audit'; this 'events' subcommand is
the per-tenant read view.`,
}

var eventsListCmd = &cobra.Command{
	Use:   "list <agentId>",
	Short: "List audit events with cursor pagination",
	Args:  cobra.ExactArgs(1),
	RunE:  runEventsList,
}

var eventsTailCmd = &cobra.Command{
	Use:   "tail <agentId>",
	Short: "Stream audit events as they arrive (cursor-poll, Ctrl-C exits)",
	Args:  cobra.ExactArgs(1),
	RunE:  runEventsTail,
}

var eventsExportCmd = &cobra.Command{
	Use:   "export <agentId>",
	Short: "Stream the full audit log as NDJSON to stdout or --out file",
	Args:  cobra.ExactArgs(1),
	RunE:  runEventsExport,
}

func runEventsList(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	q := client.AuditQuery{}
	q.Limit, _ = cmd.Flags().GetInt("limit")
	q.Cursor, _ = cmd.Flags().GetString("cursor")
	if from, _ := cmd.Flags().GetString("from"); from != "" {
		t, err := time.Parse(time.RFC3339, from)
		if err != nil {
			return fmt.Errorf("--from: %w", err)
		}
		q.From = &t
	}
	if to, _ := cmd.Flags().GetString("to"); to != "" {
		t, err := time.Parse(time.RFC3339, to)
		if err != nil {
			return fmt.Errorf("--to: %w", err)
		}
		q.To = &t
	}
	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	resp, err := c.EventsList(ctx, args[0], q)
	if err != nil {
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), resp)
	}
	w := cmd.OutOrStdout()
	if len(resp.Events) == 0 {
		ui.Warn(w, "no events in window")
		return nil
	}
	ui.Heading(w, fmt.Sprintf("%d events (total %d)", len(resp.Events), resp.Total))
	for _, e := range resp.Events {
		renderEventRow(w, e)
	}
	if resp.NextCursor != "" {
		ui.Row(w, "next cursor", resp.NextCursor)
	}
	return nil
}

func runEventsTail(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	interval, _ := cmd.Flags().GetDuration("interval")
	if interval < 250*time.Millisecond {
		interval = 250 * time.Millisecond
	}

	ctx, cancel := cliutil.SignalContext(context.Background())
	defer cancel()

	w := cmd.OutOrStdout()
	ui.Heading(w, "tail "+args[0]+" (Ctrl-C to exit)")
	cursor := ""
	for {
		// Per-iteration timeout — independent of the parent SignalContext —
		// so a stalled response can't wedge the loop indefinitely.
		reqCtx, reqCancel := context.WithTimeout(ctx, 30*time.Second)
		resp, err := c.EventsList(reqCtx, args[0], client.AuditQuery{Cursor: cursor, Limit: 200})
		reqCancel()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			ui.Warn(w, fmt.Sprintf("poll: %v (retrying in %s)", err, interval))
		} else {
			for _, e := range resp.Events {
				if flagJSON {
					_ = cliutil.RenderJSON(w, e)
					continue
				}
				renderEventRow(w, e)
			}
			if resp.NextCursor != "" {
				cursor = resp.NextCursor
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(interval):
		}
	}
}

func runEventsExport(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	out, _ := cmd.Flags().GetString("out")
	w := cmd.OutOrStdout()
	if out != "-" {
		f, err := os.OpenFile(out, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return fmt.Errorf("open --out: %w", err)
		}
		defer f.Close()
		w = f
	}
	// Long-running stream — give it 10 minutes; large tenants have multi-GB exports.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := c.EventsExport(ctx, args[0], w); err != nil {
		return err
	}
	if out != "-" && !flagJSON {
		ui.OK(cmd.OutOrStdout(), "export streamed to "+out)
	}
	return nil
}

// renderEventRow writes one Bloomberg-density row per audit event.
// Format: <ts> <decision> <action> agent=<id> trust=<n> [reason=<r>]
func renderEventRow(w interface {
	Write([]byte) (int, error)
}, e client.AuditEvent) {
	decGlyph := "·"
	switch e.Decision {
	case "approved":
		decGlyph = "✓"
	case "denied":
		decGlyph = "✗"
	case "flagged":
		decGlyph = "!"
	}
	line := fmt.Sprintf("%s %s %s  trust=%d  action=%s",
		e.Timestamp.UTC().Format(time.RFC3339), decGlyph, e.Decision, e.TrustScoreAtEvent, e.Action)
	if e.DecisionReason != "" {
		line += "  reason=" + e.DecisionReason
	}
	if e.RelyingParty != "" {
		line += "  rp=" + e.RelyingParty
	}
	fmt.Fprintln(w, line)
}
