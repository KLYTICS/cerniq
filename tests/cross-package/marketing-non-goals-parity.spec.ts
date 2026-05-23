// Cross-package parity — marketing /principles page ↔ docs/NON_GOALS.md
//
// WHY THIS GATE EXISTS
//
// `/principles` publishes AEGIS's refuse-to-build list to prospects in
// procurement-grade language. `docs/NON_GOALS.md` is the engineering source
// of truth — it owns the full reasoning, the rejected alternatives, and the
// escape-hatch retirement procedure. Both surfaces must agree on the SET of
// customer-facing refusals or the wedge bleeds from documentation drift.
//
// The marketing page is allowed to *rephrase* refusals in buyer-friendly
// language (e.g., "Customer-tunable behavioral trust weights" on the page
// vs. "Customer-tunable BATE weights" in the doc). What is NOT allowed is
// for a refusal to appear on one surface and disappear from the other —
// that's the silent-drift failure mode this spec catches.
//
// HOW IT WORKS
//
// Imports the `REFUSALS` array from the marketing /principles page and
// extracts every `### X.Y — ...` heading from docs/NON_GOALS.md. Compares
// the SET of section numbers, filtered to customer-facing sections only
// (§ 1.x product surfaces and § 3.x positioning). Internal-operations
// refusals (§ 2.x — dashboard features, Stripe-side config) are
// deliberately excluded from the page and from this gate; they evolve
// freely in the doc.
//
// WHEN ADDING A REFUSAL
//
// Either side first is fine — the other side fails this spec until both
// are updated. Recommended order:
//
//   1. Add the refusal to docs/NON_GOALS.md with the four-part structure
//      (What / Why refused / Tempting moment / Escape hatch).
//   2. Add a corresponding entry to the REFUSALS array in
//      apps/marketing/app/principles/page.tsx, picking a stable `slug`
//      and a buyer-friendly `title` and `oneLine`.
//   3. Cross-reference the new refusal from any ADR or design doc that
//      motivated it.
//
// WHEN RETIRING A REFUSAL
//
// Per docs/NON_GOALS.md § 5: the refusal moves to a "## Retired" section
// at the bottom of the doc rather than being deleted. The page must also
// drop the entry from REFUSALS in the same change. The test asserts only
// against ACTIVE refusals (headings under §§ 1, 2, 3 of the doc), so
// retired entries don't trip this gate.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REFUSALS } from '../../apps/marketing/app/principles/page';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const NON_GOALS_PATH = join(REPO_ROOT, 'docs', 'NON_GOALS.md');

/**
 * Parse all active refusal headings from docs/NON_GOALS.md.
 *
 * Headings match `### X.Y — title` under any of §§ 1, 2, 3 (the active
 * sections). Headings under a `## Retired` section are excluded.
 */
function parseDocRefusalSections(md: string): readonly string[] {
  // Stop at "## Retired" if present — those are no longer active.
  const activeRegion = md.split(/^## Retired\b/m)[0]!;

  const result: string[] = [];
  // Match "### 1.1 — Title" or "### 1.1 - Title" (em-dash or hyphen).
  const re = /^###\s+(\d+\.\d+)\s+[—-]\s+/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(activeRegion)) !== null) {
    result.push(m[1]!);
  }
  return result;
}

const CUSTOMER_FACING_PREFIXES = ['1.', '3.'] as const;

function isCustomerFacing(section: string): boolean {
  return CUSTOMER_FACING_PREFIXES.some((p) => section.startsWith(p));
}

describe('marketing /principles ↔ docs/NON_GOALS.md parity', () => {
  it('every customer-facing refusal in the doc appears on the page (by section number)', () => {
    const docMd = readFileSync(NON_GOALS_PATH, 'utf-8');
    const docSections = parseDocRefusalSections(docMd);
    const docCustomerFacing = docSections.filter(isCustomerFacing).sort();

    const pageSections = REFUSALS.map((r) => r.section).sort();

    expect(pageSections).toEqual(docCustomerFacing);
  });

  it('every refusal on the page corresponds to a doc heading (no phantom page entries)', () => {
    const docMd = readFileSync(NON_GOALS_PATH, 'utf-8');
    const docSections = new Set(parseDocRefusalSections(docMd));

    for (const r of REFUSALS) {
      expect(
        docSections.has(r.section),
        `Page refusal "${r.title}" (§ ${r.section}) has no matching ### heading in docs/NON_GOALS.md`,
      ).toBe(true);
    }
  });

  it('every page refusal has a stable, non-empty slug', () => {
    // Slugs are the parity anchor for cross-references (other docs, ADRs,
    // future deep-links to /principles#<slug>). They must be stable and
    // URL-safe; rephrasing the buyer-friendly title must NOT touch the slug.
    const slugs = REFUSALS.map((r) => r.slug);
    for (const s of slugs) {
      expect(s).toMatch(/^[a-z0-9-]+$/);
      expect(s.length).toBeGreaterThan(0);
    }
    // No duplicate slugs.
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every page refusal renders the four-part structure (oneLine, whyRefused, tempting, escape)', () => {
    // The four-part structure is the procurement-grade contract.
    // A refusal missing any part would render half-empty cards and
    // weaken the public commitment.
    for (const r of REFUSALS) {
      expect(r.oneLine.length, `${r.slug} oneLine`).toBeGreaterThan(10);
      expect(r.whyRefused.length, `${r.slug} whyRefused`).toBeGreaterThan(40);
      expect(r.tempting.length, `${r.slug} tempting`).toBeGreaterThan(40);
      expect(r.escape.length, `${r.slug} escape`).toBeGreaterThan(20);
    }
  });
});
