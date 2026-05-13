package cmd

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/klytics/aegis/packages/cli/internal/client"
	"github.com/klytics/aegis/packages/cli/internal/cliutil"
	"github.com/klytics/aegis/packages/cli/internal/ui"
)

func init() {
	agentsRegisterCmd.Flags().String("public-key", "",
		"path to base64url-encoded Ed25519 public key file (use '-' to read from stdin)")
	agentsRegisterCmd.Flags().Bool("generate-keypair", false,
		"generate a fresh Ed25519 keypair locally; private key prints to stdout once and is NEVER sent to AEGIS")
	agentsRegisterCmd.Flags().String("runtime", "custom",
		"agent runtime: openai|anthropic|google|custom")
	agentsRegisterCmd.Flags().String("model", "", "model identifier (e.g. gpt-4o)")
	agentsRegisterCmd.Flags().String("principal-id", "",
		"AEGIS principal ID (defaults to the principal of the API key)")
	agentsRegisterCmd.Flags().String("label", "", "human-readable label")

	agentsCmd.AddCommand(agentsRegisterCmd, agentsShowCmd, agentsStatusCmd, agentsRevokeCmd)
	rootCmd.AddCommand(agentsCmd)
}

var agentsCmd = &cobra.Command{
	Use:     "agents",
	Aliases: []string{"agent"},
	Short:   "Manage agent identities (register, show, status, revoke)",
}

var agentsRegisterCmd = &cobra.Command{
	Use:   "register",
	Short: "Register a new agent identity",
	Long: `Register a new agent identity.

The agent's PRIVATE key never enters AEGIS (CLAUDE.md invariant 1). You
either:

  --generate-keypair     mint a fresh Ed25519 keypair locally; the CLI
                         prints the base64url-encoded private key once,
                         to stdout. Save it. AEGIS will refuse to mint
                         a replacement.

  --public-key <path>    register an existing public key. The file
                         contents are read raw — base64url-encoded
                         Ed25519 public key, no PEM, no whitespace.
                         '-' reads from stdin.`,
	RunE: runAgentsRegister,
}

var agentsShowCmd = &cobra.Command{
	Use:   "show <agentId>",
	Short: "Show one agent's identity, status, and trust band",
	Args:  cobra.ExactArgs(1),
	RunE:  runAgentsShow,
}

var agentsStatusCmd = &cobra.Command{
	Use:   "status <agentId>",
	Short: "Public status check (no API key required) — returns trust score + band",
	Args:  cobra.ExactArgs(1),
	RunE:  runAgentsStatus,
}

var agentsRevokeCmd = &cobra.Command{
	Use:   "revoke <agentId>",
	Short: "Revoke an agent identity (irreversible)",
	Args:  cobra.ExactArgs(1),
	RunE:  runAgentsRevoke,
}

func runAgentsRegister(cmd *cobra.Command, _ []string) error {
	ui.AutoDisable(cmd.OutOrStdout())

	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath:  flagConfig,
		BaseURLFlag: flagBaseURL,
		APIKeyFlag:  flagAPIKey,
		RequireAuth: true,
	})
	if err != nil {
		return err
	}

	pubKeyFlag, _ := cmd.Flags().GetString("public-key")
	gen, _ := cmd.Flags().GetBool("generate-keypair")
	runtime, _ := cmd.Flags().GetString("runtime")
	model, _ := cmd.Flags().GetString("model")
	principalID, _ := cmd.Flags().GetString("principal-id")
	label, _ := cmd.Flags().GetString("label")

	if (pubKeyFlag == "" && !gen) || (pubKeyFlag != "" && gen) {
		return errors.New("provide exactly one of --public-key or --generate-keypair")
	}

	pub, priv, err := resolvePublicKey(pubKeyFlag, gen, cmd.InOrStdin())
	if err != nil {
		return err
	}

	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	resp, err := c.AgentsRegister(ctx, &client.AgentRegisterRequest{
		PublicKey:   pub,
		Runtime:     client.AgentRuntime(runtime),
		Model:       model,
		PrincipalID: principalID,
		Label:       label,
	})
	if err != nil {
		return err
	}

	if flagJSON {
		out := map[string]any{
			"agent":            resp,
			"runtime":          runtime,
			"label":            label,
			"privateKeyOnce":   priv, // empty unless --generate-keypair
			"keyEncoding":      "base64url",
			"keyAlgorithm":     "Ed25519",
			"keyPrintingNote":  "private key shown ONCE; AEGIS never receives it",
			"verificationStep": fmt.Sprintf("sign the verificationToken with the matching private key, then call POST /v1/agents/%s/verify-handshake", resp.AgentID),
		}
		return cliutil.RenderJSON(cmd.OutOrStdout(), out)
	}

	w := cmd.OutOrStdout()
	ui.Heading(w, "agent registered")
	ui.Row(w, "agent id", resp.AgentID)
	ui.Row(w, "trust score", fmt.Sprintf("%d", resp.TrustScore))
	ui.Row(w, "registered at", resp.RegisteredAt.Format(time.RFC3339))
	ui.Row(w, "runtime", runtime)
	if model != "" {
		ui.Row(w, "model", model)
	}
	if label != "" {
		ui.Row(w, "label", label)
	}
	ui.Row(w, "verification token", resp.VerificationToken)
	if priv != "" {
		ui.Heading(w, "private key — printed ONCE, save now")
		fmt.Fprintln(w, priv)
		ui.Warn(w, "AEGIS holds only the public key. If you lose this private key, register a new agent.")
	}
	return nil
}

func runAgentsShow(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	a, err := c.AgentsGet(ctx, args[0])
	if err != nil {
		if cliutil.IsAPINotFound(err) {
			return fmt.Errorf("agent %s not found", args[0])
		}
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), a)
	}
	w := cmd.OutOrStdout()
	ui.Heading(w, "agent "+a.AgentID)
	ui.Row(w, "principal", a.PrincipalID)
	ui.Row(w, "runtime", string(a.Runtime))
	if a.Model != "" {
		ui.Row(w, "model", a.Model)
	}
	if a.Label != "" {
		ui.Row(w, "label", a.Label)
	}
	ui.Row(w, "status", string(a.Status))
	ui.Row(w, "trust score", fmt.Sprintf("%d", a.TrustScore))
	ui.Row(w, "trust band", string(a.TrustBand))
	ui.Row(w, "registered at", a.RegisteredAt.Format(time.RFC3339))
	if a.LastSeenAt != nil {
		ui.Row(w, "last seen", a.LastSeenAt.Format(time.RFC3339))
	}
	ui.Row(w, "public key", a.PublicKey)
	return nil
}

func runAgentsStatus(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	// Status is a public endpoint — build a client without requiring auth.
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: false,
	})
	if err != nil {
		return err
	}
	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	s, err := c.AgentsStatus(ctx, args[0])
	if err != nil {
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), s)
	}
	w := cmd.OutOrStdout()
	ui.Heading(w, "agent "+s.AgentID+" — status")
	ui.Row(w, "status", string(s.Status))
	ui.Row(w, "trust score", fmt.Sprintf("%d", s.TrustScore))
	ui.Row(w, "trust band", string(s.TrustBand))
	if s.LastSeenAt != nil {
		ui.Row(w, "last seen", s.LastSeenAt.Format(time.RFC3339))
	}
	return nil
}

func runAgentsRevoke(cmd *cobra.Command, args []string) error {
	ui.AutoDisable(cmd.OutOrStdout())
	c, _, err := cliutil.NewClient(cliutil.BuildOpts{
		ConfigPath: flagConfig, BaseURLFlag: flagBaseURL, APIKeyFlag: flagAPIKey, RequireAuth: true,
	})
	if err != nil {
		return err
	}
	ctx, cancel := cliutil.TimeoutContext()
	defer cancel()
	if err := c.AgentsRevoke(ctx, args[0]); err != nil {
		return err
	}
	if flagJSON {
		return cliutil.RenderJSON(cmd.OutOrStdout(), map[string]any{"agentId": args[0], "revoked": true})
	}
	ui.OK(cmd.OutOrStdout(), "revoked "+args[0])
	return nil
}

// resolvePublicKey returns (publicKey base64url, privateKey base64url
// only when --generate-keypair, error). The private key is empty for the
// --public-key path — AEGIS never receives it.
func resolvePublicKey(path string, gen bool, stdin io.Reader) (string, string, error) {
	if gen {
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return "", "", fmt.Errorf("generate keypair: %w", err)
		}
		return base64.RawURLEncoding.EncodeToString(pub),
			base64.RawURLEncoding.EncodeToString(priv.Seed()), nil
	}
	var raw []byte
	var err error
	if path == "-" {
		raw, err = io.ReadAll(stdin)
	} else {
		raw, err = os.ReadFile(path)
	}
	if err != nil {
		return "", "", fmt.Errorf("read public key: %w", err)
	}
	encoded := strings.TrimSpace(string(raw))
	if encoded == "" {
		return "", "", errors.New("public key file is empty")
	}
	// Sanity-check that the body decodes as 32 bytes of Ed25519 public key.
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		// Tolerate stdpadding base64 too — common copy-paste shape.
		decoded, err = base64.URLEncoding.DecodeString(encoded)
		if err != nil {
			return "", "", fmt.Errorf("public key is not valid base64url: %w", err)
		}
	}
	if l := len(decoded); l != ed25519.PublicKeySize {
		return "", "", fmt.Errorf("public key is %d bytes; Ed25519 expects %d", l, ed25519.PublicKeySize)
	}
	return encoded, "", nil
}
