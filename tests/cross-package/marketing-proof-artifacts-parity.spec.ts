// Cross-package parity — marketing /proof page ↔ live API routes + packages
//
// WHY THIS GATE EXISTS
//
// `/proof` is the highest-stakes marketing surface. Every other page can
// be aspirational ("we plan to support X"); /proof's whole point is
// "fetch this thing yourself." A 404 on a /proof link evaporates the
// entire trust loop the marketing surface is built around. This spec
// asserts each artifact resolves to something real BEFORE the page can
// ship to a customer.
//
// HOW IT WORKS
//
// Imports `PROOF_ARTIFACTS` from the page (exported for this spec).
// For each artifact:
//
//   - If `routePath` is set: greps the API's wellknown.controller.ts
//     for a matching `@Get('<routePath>')` decorator. Asserts the
//     route is wired. (Does not hit the live URL — that would couple
//     CI to network state; the route definition is the source of
//     truth at build time.)
//
//   - If `packagePath` is set: asserts the package.json exists at the
//     workspace path AND that the package is not `"private": true`
//     (private packages cannot be installed by a third party, so they
//     do not satisfy the "fetch it yourself" property).
//
//   - The source-repo artifact (kind=source) has neither routePath
//     nor packagePath — its href is the public GitHub URL, trusted.
//
// Aggregate assertions:
//
//   - No duplicate slugs.
//   - Each kind that the page renders a section for (discovery,
//     pricing, library, source) has at least one artifact — no empty
//     sections.
//   - Each artifact has the four-part structure (oneLine + whatItProves
//     + href + label) above minimum lengths.
//
// WHEN ADDING AN ARTIFACT
//
//   1. If a well-known endpoint: ship the @Get in wellknown.controller.ts
//      first, then add the matching PROOF_ARTIFACTS entry with the same
//      routePath.
//   2. If a library: ensure the package.json exists and is not
//      `"private": true`, then add the entry.
//   3. If a third-party-fetched URL: leave routePath and packagePath
//      undefined and trust the external href.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROOF_ARTIFACTS } from '../../apps/marketing/app/proof/page';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const WELLKNOWN_CONTROLLER = join(
  REPO_ROOT,
  'apps',
  'api',
  'src',
  'modules',
  'wellknown',
  'wellknown.controller.ts',
);

describe('marketing /proof ↔ live API routes + workspace packages parity', () => {
  it('every artifact with routePath maps to a @Get decorator on wellknown.controller.ts', () => {
    const controllerSrc = readFileSync(WELLKNOWN_CONTROLLER, 'utf-8');
    for (const a of PROOF_ARTIFACTS) {
      if (a.routePath === undefined) continue;
      // Match @Get('foo') or @Get("foo") with optional whitespace.
      const re = new RegExp(`@Get\\(\\s*['"]${escapeRe(a.routePath)}['"]\\s*\\)`);
      expect(
        re.test(controllerSrc),
        `Proof artifact "${a.slug}" claims routePath="${a.routePath}" but no @Get('${a.routePath}') is defined in wellknown.controller.ts`,
      ).toBe(true);
    }
  });

  it('every artifact with packagePath has a non-private package.json on disk', () => {
    for (const a of PROOF_ARTIFACTS) {
      if (a.packagePath === undefined) continue;
      const pkgJsonPath = join(REPO_ROOT, a.packagePath, 'package.json');
      expect(
        existsSync(pkgJsonPath),
        `Proof artifact "${a.slug}" claims packagePath="${a.packagePath}" but ${pkgJsonPath} does not exist`,
      ).toBe(true);
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { private?: boolean; name?: string };
      expect(
        pkg.private === true,
        `Proof artifact "${a.slug}" points at a private package (${pkg.name ?? a.packagePath}). Private packages cannot be installed by a third party, so they do not satisfy the "fetch it yourself" property.`,
      ).toBe(false);
    }
  });

  it('no duplicate slugs', () => {
    const slugs = PROOF_ARTIFACTS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every kind rendered by the page has at least one artifact (no empty sections)', () => {
    const kinds = new Set(PROOF_ARTIFACTS.map((a) => a.kind));
    expect(kinds.has('discovery')).toBe(true);
    expect(kinds.has('pricing')).toBe(true);
    expect(kinds.has('library')).toBe(true);
    expect(kinds.has('source')).toBe(true);
  });

  it('every artifact renders the four-part structure above minimum lengths', () => {
    for (const a of PROOF_ARTIFACTS) {
      expect(a.label.length, `${a.slug} label`).toBeGreaterThan(3);
      expect(a.oneLine.length, `${a.slug} oneLine`).toBeGreaterThan(30);
      expect(a.whatItProves.length, `${a.slug} whatItProves`).toBeGreaterThan(80);
      expect(a.href.length, `${a.slug} href`).toBeGreaterThan(10);
      // Hrefs must be absolute URLs (https or http) — relative paths
      // can never satisfy "fetch it yourself."
      expect(a.href).toMatch(/^https?:\/\//);
    }
  });

  it('every discovery artifact has a routePath set (cannot be href-only)', () => {
    // Defensive: a "discovery" artifact without a routePath would skip
    // the route-existence gate and could ship a 404. The kind itself
    // signals that the artifact is a well-known endpoint we serve.
    for (const a of PROOF_ARTIFACTS) {
      if (a.kind !== 'discovery' && a.kind !== 'pricing') continue;
      expect(
        a.routePath,
        `Artifact "${a.slug}" (kind=${a.kind}) must declare routePath so the @Get parity gate runs`,
      ).toBeDefined();
    }
  });

  it('every library artifact has a packagePath set (cannot be href-only)', () => {
    // Mirror of the discovery rule. A "library" artifact without a
    // packagePath would skip the package.json existence + non-private
    // check and could ship a broken npm reference.
    for (const a of PROOF_ARTIFACTS) {
      if (a.kind !== 'library') continue;
      expect(
        a.packagePath,
        `Artifact "${a.slug}" (kind=library) must declare packagePath so the package.json parity gate runs`,
      ).toBeDefined();
    }
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
