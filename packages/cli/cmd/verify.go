package cmd

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/klytics/cerniq/packages/cli/internal/client"
	"github.com/klytics/cerniq/packages/cli/internal/cliutil"
	"github.com/klytics/cerniq/packages/cli/internal/ui"
	"github.com/spf13/cobra"
)

func init() {
	verifyCmd.Flags().String("token", "",
		"CERNIQ-issued JWT to verify (required if not passed positionally)")
	verifyCmd.Flags().String("action", "", "action being attempted (e.g. commerce.purchase)")
	verifyCmd.Flags().Float64("amount", 0, "amount being authorized")
	verifyCmd.Flags().String("currency", "", "currency code (USD|EUR|GBP)")
	verifyCmd.Flags().String("merchant-id", "", "merchant identifier")
	verifyCmd.Flags().String("merchant-domain", "", "merchant FQDN (e.g. delta.com)")
	verifyCmd.Flags().StringSlice("context", nil,
		"key=value pairs of additional verification context (repeatable)")
	verifyCmd.Flags().String("verify-key", "",
		"verify-only key (X-CERNIQ-Verify-Key); falls back to env CERNIQ_VERIFY_KEY then keychain")
	rootCmd.AddCommand(verifyCmd)
}

var verifyCmd = &cobra.Command{
	Use:   "verify [token]",
	Short: "POST /v1/verify and render the result with denial precedence",
	Args:  cobra.MaximumNArgs(1),
	Long: `Verify an CERNIQ-issued token by round-tripping POST /v1/verify.

The CLI uses your verify-only key when one is configured (preferred for
relying parties — least privilege), falling back to the management API
key. The output renders the canonical 9-reason denial precedence from
CLAUDE.md invariant 6, NOT the alphabetical order in the OpenAPI enum.

Examples:
  cerniq verify eyJhbGciOi...                              # smoke check
  cerniq verify --token "$T" --action commerce.purchase \
               --amount 450 --currency USD --merchant-domain delta.com
  cerniq verify "$T" --json | jq '.denialReason'`,
	RunE: runVerify,
}

func runVerify(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())

	token, _ := cmd.Flags().GetString("token")
	if token == "" && len(args) == 1 {
		token = args[0]
	}
	if token == "" {
		return errors.New("token required (positional arg or --token)")
	}

	verifyFlag, _ := cmd.Flags().GetString("verify-key")
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath:  flagConfig,
		BaseURLFlag: flagBaseURL,
		APIKeyFlag:  flagAPIKey,
		VerifyFlag:  verifyFlag,
		RequireAuth: true,
	})
	if err != nil {
		return err
	}

	action, _ := cmd.Flags().GetString("action")
	amount, _ := cmd.Flags().GetFloat64("amount")
	currency, _ := cmd.Flags().GetString("currency")
	merchantID, _ := cmd.Flags().GetString("merchant-id")
	merchantDomain, _ := cmd.Flags().GetString("merchant-domain")
	contextPairs, _ := cmd.Flags().GetStringSlice("context")

	contextMap := map[string]any{}
	for _, p := range contextPairs {
		k, v, ok := strings.Cut(p, "=")
		if !ok {
			return fmt.Errorf("invalid --context pair %q (expected key=value)", p)
		}
		contextMap[k] = v
	}

	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	resp, err := c.Verify(ctx, &client.VerifyRequest{
		Token:          token,
		Action:         action,
		Amount:         amount,
		Currency:       currency,
		MerchantID:     merchantID,
		MerchantDomain: merchantDomain,
		Context:        contextMap,
	})
	if err != nil {
		return err
	}

	if flagJSON {
		if err := cliutil.RenderJSON(cmd.OutOrStdout(), resp); err != nil {
			return err
		}
		// Mirror gh-cli: --json never sets a nonzero exit code on its own.
		// Relying parties read .valid from the JSON to drive their flow.
		return nil
	}

	w := cmd.OutOrStdout()
	if resp.Valid {
		ui.OK(w, fmt.Sprintf("verified — agent %s, trust %d (%s), TTL %ds",
			resp.AgentID, resp.TrustScore, resp.TrustBand, resp.TTL))
		if len(resp.ScopesGranted) > 0 {
			ui.Row(w, "scopes granted", strings.Join(resp.ScopesGranted, ", "))
		}
		if resp.SpendRemaining != nil {
			ui.Row(w, "spend today", fmt.Sprintf("%.2f", resp.SpendRemaining.Today))
			ui.Row(w, "spend this month", fmt.Sprintf("%.2f", resp.SpendRemaining.ThisMonth))
		}
		ui.Row(w, "verified at", resp.VerifiedAt.Format(time.RFC3339))
		return nil
	}

	// valid=false path. Surface the denial reason in the canonical
	// precedence order so the user knows which check fired first.
	reason := "(none specified)"
	if resp.DenialReason != nil {
		reason = string(*resp.DenialReason)
	}
	ui.Err(w, fmt.Sprintf("denied — %s", reason))
	ui.Row(w, "agent", resp.AgentID)
	ui.Row(w, "trust score", fmt.Sprintf("%d (%s)", resp.TrustScore, resp.TrustBand))
	if hint := denialHint(resp.DenialReason); hint != "" {
		ui.Row(w, "next step", hint)
	}
	// Non-zero exit so shell pipelines can branch on `cerniq verify ...`.
	return errors.New("verify denied")
}

// denialHint maps a denial reason to a one-line operator-actionable
// next step. Mirrors the audit drawer in the dashboard so the operator
// gets the same guidance whether they're in terminal or browser.
func denialHint(reason *client.DenialReason) string {
	if reason == nil {
		return ""
	}
	switch *reason {
	case client.DenialAgentNotFound:
		return "agent ID does not exist; check `cerniq agents register` output"
	case client.DenialAgentRevoked:
		return "agent was revoked — irreversible; register a fresh agent"
	case client.DenialInvalidSignature:
		return "token signature does not match agent's public key; re-mint via `cerniq policy create`"
	case client.DenialPolicyRevoked:
		return "policy was revoked since the token was minted; mint a fresh policy"
	case client.DenialPolicyExpired:
		return "policy TTL elapsed; `cerniq policy create` again with a longer --ttl"
	case client.DenialScopeNotGranted:
		return "the action/merchant is outside the policy scope; widen --scope or --allowed-domains"
	case client.DenialSpendLimitExceeded:
		return "the agent has exhausted its spend limit window; raise --max-per-day or wait"
	case client.DenialTrustScoreTooLow:
		return "BATE trust score is below the relying party's threshold; review recent fraud reports"
	case client.DenialAnomalyFlagged:
		return "BATE anomaly engine flagged this transaction; investigate via `cerniq events <agentId>`"
	}
	return ""
}
