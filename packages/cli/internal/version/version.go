// Package version exposes build-time version metadata. Values are
// injected by goreleaser via -ldflags at link time; defaults are
// development-mode markers so a `go run` invocation surfaces clearly
// in `cerniq --version` output.
package version

// Version is the semver tag. Set via -ldflags "-X .../version.Version=v1.2.3".
var Version = "dev"

// Commit is the short git SHA. Set via -ldflags.
var Commit = "none"

// BuildDate is the ISO-8601 build timestamp. Set via -ldflags.
var BuildDate = "unknown"

// String returns a one-line human-readable identifier suitable for
// `cerniq --version` and User-Agent headers.
func String() string {
	return Version + " (" + Commit + " · " + BuildDate + ")"
}

// UserAgent returns the User-Agent string the HTTP client uses on every
// outbound request. Centralizing it here avoids drift across packages.
func UserAgent() string {
	return "cerniq-cli/" + Version + " (+https://cerniqapp.com)"
}
