package cmd

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"time"

	"github.com/klytics/cerniq/packages/cli/internal/client"
	"github.com/klytics/cerniq/packages/cli/internal/config"
	"github.com/klytics/cerniq/packages/cli/internal/plugin"
	"github.com/klytics/cerniq/packages/cli/internal/ui"
	"github.com/klytics/cerniq/packages/cli/internal/version"
	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(doctorCmd)
}

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Diagnose the CLI's environment and connectivity",
	Long: `Diagnose the CLI's environment and connectivity.

Runs a battery of checks: binary version, OS support, config presence,
credential presence, API reachability, clock skew, JWKS reachability,
plugin discovery. Prints each check with a green tick / yellow warning
/ red cross and an inline remediation.

Exit code is the count of failed (red) checks. Warnings (yellow) do not
fail the command — they're surfaced so the operator can act before the
problem becomes blocking.`,
	RunE: runDoctor,
}

// check is one diagnostic. RunE produces a result.
type check struct {
	name string
	run  func(ctx context.Context) checkResult
}

// checkResult carries the outcome. Status is "ok", "warn", or "err".
type checkResult struct {
	Status   string `json:"status"`
	Message  string `json:"message"`
	Remedy   string `json:"remedy,omitempty"`
	Duration string `json:"duration"`
}

func runDoctor(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cfg, _ := config.Load(flagConfig)
	baseURL := cfg.ResolveBaseURL(flagBaseURL)

	checks := []check{
		{
			name: "binary metadata",
			run: func(_ context.Context) checkResult {
				return ok("cerniq " + version.String() + " (" + runtime.GOOS + "/" + runtime.GOARCH + ")")
			},
		},
		{
			name: "config file",
			run: func(_ context.Context) checkResult {
				p, err := config.Path(flagConfig)
				if err != nil {
					return errCheck("could not resolve config path: "+err.Error(), "set --config or CERNIQ_CONFIG")
				}
				return ok("path = " + p)
			},
		},
		{
			name: "base URL configured",
			run: func(_ context.Context) checkResult {
				if _, err := url.ParseRequestURI(baseURL); err != nil {
					return errCheck("invalid base URL "+baseURL, "set --base-url or run `cerniq login --base-url ...`")
				}
				return ok(baseURL)
			},
		},
		{
			name: "credential present",
			run: func(_ context.Context) checkResult {
				if resolveAPIKey() == "" {
					return warn("no credential configured", "run `cerniq login --api-key cerniq_sk_...`")
				}
				return ok("found in keychain or env")
			},
		},
		{
			name: "API reachable",
			run: func(ctx context.Context) checkResult {
				c, err := client.New(baseURL, "")
				if err != nil {
					return errCheck(err.Error(), "")
				}
				start := time.Now()
				if err := c.Health(ctx); err != nil {
					return errCheck("health check failed: "+err.Error(), "verify network egress + API status page")
				}
				return ok(fmt.Sprintf("ok in %s", time.Since(start).Round(time.Millisecond)))
			},
		},
		{
			name: "credential accepted",
			run: func(ctx context.Context) checkResult {
				key := resolveAPIKey()
				if key == "" {
					return warn("skipped (no credential)", "")
				}
				c, err := client.New(baseURL, key)
				if err != nil {
					return errCheck(err.Error(), "")
				}
				me, err := c.Me(ctx)
				if err != nil {
					var apiErr *client.APIError
					if errors.As(err, &apiErr) && apiErr.IsUnauthorized() {
						return errCheck("credential rejected (HTTP "+fmt.Sprint(apiErr.Status)+")", "run `cerniq login` to refresh")
					}
					return errCheck(err.Error(), "")
				}
				return ok(me.Email + " (" + me.Tier + ")")
			},
		},
		{
			name: "JWKS reachable",
			run: func(ctx context.Context) checkResult {
				u := baseURL + "/.well-known/jwks.json"
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
				if err != nil {
					return errCheck(err.Error(), "")
				}
				// MinVersion pinned to TLS 1.2 per semgrep
				// `go.lang.security.audit.crypto.missing-ssl-minversion` (OD-020).
				// Matches Go 1.22+ default but stated explicitly so a future Go
				// downgrade or runtime override can't silently let TLS 1.0/1.1 in.
				h := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}}
				resp, err := h.Do(req)
				if err != nil {
					return warn("JWKS unreachable: "+err.Error(), "RPs that verify offline will fail until this is reachable")
				}
				defer resp.Body.Close()
				if resp.StatusCode != http.StatusOK {
					return warn(fmt.Sprintf("JWKS returned %d", resp.StatusCode), "")
				}
				return ok(u)
			},
		},
		{
			name: "clock skew",
			run: func(ctx context.Context) checkResult {
				req, err := http.NewRequestWithContext(ctx, http.MethodHead, baseURL+"/health", nil)
				if err != nil {
					return errCheck(err.Error(), "")
				}
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					return warn("could not measure: "+err.Error(), "")
				}
				defer resp.Body.Close()
				dateHdr := resp.Header.Get("Date")
				if dateHdr == "" {
					return warn("server did not return Date header", "")
				}
				serverTime, err := http.ParseTime(dateHdr)
				if err != nil {
					return warn("could not parse server Date: "+err.Error(), "")
				}
				skew := time.Since(serverTime)
				if skew < 0 {
					skew = -skew
				}
				if skew > 30*time.Second {
					return warn(
						fmt.Sprintf("clock skew %s exceeds 30s", skew.Round(time.Second)),
						"sync system clock — JWT exp/nbf checks reject large skew")
				}
				return ok(fmt.Sprintf("skew = %s", skew.Round(time.Millisecond)))
			},
		},
		{
			name: "plugins discovered",
			run: func(_ context.Context) checkResult {
				ps := plugin.List()
				if len(ps) == 0 {
					return ok("none installed")
				}
				names := ""
				for i, p := range ps {
					if i > 0 {
						names += ", "
					}
					names += p.Name
				}
				return ok(fmt.Sprintf("%d found (%s)", len(ps), names))
			},
		},
		{
			name: "go runtime sanity",
			run: func(_ context.Context) checkResult {
				_, err := exec.LookPath("git")
				if err != nil {
					return warn("git not on PATH", "git is needed for `cerniq init` template fetching")
				}
				return ok("git on PATH")
			},
		},
	}

	results := map[string]checkResult{}
	failures := 0
	out := cmd.OutOrStdout()
	if !flagJSON {
		ui.AutoDisable(out)
		ui.Heading(out, "cerniq doctor")
	}
	for _, c := range checks {
		start := time.Now()
		r := c.run(ctx)
		r.Duration = time.Since(start).Round(time.Millisecond).String()
		results[c.name] = r
		if r.Status == "err" {
			failures++
		}
		if flagJSON {
			continue
		}
		switch r.Status {
		case "ok":
			ui.OK(out, fmt.Sprintf("%-22s %s", c.name, r.Message))
		case "warn":
			ui.Warn(out, fmt.Sprintf("%-22s %s", c.name, r.Message))
			if r.Remedy != "" {
				fmt.Fprintf(out, "  → %s\n", r.Remedy)
			}
		case "err":
			ui.Err(out, fmt.Sprintf("%-22s %s", c.name, r.Message))
			if r.Remedy != "" {
				fmt.Fprintf(out, "  → %s\n", r.Remedy)
			}
		}
	}
	if flagJSON {
		_ = json.NewEncoder(out).Encode(results)
	}
	if failures > 0 {
		return fmt.Errorf("%d check(s) failed", failures)
	}
	return nil
}

func ok(msg string) checkResult              { return checkResult{Status: "ok", Message: msg} }
func warn(msg, remedy string) checkResult    { return checkResult{Status: "warn", Message: msg, Remedy: remedy} }
func errCheck(msg, remedy string) checkResult { return checkResult{Status: "err", Message: msg, Remedy: remedy} }
