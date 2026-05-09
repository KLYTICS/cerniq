package cmd

import "os"

// osGetenv is a one-line indirection so the unit test for whoami can
// override env lookups without monkey-patching the standard library.
// It exists in its own file so other subcommands can share the seam.
var osGetenv = os.Getenv
