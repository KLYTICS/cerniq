// Package client is the HTTP client the CLI uses to talk to the CERNIQ
// API. It mirrors the public TS SDK's surface (packages/sdk-ts) so a
// developer who has read either is at home with the other.
//
// Long-term plan: regenerate this client from docs/spec/CERNIQ_API_SPEC.yaml
// via oapi-codegen. For now the surface area is hand-rolled to keep
// the CLI compilable without a code-gen step in CI. The hand-rolled
// shapes are deliberately narrow — only the fields the CLI uses today.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/klytics/cerniq/packages/cli/internal/version"
)

// Client is the HTTP transport. Construct via New(...) — the zero value
// is intentionally unusable (forces explicit base URL + auth).
type Client struct {
	baseURL   string
	apiKey    string
	verifyKey string
	http      *http.Client
}

// Option configures a Client at construction. Used for optional state
// (verify key, alternate http client) that not every CLI command needs.
type Option func(*Client)

// WithVerifyKey sets the X-CERNIQ-Verify-Key the client sends to /verify.
// When unset, /verify uses the management API key (which the spec also
// accepts). Relying parties typically have *only* a verify key — the
// CLI honors that pattern.
func WithVerifyKey(k string) Option { return func(c *Client) { c.verifyKey = k } }

// WithHTTPClient overrides the default 30s-timeout client. Tests use this
// to plug in an httptest.Server transport.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// New returns a Client. baseURL must be an absolute URL; apiKey may be
// empty for endpoints that don't require it (`/health`, `/agents/{id}/status`).
func New(baseURL, apiKey string, opts ...Option) (*Client, error) {
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("invalid base URL %q", baseURL)
	}
	c := &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c, nil
}

// authMode picks which credential header gets attached to a request.
type authMode int

const (
	authAPIKey authMode = iota // X-CERNIQ-API-Key (management endpoints)
	authVerify                 // X-CERNIQ-Verify-Key, falls back to api key
	authNone                   // public endpoint (e.g. /agents/{id}/status)
)

// Health pings /health. It returns nil on 200, an error otherwise.
// Used by `cerniq doctor` and as the keepalive in `cerniq listen`.
func (c *Client) Health(ctx context.Context) error {
	req, err := c.req(ctx, http.MethodGet, "/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("call health: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health returned %d", resp.StatusCode)
	}
	return nil
}

// Me returns the principal associated with the current API key. Used
// by `cerniq whoami` and as the post-login round-trip that confirms the
// credential actually works before persisting it.
func (c *Client) Me(ctx context.Context) (*Principal, error) {
	req, err := c.req(ctx, http.MethodGet, "/v1/me", nil)
	if err != nil {
		return nil, err
	}
	var out Principal
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// req builds an *http.Request with the standard CERNIQ headers attached.
// Body is JSON-encoded if non-nil.
func (c *Client) req(ctx context.Context, method, path string, body any) (*http.Request, error) {
	return c.reqWithAuth(ctx, method, path, body, authAPIKey)
}

// reqWithAuth lets callers pick the auth mode. Used by /verify (which
// may use a verify-key) and the public status endpoint (which uses none).
func (c *Client) reqWithAuth(ctx context.Context, method, path string, body any, mode authMode) (*http.Request, error) {
	var buf io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		buf = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", version.UserAgent())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	switch mode {
	case authAPIKey:
		if c.apiKey != "" {
			req.Header.Set("X-CERNIQ-API-Key", c.apiKey)
		}
	case authVerify:
		if c.verifyKey != "" {
			req.Header.Set("X-CERNIQ-Verify-Key", c.verifyKey)
		} else if c.apiKey != "" {
			req.Header.Set("X-CERNIQ-API-Key", c.apiKey)
		}
	case authNone:
		// public endpoint — no header attached
	}
	return req, nil
}

// do executes the request and decodes a JSON response into out (which
// may be nil to discard). Non-2xx responses are surfaced as a typed
// APIError so callers can branch on `errors.As(err, &APIError{})`.
func (c *Client) do(req *http.Request, out any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("transport: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return parseAPIError(resp.StatusCode, body)
	}
	if out == nil || len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

// parseAPIError extracts the CERNIQ error envelope `{ error: { code,
// message, ... } }`. If the body doesn't match, it falls back to the
// raw status text so the user always sees something useful.
func parseAPIError(status int, body []byte) error {
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err == nil && env.Error.Code != "" {
		return &APIError{
			Status:  status,
			Code:    env.Error.Code,
			Message: env.Error.Message,
		}
	}
	return &APIError{
		Status:  status,
		Code:    "UNKNOWN",
		Message: strings.TrimSpace(string(body)),
	}
}

// Principal is the response shape of GET /v1/me — narrow projection.
type Principal struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Tier  string `json:"tier"`
}

// APIError is a typed error for non-2xx responses. Callers can pattern-
// match on Code to drive UX (e.g. show a re-login prompt on 401).
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("cerniq api %d %s: %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("cerniq api %d %s", e.Status, e.Code)
}

// IsUnauthorized returns true for 401/403 — a stable predicate for
// callers that want to surface a "run `cerniq login` again" hint.
func (e *APIError) IsUnauthorized() bool {
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden
}

// Sentinel error for "no credential configured" — distinct from a 401
// because it never even attempted the API call. Used by login.go to
// distinguish first-run from token-expired.
var ErrNotAuthenticated = errors.New("not authenticated — run `cerniq login`")
