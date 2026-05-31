package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/spf13/cobra"

	"github.com/klytics/cerniq/packages/cli/internal/client"
	"github.com/klytics/cerniq/packages/cli/internal/cliutil"
	"github.com/klytics/cerniq/packages/cli/internal/ui"
)

func init() {
	policyCreateCmd.Flags().String("agent", "",
		"agent ID the policy applies to (required)")
	policyCreateCmd.Flags().String("file", "",
		"path to a YAML/JSON policy spec (mutually exclusive with --scope/--ttl/--label)")
	policyCreateCmd.Flags().StringSlice("scope", nil,
		"scope category (commerce|data-read|data-write|communication|scheduling); repeatable")
	policyCreateCmd.Flags().Float64("max-per-tx", 0,
		"max amount per transaction (USD unless --currency overrides)")
	policyCreateCmd.Flags().Float64("max-per-day", 0,
		"max spend per day")
	policyCreateCmd.Flags().Float64("max-per-month", 0,
		"max spend per month")
	policyCreateCmd.Flags().String("currency", "USD",
		"spend limit currency: USD|EUR|GBP")
	policyCreateCmd.Flags().StringSlice("merchant-categories", nil,
		"MCC codes the agent may transact with (e.g. 3000-3299,5411)")
	policyCreateCmd.Flags().StringSlice("allowed-domains", nil,
		"domains the agent may transact with (e.g. delta.com)")
	policyCreateCmd.Flags().StringSlice("data-scopes", nil,
		"data scopes (e.g. read:email)")
	policyCreateCmd.Flags().Duration("ttl", 24*time.Hour,
		"how long the policy is valid")
	policyCreateCmd.Flags().String("label", "", "human-readable label")
	policyListCmd.Flags().String("agent", "", "agent ID (required)")

	policyCmd.AddCommand(policyCreateCmd, policyListCmd, policyRevokeCmd, policyInspectCmd)
	rootCmd.AddCommand(policyCmd)
}

var policyCmd = &cobra.Command{
	Use:     "policy",
	Aliases: []string{"policies"},
	Short:   "Manage scoped policies (create, list, revoke, inspect)",
	Long: `Manage scoped policies.

Policies are signed JWTs (Ed25519/EdDSA) that bind an agent to a scope,
spend limit, domain allow-list, and TTL. The policy JWT is the single
artifact a relying party verifies on every call — see CLAUDE.md
invariant 6 for the denial-precedence ordering RPs code against.`,
}

var policyCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Mint a new scoped policy and print the signed JWT",
	RunE:  runPolicyCreate,
}

var policyListCmd = &cobra.Command{
	Use:   "list",
	Short: "List active policies for an agent",
	RunE:  runPolicyList,
}

var policyRevokeCmd = &cobra.Command{
	Use:   "revoke <agentId> <policyId>",
	Short: "Revoke a policy (writes audit row + invalidates cached verify)",
	Args:  cobra.ExactArgs(2),
	RunE:  runPolicyRevoke,
}

var policyInspectCmd = &cobra.Command{
	Use:   "inspect <jwt>",
	Short: "Decode a policy JWT and pretty-print its claims (no signature verify)",
	Args:  cobra.ExactArgs(1),
	RunE:  runPolicyInspect,
}

func runPolicyCreate(cmd *cobra.Command, _ []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	agentID, _ := cmd.Flags().GetString("agent")
	if agentID == "" {
		return errors.New("--agent is required")
	}
	file, _ := cmd.Flags().GetString("file")
	scopes, _ := cmd.Flags().GetStringSlice("scope")
	if file == "" && len(scopes) == 0 {
		return errors.New("provide --file or at least one --scope")
	}

	var spec client.PolicyCreateRequest
	if file != "" {
		raw, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("read policy spec: %w", err)
		}
		if err := json.Unmarshal(raw, &spec); err != nil {
			return fmt.Errorf("parse policy spec (expected JSON; YAML support pending): %w", err)
		}
	} else {
		ttl, _ := cmd.Flags().GetDuration("ttl")
		spec.ExpiresAt = time.Now().UTC().Add(ttl)
		spec.Label, _ = cmd.Flags().GetString("label")
		var limit *client.PolicySpendLimit
		maxTx, _ := cmd.Flags().GetFloat64("max-per-tx")
		maxDay, _ := cmd.Flags().GetFloat64("max-per-day")
		maxMonth, _ := cmd.Flags().GetFloat64("max-per-month")
		currency, _ := cmd.Flags().GetString("currency")
		if maxTx > 0 || maxDay > 0 || maxMonth > 0 {
			limit = &client.PolicySpendLimit{
				Currency:          currency,
				MaxPerTransaction: maxTx,
				MaxPerDay:         maxDay,
				MaxPerMonth:       maxMonth,
			}
		}
		mcc, _ := cmd.Flags().GetStringSlice("merchant-categories")
		domains, _ := cmd.Flags().GetStringSlice("allowed-domains")
		dataScopes, _ := cmd.Flags().GetStringSlice("data-scopes")
		for _, s := range scopes {
			spec.Scopes = append(spec.Scopes, client.PolicyScope{
				Category:           client.PolicyScopeCategory(s),
				SpendLimit:         limit,
				MerchantCategories: mcc,
				AllowedDomains:     domains,
				DataScopes:         dataScopes,
			})
		}
	}

	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	resp, err := c.PoliciesCreate(ctx, agentID, &spec)
	if err != nil {
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), resp)
	}
	w := cmd.OutOrStdout()
	ui.Heading(w, "policy minted")
	ui.Row(w, "policy id", resp.PolicyID)
	ui.Row(w, "expires at", resp.ExpiresAt.Format(time.RFC3339))
	ui.Heading(w, "signed token (attach as Authorization: Bearer)")
	fmt.Fprintln(w, resp.SignedToken)
	ui.Warn(w, "the token is shown once; copy it now — CERNIQ does not retain plaintext copies.")
	return nil
}

func runPolicyList(cmd *cobra.Command, _ []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	agentID, _ := cmd.Flags().GetString("agent")
	if agentID == "" {
		return errors.New("--agent is required")
	}
	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	policies, err := c.PoliciesList(ctx, agentID)
	if err != nil {
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), policies)
	}
	w := cmd.OutOrStdout()
	if len(policies) == 0 {
		ui.Warn(w, "no policies for agent "+agentID)
		return nil
	}
	ui.Heading(w, fmt.Sprintf("%d policies for %s", len(policies), agentID))
	for _, p := range policies {
		ui.Row(w, p.PolicyID, fmt.Sprintf("%s · %d scope(s) · expires %s",
			p.Status, len(p.Scopes), p.ExpiresAt.Format(time.RFC3339)))
	}
	return nil
}

func runPolicyRevoke(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	if err := c.PoliciesRevoke(ctx, args[0], args[1]); err != nil {
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), map[string]any{
			"agentId": args[0], "policyId": args[1], "revoked": true,
		})
	}
	ui.OK(cmd.OutOrStdout(), fmt.Sprintf("revoked policy %s on agent %s", args[1], args[0]))
	return nil
}

// runPolicyInspect decodes the JWT WITHOUT verifying its signature.
// This is the same shape as `gh auth status --show-token` — useful for
// debugging without needing the signing key. Anyone consuming the
// inspected claims for trust decisions MUST also call /verify, which
// is the only signature-verifying surface CERNIQ publishes.
func runPolicyInspect(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	tok, err := jwt.ParseSigned(args[0], allowedJWTAlgs())
	if err != nil {
		return fmt.Errorf("parse JWT: %w", err)
	}
	var claims map[string]any
	if err := tok.UnsafeClaimsWithoutVerification(&claims); err != nil {
		return fmt.Errorf("decode claims: %w", err)
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), claims)
	}
	w := cmd.OutOrStdout()
	ui.Heading(w, "policy claims (UNVERIFIED — call /verify for trust)")
	for k, v := range claims {
		ui.Row(w, k, fmt.Sprintf("%v", v))
	}
	if hdrs := tok.Headers; len(hdrs) > 0 {
		ui.Heading(w, "headers")
		for _, h := range hdrs {
			ui.Row(w, "alg", h.Algorithm)
			if h.KeyID != "" {
				ui.Row(w, "kid", h.KeyID)
			}
		}
	}
	return nil
}

// allowedJWTAlgs returns the closed set of signing algorithms CERNIQ
// emits. Per CLAUDE.md stack reality, only EdDSA (Ed25519) is in scope —
// passing any other alg through inspect would surface a misconfigured
// policy that wouldn't pass /verify anyway.
func allowedJWTAlgs() []jose.SignatureAlgorithm {
	return []jose.SignatureAlgorithm{jose.EdDSA}
}
