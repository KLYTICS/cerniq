package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/klytics/aegis/packages/cli/internal/client"
	"github.com/klytics/aegis/packages/cli/internal/cliutil"
	"github.com/klytics/aegis/packages/cli/internal/ui"
	"github.com/spf13/cobra"
)

func init() {
	reportCmd.Flags().String("type", "",
		"event type: fraud_confirmed|anomaly|policy_violation|suspicious_behavior|false_positive (required)")
	reportCmd.Flags().String("severity", "medium", "severity: low|medium|high|critical")
	reportCmd.Flags().String("description", "", "free-text description (≤1000 chars)")
	reportCmd.Flags().String("transaction-id", "",
		"your internal transaction ID for correlation in the audit log")
	reportCmd.Flags().String("evidence-file", "",
		"path to a JSON file of additional signal data (IP, timestamps, amounts)")
	reportCmd.Flags().StringSlice("evidence", nil,
		"key=value evidence pair (repeatable; merged with --evidence-file)")

	rootCmd.AddCommand(reportCmd)
}

var reportCmd = &cobra.Command{
	Use:   "report <agentId>",
	Short: "Report a behavioral signal to BATE (fraud, anomaly, violation)",
	Args:  cobra.ExactArgs(1),
	Long: `Report a behavioral signal about an agent.

Signals feed directly into BATE and affect the agent's trust score.
Verified relying parties are weighted more heavily — see
docs/BATE_ALGORITHM.md § "Signal weights".

Examples:
  aegis report agt_01 --type fraud_confirmed --severity high \
                      --description "chargeback received" \
                      --transaction-id stripe_ch_xyz

  aegis report agt_01 --type anomaly --evidence ip=8.8.8.8 \
                                     --evidence amount_zar=2400`,
	RunE: runReport,
}

func runReport(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	eventType, _ := cmd.Flags().GetString("type")
	if eventType == "" {
		return errors.New("--type is required")
	}
	severity, _ := cmd.Flags().GetString("severity")
	desc, _ := cmd.Flags().GetString("description")
	txID, _ := cmd.Flags().GetString("transaction-id")
	evidenceFile, _ := cmd.Flags().GetString("evidence-file")
	evidencePairs, _ := cmd.Flags().GetStringSlice("evidence")

	evidence := map[string]any{}
	if evidenceFile != "" {
		raw, err := os.ReadFile(evidenceFile)
		if err != nil {
			return fmt.Errorf("read evidence file: %w", err)
		}
		if err := json.Unmarshal(raw, &evidence); err != nil {
			return fmt.Errorf("parse evidence JSON: %w", err)
		}
	}
	for _, p := range evidencePairs {
		k, v, ok := strings.Cut(p, "=")
		if !ok {
			return fmt.Errorf("invalid --evidence pair %q (expected key=value)", p)
		}
		evidence[k] = v
	}

	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	req := &client.ReportRequest{
		EventType:     client.ReportEventType(eventType),
		Severity:      client.ReportSeverity(severity),
		Description:   desc,
		TransactionID: txID,
	}
	if len(evidence) > 0 {
		req.Evidence = evidence
	}
	if err := c.Report(ctx, args[0], req); err != nil {
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), map[string]any{
			"agentId":  args[0],
			"accepted": true,
			"async":    "BATE re-scoring runs asynchronously; check `aegis agents status` for the new trust score",
		})
	}
	ui.OK(cmd.OutOrStdout(), fmt.Sprintf("report accepted (async) — %s on %s", severity, eventType))
	return nil
}
