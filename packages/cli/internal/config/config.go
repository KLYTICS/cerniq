// Package config loads and persists the CLI's user-scoped settings.
//
// The config file lives at $XDG_CONFIG_HOME/okoro/config.toml (typically
// ~/.config/okoro/config.toml). It holds non-secret state: base URL,
// default principal email, last-used profile name. Secrets — API keys,
// device-flow refresh tokens — live in the OS keychain, not on disk.
//
// File format is TOML for human-editable diff-friendliness; the OKORO
// monorepo otherwise uses JSON for wire payloads (Zod-validated) and
// YAML for OpenAPI. TOML is reserved for human-curated CLI settings,
// matching the conventions of the other Klytics-stack tools.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/pelletier/go-toml/v2"
)

// DefaultBaseURL is the production OKORO API host. CLI users override
// it via --base-url, OKORO_BASE_URL, or the `base_url` config field.
const DefaultBaseURL = "https://api.okoroapp.com"

// Config is the on-disk shape. Field tags match snake_case TOML keys.
type Config struct {
	// BaseURL is the OKORO API host the CLI talks to.
	BaseURL string `toml:"base_url,omitempty"`

	// DefaultProfile names which keychain credential entry to use when
	// the user has multiple OKORO principals on the same machine.
	DefaultProfile string `toml:"default_profile,omitempty"`

	// PrincipalEmail is cosmetic — surfaced in `okoro whoami` so the
	// user sees which account is active without round-tripping the API.
	// Authoritative answer always comes from /v1/me.
	PrincipalEmail string `toml:"principal_email,omitempty"`
}

// Path returns the absolute path to the config file. Honors --config
// override and XDG_CONFIG_HOME; falls back to ~/.config/okoro on POSIX
// and %AppData%\okoro on Windows.
func Path(override string) (string, error) {
	if override != "" {
		return override, nil
	}
	if env := os.Getenv("OKORO_CONFIG"); env != "" {
		return env, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config dir: %w", err)
	}
	return filepath.Join(dir, "okoro", "config.toml"), nil
}

// Load reads the config from disk. A missing file is not an error —
// it returns a zero-value Config so first-run flows just work.
func Load(override string) (*Config, error) {
	p, err := Path(override)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return &Config{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", p, err)
	}
	c := &Config{}
	if err := toml.Unmarshal(b, c); err != nil {
		return nil, fmt.Errorf("parse %s: %w", p, err)
	}
	return c, nil
}

// Save writes the config back to disk with restrictive perms (0600).
// Parent directory is created if missing. Atomic write via temp + rename
// so a crash mid-save can't corrupt the file.
func (c *Config) Save(override string) error {
	p, err := Path(override)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return fmt.Errorf("mkdir %s: %w", filepath.Dir(p), err)
	}
	b, err := toml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, p); err != nil {
		return fmt.Errorf("rename %s -> %s: %w", tmp, p, err)
	}
	return nil
}

// ResolveBaseURL applies precedence: CLI flag > env > config > default.
func (c *Config) ResolveBaseURL(flag string) string {
	if flag != "" {
		return flag
	}
	if env := os.Getenv("OKORO_BASE_URL"); env != "" {
		return env
	}
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return DefaultBaseURL
}
