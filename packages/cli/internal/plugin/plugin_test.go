package plugin

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// TestFind_NoMatchingPluginReturnsFalse exercises the negative path —
// `cerniq foo` with no `cerniq-foo` on PATH must report not-found, not
// surface a misleading error.
func TestFind_NoMatchingPluginReturnsFalse(t *testing.T) {
	t.Setenv("PATH", "")
	if path, ok := Find("definitely-not-installed"); ok {
		t.Fatalf("expected not-found, got %q", path)
	}
}

// TestFind_RejectsTraversal protects against `cerniq ../bin/sh` style
// argument injection — slashes in the plugin name must be rejected
// before the resolver consults PATH.
func TestFind_RejectsTraversal(t *testing.T) {
	cases := []string{"../etc/passwd", "a/b", "a\\b", ""}
	for _, c := range cases {
		if _, ok := Find(c); ok {
			t.Errorf("expected rejection for %q", c)
		}
	}
}

// TestList_FindsExecutableWithPrefix drops a fake plugin binary into a
// temp dir, points PATH at it, and confirms List() picks it up. We
// skip this test on Windows because the executable bit semantics
// differ (PATHEXT-based) and the surrounding test infra would balloon.
func TestList_FindsExecutableWithPrefix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PATHEXT-based exec detection — covered separately")
	}
	dir := t.TempDir()
	binPath := filepath.Join(dir, "cerniq-zoltar")
	if err := os.WriteFile(binPath, []byte("#!/bin/sh\necho hi\n"), 0o755); err != nil {
		t.Fatalf("seed plugin: %v", err)
	}
	t.Setenv("PATH", dir)
	plugins := List()
	found := false
	for _, p := range plugins {
		if p.Name == "zoltar" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected to find cerniq-zoltar; got %v", plugins)
	}
}
