package cmd

// `aegis bootstrap <framework>` — Round 25 Lane B.
//
// Distinct from `aegis init` (which scaffolds a new project from an
// industry template). `bootstrap` ADDS AEGIS to an EXISTING project:
// detects the framework, drops in middleware/handler boilerplate,
// patches `.env.example` with the keys we need, and prints a README
// addendum the operator can copy into their own docs.
//
// Frameworks supported in 0.1:
//   - nextjs   (auto-detect: next.config.{js,ts,mjs} or `next` dep in package.json)
//   - express  (auto-detect: `express` dep in package.json)
//   - fastapi  (auto-detect: `fastapi` dep in pyproject.toml or requirements.txt)
//
// Flags:
//   --framework <name>   override auto-detection
//   --dir <path>         target directory (default: cwd)
//   --dry-run            print the plan without writing files
//   --yes                skip the confirmation prompt
//
// Refuses to overwrite existing files unless --force is set; this is
// the same posture as `aegis init`.

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

func init() {
	bootstrapCmd.Flags().StringP("framework", "f", "",
		"framework to bootstrap (nextjs | express | fastapi); auto-detect when omitted")
	bootstrapCmd.Flags().StringP("dir", "d", ".",
		"target directory (default: current working directory)")
	bootstrapCmd.Flags().Bool("dry-run", false,
		"print the plan without writing any files")
	bootstrapCmd.Flags().Bool("yes", false,
		"skip the interactive confirmation prompt")
	bootstrapCmd.Flags().Bool("force", false,
		"overwrite existing files (off by default — refuses to clobber)")
	rootCmd.AddCommand(bootstrapCmd)
}

var bootstrapCmd = &cobra.Command{
	Use:   "bootstrap",
	Short: "Add AEGIS verification to an existing project",
	Long: `Add AEGIS verification to an existing Next.js / Express / FastAPI project.

Unlike 'aegis init' (which scaffolds a fresh project from a vertical
template), 'bootstrap' detects the framework of the current project and
drops in the smallest possible integration: middleware/handler, .env
entries, and a README addendum.

Examples:
  aegis bootstrap                      # auto-detect framework in cwd
  aegis bootstrap --framework nextjs   # force Next.js bootstrap
  aegis bootstrap --dir ./checkout-svc # bootstrap into a sibling project
  aegis bootstrap --dry-run            # preview the plan without writing
`,
	RunE: runBootstrap,
}

func runBootstrap(cmd *cobra.Command, args []string) error {
	dir, _ := cmd.Flags().GetString("dir")
	framework, _ := cmd.Flags().GetString("framework")
	dryRun, _ := cmd.Flags().GetBool("dry-run")
	yes, _ := cmd.Flags().GetBool("yes")
	force, _ := cmd.Flags().GetBool("force")

	abs, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("resolve --dir: %w", err)
	}
	if _, err := os.Stat(abs); err != nil {
		return fmt.Errorf("target dir not accessible: %w", err)
	}

	if framework == "" {
		detected, err := detectFramework(abs)
		if err != nil {
			return err
		}
		framework = detected
	}

	plan, err := buildBootstrapPlan(framework, abs)
	if err != nil {
		return err
	}

	out := cmd.OutOrStdout()
	printPlan(out, plan)

	if dryRun {
		fmt.Fprintln(out, "\n(dry-run — no files written)")
		return nil
	}

	if !yes {
		fmt.Fprint(out, "\nProceed? [y/N]: ")
		var answer string
		if _, err := fmt.Fscanln(cmd.InOrStdin(), &answer); err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("read confirmation: %w", err)
		}
		if !isYes(answer) {
			fmt.Fprintln(out, "Aborted.")
			return nil
		}
	}

	return applyBootstrapPlan(out, plan, force)
}

// ── Detection ────────────────────────────────────────────────────────────────

// detectFramework inspects the target dir for canonical markers and returns
// the first match. Returns an error when no framework is recognized so the
// operator can re-run with explicit --framework.
func detectFramework(dir string) (string, error) {
	if hasAnyFile(dir, "next.config.js", "next.config.ts", "next.config.mjs") {
		return "nextjs", nil
	}
	if pkg := readPackageJson(dir); pkg != "" {
		if strings.Contains(pkg, `"next"`) {
			return "nextjs", nil
		}
		if strings.Contains(pkg, `"express"`) {
			return "express", nil
		}
	}
	if py := readPyProject(dir); py != "" && strings.Contains(py, "fastapi") {
		return "fastapi", nil
	}
	if req := readFile(filepath.Join(dir, "requirements.txt")); req != "" &&
		strings.Contains(strings.ToLower(req), "fastapi") {
		return "fastapi", nil
	}
	return "", errors.New("could not auto-detect framework — re-run with --framework nextjs|express|fastapi")
}

func hasAnyFile(dir string, names ...string) bool {
	for _, n := range names {
		if _, err := os.Stat(filepath.Join(dir, n)); err == nil {
			return true
		}
	}
	return false
}

func readPackageJson(dir string) string {
	return readFile(filepath.Join(dir, "package.json"))
}

func readPyProject(dir string) string {
	return readFile(filepath.Join(dir, "pyproject.toml"))
}

func readFile(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

// ── Plan + apply ─────────────────────────────────────────────────────────────

// bootstrapFile is one file to create.
type bootstrapFile struct {
	relPath  string
	contents string
}

// bootstrapPlan is the set of files + env additions for one framework
// + the README addendum text shown after writing.
type bootstrapPlan struct {
	framework string
	dir       string
	files     []bootstrapFile
	// envAdditions is appended to `.env.example` (created if missing).
	envAdditions string
	// readmeAddendum is printed to stdout; not written automatically because
	// operators have strong opinions about their own READMEs.
	readmeAddendum string
}

func buildBootstrapPlan(framework, dir string) (*bootstrapPlan, error) {
	switch framework {
	case "nextjs":
		return planNextjs(dir), nil
	case "express":
		return planExpress(dir), nil
	case "fastapi":
		return planFastapi(dir), nil
	default:
		return nil, fmt.Errorf("unsupported framework %q — supported: nextjs, express, fastapi", framework)
	}
}

func printPlan(out io.Writer, plan *bootstrapPlan) {
	fmt.Fprintf(out, "Bootstrap plan for %s @ %s\n", plan.framework, plan.dir)
	fmt.Fprintln(out, "")
	fmt.Fprintln(out, "Files to write:")
	for _, f := range plan.files {
		fmt.Fprintf(out, "  + %s\n", f.relPath)
	}
	if plan.envAdditions != "" {
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "Env additions (.env.example):")
		for line := range strings.SplitSeq(strings.TrimRight(plan.envAdditions, "\n"), "\n") {
			fmt.Fprintf(out, "  %s\n", line)
		}
	}
}

func applyBootstrapPlan(out io.Writer, plan *bootstrapPlan, force bool) error {
	for _, f := range plan.files {
		full := filepath.Join(plan.dir, f.relPath)
		if !force {
			if _, err := os.Stat(full); err == nil {
				return fmt.Errorf("refusing to overwrite %s (pass --force to clobber)", full)
			}
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", filepath.Dir(full), err)
		}
		if err := os.WriteFile(full, []byte(f.contents), 0o644); err != nil {
			return fmt.Errorf("write %s: %w", full, err)
		}
		fmt.Fprintf(out, "wrote %s\n", full)
	}
	if plan.envAdditions != "" {
		envPath := filepath.Join(plan.dir, ".env.example")
		existing := readFile(envPath)
		if !strings.Contains(existing, "AEGIS_API_KEY") {
			fh, err := os.OpenFile(envPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err != nil {
				return fmt.Errorf("open %s: %w", envPath, err)
			}
			defer fh.Close()
			if existing != "" && !strings.HasSuffix(existing, "\n") {
				if _, err := fh.WriteString("\n"); err != nil {
					return err
				}
			}
			if _, err := fh.WriteString(plan.envAdditions); err != nil {
				return fmt.Errorf("append env: %w", err)
			}
			fmt.Fprintf(out, "appended AEGIS env keys to %s\n", envPath)
		} else {
			fmt.Fprintf(out, "skipped %s (already contains AEGIS_API_KEY)\n", envPath)
		}
	}
	if plan.readmeAddendum != "" {
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "README addendum (copy into your README.md when ready):")
		fmt.Fprintln(out, strings.Repeat("─", 60))
		fmt.Fprint(out, plan.readmeAddendum)
		fmt.Fprintln(out, strings.Repeat("─", 60))
	}
	return nil
}

func isYes(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "y" || s == "yes"
}

// ── Per-framework plans ──────────────────────────────────────────────────────

func planNextjs(dir string) *bootstrapPlan {
	return &bootstrapPlan{
		framework: "nextjs",
		dir:       dir,
		files: []bootstrapFile{
			{relPath: "middleware.ts", contents: nextjsMiddlewareTemplate},
			{relPath: "app/api/aegis-protected/route.ts", contents: nextjsRouteTemplate},
		},
		envAdditions: aegisEnvAdditions,
		readmeAddendum: `## AEGIS verification

This project gates ` + "`/api/aegis-protected/*`" + ` routes via inline AEGIS
verification (see ` + "`middleware.ts`" + `). Install the SDK:

    pnpm add @aegis/sdk

Then set ` + "`AEGIS_API_KEY`" + ` in your environment (see ` + "`.env.example`" + `).

Once ` + "`@aegis/adapter-nextjs`" + ` is published to your npm registry, you can
swap the inline middleware for the published adapter — see the comment
header at the top of ` + "`middleware.ts`" + ` for the one-line replacement.
`,
	}
}

func planExpress(dir string) *bootstrapPlan {
	return &bootstrapPlan{
		framework: "express",
		dir:       dir,
		files: []bootstrapFile{
			{relPath: "src/aegis-middleware.ts", contents: expressMiddlewareTemplate},
		},
		envAdditions: aegisEnvAdditions,
		readmeAddendum: `## AEGIS verification

This project ships ` + "`src/aegis-middleware.ts`" + ` — register it on the
routes that require an AEGIS-verified caller:

    import { aegisMiddleware } from './aegis-middleware';
    app.use('/api/protected', aegisMiddleware({ minTrustBand: 'VERIFIED' }));

Install the SDK:

    pnpm add @aegis/sdk

Then set ` + "`AEGIS_API_KEY`" + ` in your environment (see ` + "`.env.example`" + `).
`,
	}
}

func planFastapi(dir string) *bootstrapPlan {
	return &bootstrapPlan{
		framework: "fastapi",
		dir:       dir,
		files: []bootstrapFile{
			{relPath: "aegis_middleware.py", contents: fastapiMiddlewareTemplate},
		},
		envAdditions: aegisEnvAdditions,
		readmeAddendum: `## AEGIS verification

This project ships ` + "`aegis_middleware.py`" + ` — install the SDK and
wire the dependency into protected routes:

    pip install aegis

    from fastapi import FastAPI, Depends
    from aegis_middleware import aegis_required

    app = FastAPI()

    @app.post("/api/protected", dependencies=[Depends(aegis_required)])
    async def protected():
        return {"ok": True}

Then set ` + "`AEGIS_API_KEY`" + ` in your environment (see ` + "`.env.example`" + `).
`,
	}
}

// ── Template strings ─────────────────────────────────────────────────────────

const aegisEnvAdditions = `# AEGIS — Round 25 bootstrap
AEGIS_API_KEY=
# Optional: pin to a specific region (us|eu|apac|auto). Default is auto.
# AEGIS_REGION=auto
# Optional: override the AEGIS endpoint (self-hosted deployments).
# AEGIS_API_URL=https://api.aegislabs.io
`

const nextjsMiddlewareTemplate = `// AEGIS-gated middleware. Generated by ` + "`aegis bootstrap`" + ` (Round 25).
// Edit freely — this is your code now.
//
// NOTE: This file inlines the AEGIS verification logic so ` + "`pnpm install`" + ` works
// against the standard @aegis/sdk package alone. Once @aegis/adapter-nextjs
// is published, you can simplify this file to:
//
//   import { aegisMiddleware } from '@aegis/adapter-nextjs/middleware';
//   export default aegisMiddleware({ minTrustBand: 'VERIFIED', protectedPaths: ['/api/aegis-protected/'] });
//   export const config = { matcher: ['/api/aegis-protected/:path*'] };
//
// Runs on the Vercel Edge runtime (no Node-only deps; @aegis/sdk uses
// @noble/ed25519 which is edge-safe everywhere).

import { Aegis, type VerifyResult } from '@aegis/sdk';

const TRUST_RANK: Record<string, number> = { FLAGGED: 0, WATCH: 1, VERIFIED: 2, PLATINUM: 3 };
const MIN_TRUST_BAND: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM' = 'VERIFIED';
const TOKEN_HEADER = 'X-AEGIS-Token';

const aegis = new Aegis();

function denial(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: code, message, statusCode: status }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

export default async function middleware(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/aegis-protected/')) return undefined;

  const token = req.headers.get(TOKEN_HEADER);
  if (!token) return denial(401, 'auth_required', ` + "`Missing ${TOKEN_HEADER} header.`" + `);

  let verify: VerifyResult;
  try {
    verify = await aegis.verify(token);
  } catch (err) {
    return denial(502, 'service_unavailable', err instanceof Error ? err.message : 'AEGIS verify failed.');
  }
  if (!verify.valid || !verify.agentId) {
    return denial(403, 'forbidden', ` + "`AEGIS denied: ${verify.denialReason ?? 'unknown'}`" + `);
  }
  if ((TRUST_RANK[verify.trustBand ?? 'FLAGGED'] ?? 0) < TRUST_RANK[MIN_TRUST_BAND]!) {
    return denial(403, 'trust_score_too_low', ` + "`Trust band ${verify.trustBand} below required ${MIN_TRUST_BAND}.`" + `);
  }
  return undefined; // passthrough
}

export const config = {
  matcher: ['/api/aegis-protected/:path*'],
};
`

const nextjsRouteTemplate = `// Sample protected route. The middleware above gates this path; the
// handler can read the AEGIS identity from forwarded headers (or
// re-verify here if you want defense-in-depth on the route level).
//
// NOTE: this file uses the @aegis/sdk verify call directly. Once
// @aegis/adapter-nextjs is published, you can simplify to:
//
//   import { withAegis } from '@aegis/adapter-nextjs';
//   export const POST = withAegis(async (req, ctx) => { ... }, { minTrustBand: 'VERIFIED' });

import { Aegis } from '@aegis/sdk';

const aegis = new Aegis();

export async function POST(req: Request): Promise<Response> {
  const token = req.headers.get('X-AEGIS-Token');
  if (!token) {
    return Response.json({ error: 'auth_required', message: 'Missing X-AEGIS-Token' }, { status: 401 });
  }
  const verify = await aegis.verify(token);
  if (!verify.valid || !verify.agentId) {
    return Response.json(
      { error: 'forbidden', message: ` + "`AEGIS denied: ${verify.denialReason}`" + ` },
      { status: 403 },
    );
  }
  return Response.json({
    message: 'AEGIS verified you',
    agentId: verify.agentId,
    principalId: verify.principalId,
    trustBand: verify.trustBand,
  });
}
`

const expressMiddlewareTemplate = `// AEGIS-gated Express middleware. Generated by ` + "`aegis bootstrap`" + ` (Round 25).
//
// Wire it onto protected routes:
//   import { aegisMiddleware } from './aegis-middleware';
//   app.use('/api/protected', aegisMiddleware({ minTrustBand: 'VERIFIED' }));
import { Aegis, type VerifyResult } from '@aegis/sdk';
import type { Request, Response, NextFunction } from 'express';

interface Options {
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
  tokenHeader?: string;
}

const RANK: Record<string, number> = { FLAGGED: 0, WATCH: 1, VERIFIED: 2, PLATINUM: 3 };

const client = new Aegis();

export function aegisMiddleware(opts: Options = {}) {
  const tokenHeader = (opts.tokenHeader ?? 'X-AEGIS-Token').toLowerCase();
  const min = opts.minTrustBand;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.headers[tokenHeader] as string | undefined;
    if (!token) {
      res.status(401).json({ error: 'auth_required', message: 'Missing AEGIS token.' });
      return;
    }
    let v: VerifyResult;
    try {
      v = await client.verify(token);
    } catch (err) {
      res.status(502).json({ error: 'service_unavailable', message: (err as Error).message });
      return;
    }
    if (!v.valid || !v.agentId || !v.principalId) {
      res.status(403).json({ error: 'forbidden', message: 'AEGIS denied: ' + (v.denialReason ?? 'unknown') });
      return;
    }
    if (min && (RANK[v.trustBand ?? 'FLAGGED'] ?? 0) < (RANK[min] ?? 0)) {
      res.status(403).json({ error: 'trust_score_too_low', message: 'Trust band below required ' + min });
      return;
    }
    // Attach the verified identity for downstream handlers.
    (req as Request & { aegis?: VerifyResult }).aegis = v;
    next();
  };
}
`

const fastapiMiddlewareTemplate = `"""AEGIS dependency for FastAPI. Generated by ` + "`aegis bootstrap`" + ` (Round 25).

Usage:

    from fastapi import FastAPI, Depends
    from aegis_middleware import aegis_required

    app = FastAPI()

    @app.post("/api/protected", dependencies=[Depends(aegis_required("VERIFIED"))])
    async def protected():
        return {"ok": True}
"""
from __future__ import annotations

import os
from typing import Literal

from fastapi import Header, HTTPException, status
from aegis import AsyncAegis

TrustBand = Literal["FLAGGED", "WATCH", "VERIFIED", "PLATINUM"]
RANK = {"FLAGGED": 0, "WATCH": 1, "VERIFIED": 2, "PLATINUM": 3}

_client: AsyncAegis | None = None


def _get_client() -> AsyncAegis:
    global _client
    if _client is None:
        _client = AsyncAegis(api_key=os.environ["AEGIS_API_KEY"])
    return _client


def aegis_required(min_trust_band: TrustBand | None = None):
    """FastAPI dependency factory. Pass ` + "`Depends(aegis_required('VERIFIED'))`" + ` on a route."""

    async def _dep(x_aegis_token: str | None = Header(default=None)) -> dict:
        if not x_aegis_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error": "auth_required", "message": "Missing X-AEGIS-Token header."},
            )
        try:
            result = await _get_client().verify(x_aegis_token)
        except Exception as exc:  # noqa: BLE001 — preserve original message for ops
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": "service_unavailable", "message": str(exc)},
            ) from exc
        if not result.valid or not result.agent_id or not result.principal_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "forbidden", "message": f"AEGIS denied: {result.denial_reason}"},
            )
        if min_trust_band is not None and RANK.get(result.trust_band or "FLAGGED", 0) < RANK[min_trust_band]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "trust_score_too_low", "message": f"Trust band below required {min_trust_band}"},
            )
        return {
            "agent_id": result.agent_id,
            "principal_id": result.principal_id,
            "trust_band": result.trust_band,
        }

    return _dep
`
