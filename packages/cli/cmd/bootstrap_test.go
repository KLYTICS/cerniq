package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDetectFramework_Nextjs_ConfigFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "next.config.js"), []byte("module.exports = {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := detectFramework(dir)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if got != "nextjs" {
		t.Errorf("want nextjs, got %s", got)
	}
}

func TestDetectFramework_Nextjs_PackageJson(t *testing.T) {
	dir := t.TempDir()
	pkg := `{ "name": "x", "dependencies": { "next": "^16.0.0", "react": "^19.0.0" } }`
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(pkg), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := detectFramework(dir)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if got != "nextjs" {
		t.Errorf("want nextjs, got %s", got)
	}
}

func TestDetectFramework_Express(t *testing.T) {
	dir := t.TempDir()
	pkg := `{ "name": "x", "dependencies": { "express": "^4.19.0" } }`
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(pkg), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := detectFramework(dir)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if got != "express" {
		t.Errorf("want express, got %s", got)
	}
}

func TestDetectFramework_Fastapi_Pyproject(t *testing.T) {
	dir := t.TempDir()
	py := `[project]
name = "x"
dependencies = ["fastapi>=0.110", "uvicorn"]
`
	if err := os.WriteFile(filepath.Join(dir, "pyproject.toml"), []byte(py), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := detectFramework(dir)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if got != "fastapi" {
		t.Errorf("want fastapi, got %s", got)
	}
}

func TestDetectFramework_Fastapi_RequirementsTxt(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "requirements.txt"), []byte("FastAPI==0.111\nuvicorn\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := detectFramework(dir)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if got != "fastapi" {
		t.Errorf("want fastapi, got %s", got)
	}
}

func TestDetectFramework_Unknown(t *testing.T) {
	dir := t.TempDir()
	if _, err := detectFramework(dir); err == nil {
		t.Error("expected error for empty dir")
	}
}

func TestApplyBootstrapPlan_WritesNextjsFiles(t *testing.T) {
	dir := t.TempDir()
	plan := planNextjs(dir)
	var sink testWriter
	if err := applyBootstrapPlan(&sink, plan, false); err != nil {
		t.Fatalf("apply: %v", err)
	}
	for _, rel := range []string{"middleware.ts", "app/api/aegis-protected/route.ts", ".env.example"} {
		if _, err := os.Stat(filepath.Join(dir, rel)); err != nil {
			t.Errorf("expected %s to exist: %v", rel, err)
		}
	}
	// Env should include AEGIS_API_KEY
	env, _ := os.ReadFile(filepath.Join(dir, ".env.example"))
	if !strings.Contains(string(env), "AEGIS_API_KEY") {
		t.Error(".env.example missing AEGIS_API_KEY")
	}
	// middleware.ts should import @aegis/sdk directly (so `pnpm install`
	// works without the unpublished adapter-nextjs package — see Round 25
	// supplement audit fix W3) AND should leave a migration-hint comment
	// pointing at the published adapter for when it lands.
	mw, _ := os.ReadFile(filepath.Join(dir, "middleware.ts"))
	mwStr := string(mw)
	if !strings.Contains(mwStr, "from '@aegis/sdk'") {
		t.Error("middleware.ts missing @aegis/sdk import — junior install would fail")
	}
	if !strings.Contains(mwStr, "aegis.verify(token)") {
		t.Error("middleware.ts missing inline verify call — adapter logic is not actually inlined")
	}
	if !strings.Contains(mwStr, "@aegis/adapter-nextjs") {
		t.Error("middleware.ts missing migration-hint comment for the published adapter")
	}
}

func TestApplyBootstrapPlan_RefusesToClobber(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "middleware.ts"), []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := planNextjs(dir)
	var sink testWriter
	err := applyBootstrapPlan(&sink, plan, false)
	if err == nil || !strings.Contains(err.Error(), "refusing to overwrite") {
		t.Errorf("expected refusal error, got: %v", err)
	}
	// Force should clobber.
	if err := applyBootstrapPlan(&sink, plan, true); err != nil {
		t.Errorf("expected force to succeed, got: %v", err)
	}
	mw, _ := os.ReadFile(filepath.Join(dir, "middleware.ts"))
	if string(mw) == "existing" {
		t.Error("force did not clobber middleware.ts")
	}
}

func TestApplyBootstrapPlan_EnvAppendIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	plan := planExpress(dir)
	var sink testWriter
	if err := applyBootstrapPlan(&sink, plan, false); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	first, _ := os.ReadFile(filepath.Join(dir, ".env.example"))
	// Second apply (with --force on files); env should NOT duplicate.
	if err := applyBootstrapPlan(&sink, plan, true); err != nil {
		t.Fatalf("second apply: %v", err)
	}
	second, _ := os.ReadFile(filepath.Join(dir, ".env.example"))
	if string(first) != string(second) {
		t.Errorf(".env.example mutated on second apply (idempotency broken)\nfirst:\n%s\nsecond:\n%s", first, second)
	}
}

func TestBuildBootstrapPlan_UnknownFramework(t *testing.T) {
	if _, err := buildBootstrapPlan("ruby-on-rails", "/tmp"); err == nil {
		t.Error("expected error for unsupported framework")
	}
}

// testWriter is a minimal io.Writer for capturing test output.
type testWriter struct {
	buf []byte
}

func (w *testWriter) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	return len(p), nil
}
