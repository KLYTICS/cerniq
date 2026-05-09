// Package keychain stores AEGIS credentials in the host's secure
// credential store: macOS Keychain, freedesktop Secret Service (gnome-
// keyring / kwallet), or Windows Credential Manager. On hosts where no
// secure store is available (CI, headless servers), the implementation
// falls back to an encrypted file at ~/.config/aegis/keychain (mode
// 0600), keyed off a per-host random secret stored in the same dir.
//
// The `99designs/keyring` library handles all three OS backends behind
// a single interface. We deliberately do NOT roll our own crypto here —
// CLAUDE.md stack reality says "one curve, one library, audited."
package keychain

import (
	"errors"
	"fmt"

	"github.com/99designs/keyring"
)

// Service is the keychain service name. All AEGIS CLI entries are
// scoped to this service so a single `aegis logout --all` can purge
// every credential without touching unrelated entries.
const Service = "io.aegislabs.cli"

// KeyAPIKey is the keychain entry name for the primary management API
// key (X-AEGIS-API-Key — full CRUD on agents/policies/audit).
const KeyAPIKey = "api_key"

// KeyVerifyKey is the keychain entry name for a verify-only key
// (X-AEGIS-Verify-Key — read-only, /verify-only). Relying parties
// often hold *only* this key. Stored separately so `aegis logout`
// can purge one role without touching the other.
const KeyVerifyKey = "verify_key"

// open returns a keyring.Keyring scoped to the AEGIS service, with a
// fallback chain that prefers OS-native stores. The fallback file
// backend exists so CI environments (no Keychain.app, no DBus) still
// work — the user must accept that a CI secret store is only as
// secure as its filesystem perms.
func open() (keyring.Keyring, error) {
	cfg := keyring.Config{
		ServiceName:                    Service,
		AllowedBackends:                []keyring.BackendType{keyring.KeychainBackend, keyring.SecretServiceBackend, keyring.WinCredBackend, keyring.FileBackend},
		KeychainTrustApplication:       true,
		KeychainAccessibleWhenUnlocked: true,
		LibSecretCollectionName:        "aegis",
		WinCredPrefix:                  Service,
		FileDir:                        "~/.config/aegis/keychain",
	}
	kr, err := keyring.Open(cfg)
	if err != nil {
		return nil, fmt.Errorf("open keychain: %w", err)
	}
	return kr, nil
}

// Set stores or replaces a credential under the given key (e.g. "api_key").
// Empty values are rejected to avoid the foot-gun of accidentally writing
// a blank credential that would later masquerade as authentication.
func Set(key, value string) error {
	if value == "" {
		return errors.New("keychain: refusing to store empty credential")
	}
	kr, err := open()
	if err != nil {
		return err
	}
	return kr.Set(keyring.Item{
		Key:                         key,
		Data:                        []byte(value),
		Label:                       "AEGIS — " + key,
		Description:                 "Operator credential for the aegis CLI",
		KeychainNotTrustApplication: false,
	})
}

// Get retrieves a credential. Returns ("", nil) if the entry is missing
// — callers distinguish "logged out" from a real error this way.
func Get(key string) (string, error) {
	kr, err := open()
	if err != nil {
		return "", err
	}
	item, err := kr.Get(key)
	if errors.Is(err, keyring.ErrKeyNotFound) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read keychain entry %q: %w", key, err)
	}
	return string(item.Data), nil
}

// Remove deletes a credential. A missing entry is a no-op (idempotent
// logout) so `aegis logout` doesn't fail when the user is already out.
func Remove(key string) error {
	kr, err := open()
	if err != nil {
		return err
	}
	if err := kr.Remove(key); err != nil && !errors.Is(err, keyring.ErrKeyNotFound) {
		return fmt.Errorf("remove keychain entry %q: %w", key, err)
	}
	return nil
}
