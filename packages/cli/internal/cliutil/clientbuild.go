// Package cliutil hosts shared helpers for cobra commands — client
// construction with credential resolution, JSON-mode rendering, and
// signal-aware contexts. Lives in its own package so cmd/* can import
// it without taking a dependency on root.go's package-level state.
package cliutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/klytics/cerniq/packages/cli/internal/client"
	"github.com/klytics/cerniq/packages/cli/internal/config"
	"github.com/klytics/cerniq/packages/cli/internal/keychain"
)

// ResolveAPIKey applies the documented precedence: flag > env > keychain.
// Returns "" when no credential is configured anywhere — callers raise
// ErrNotAuthenticated to drive the "run cerniq login" hint.
func ResolveAPIKey(flag string) string {
	if flag != "" {
		return flag
	}
	if env := os.Getenv("CERNIQ_API_KEY"); env != "" {
		return env
	}
	if k, _ := keychain.Get(keychain.KeyAPIKey); k != "" {
		return k
	}
	return ""
}

// ResolveVerifyKey resolves the verify-only key with the same precedence.
// Used by `cerniq verify` when the caller has minted a verify key.
func ResolveVerifyKey(flag string) string {
	if flag != "" {
		return flag
	}
	if env := os.Getenv("CERNIQ_VERIFY_KEY"); env != "" {
		return env
	}
	if k, _ := keychain.Get(keychain.KeyVerifyKey); k != "" {
		return k
	}
	return ""
}

// BuildOpts is the constructor input for NewClient.
type BuildOpts struct {
	ConfigPath  string
	BaseURLFlag string
	APIKeyFlag  string
	VerifyFlag  string
	// RequireAuth, when true, surfaces ErrNotAuthenticated if neither key
	// is configured. Set false for `cerniq doctor` (which can run
	// unauthenticated to diagnose first-run state).
	RequireAuth bool
}

// NewClient is the canonical client constructor for commands. It loads
// the config, resolves both keys, and returns a ready *client.Client.
func NewClient(o BuildOpts) (*client.Client, *config.Config, error) {
	cfg, err := config.Load(o.ConfigPath)
	if err != nil {
		return nil, nil, fmt.Errorf("load config: %w", err)
	}
	apiKey := ResolveAPIKey(o.APIKeyFlag)
	verifyKey := ResolveVerifyKey(o.VerifyFlag)
	if o.RequireAuth && apiKey == "" && verifyKey == "" {
		return nil, cfg, client.ErrNotAuthenticated
	}
	baseURL := cfg.ResolveBaseURL(o.BaseURLFlag)
	opts := []client.Option{}
	if verifyKey != "" {
		opts = append(opts, client.WithVerifyKey(verifyKey))
	}
	c, err := client.New(baseURL, apiKey, opts...)
	if err != nil {
		return nil, cfg, fmt.Errorf("build client: %w", err)
	}
	return c, cfg, nil
}

// RenderJSON pretty-prints v to w. Used by every command's --json branch
// so the output shape is identical across verbs (2-space indent, no HTML
// escaping — relying parties pipe this into jq).
func RenderJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

// SignalContext returns a context that cancels on SIGINT or SIGTERM.
// Used by `cerniq events tail` and any other long-running poll loop —
// Ctrl-C exits cleanly instead of leaving a zombie goroutine.
func SignalContext(parent context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(parent)
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		select {
		case <-ch:
			cancel()
		case <-ctx.Done():
		}
		signal.Stop(ch)
	}()
	return ctx, cancel
}

// TimeoutContext is a 30s-bounded context for one-shot RPCs. Hides the
// import bloat that would otherwise pollute every command file.
func TimeoutContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

// IsAPINotFound returns true when err is a 404 APIError. Used by
// `cerniq agents show` and friends so a missing resource can be
// rendered as a clean message instead of a stacktrace.
func IsAPINotFound(err error) bool {
	var ae *client.APIError
	if errors.As(err, &ae) {
		return ae.Status == 404
	}
	return false
}
