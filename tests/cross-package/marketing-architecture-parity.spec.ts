// Cross-package parity — marketing /architecture page ↔ docs/decisions/
//
// WHY THIS GATE EXISTS
//
// `/architecture` publishes eight curated ADRs to prospects in
// procurement-grade summaries. Each card on the page links to the
// source ADR. If the ADR file on disk gets renamed, retitled, or
// deleted, the page's card-title and "Read the full ADR" link must
// match — otherwise the marketing claim diverges from the source
// decision record and a sophisticated procurement reviewer catches it.
//
// HOW IT WORKS
//
// Imports the `COMMITMENTS` array from the page (exported for this
// spec). For each commitment, asserts:
//   - The corresponding `docs/decisions/<adrSlug>.md` file exists.
//   - The file's first `# ` line (H1 title) matches `adrTitle`.
//   - The label ("ADR-NNNN") matches the numeric prefix of `adrSlug`.
//   - The full procurement structure (oneLine + why + evidence) is
//     populated above minimum lengths.
// And aggregate:
//   - Every theme has at least one commitment (no empty section
//     renders on the page).
//   - No duplicate ADR slugs (one ADR appears at most once).
//
// WHEN ADDING / RENAMING AN ADR
//
//   1. Update the H1 of the ADR file.
//   2. If renaming the file, update `adrSlug` on the page's matching
//      COMMITMENT entry.
//   3. Update `adrTitle` to match the new H1 verbatim.
//   4. This test passes again.
//
// WHEN RETIRING AN ADR (page-side)
//
// Remove the COMMITMENT entry. The ADR file stays on disk (ADRs are
// immutable); the page just stops linking to it from this curated
// procurement view.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMMITMENTS } from '../../apps/marketing/app/architecture/page';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DECISIONS_DIR = join(REPO_ROOT, 'docs', 'decisions');

/** Extract the first `# ` H1 from a markdown file. */
function firstH1(md: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1]!.trim() : '';
}

describe('marketing /architecture ↔ docs/decisions/ parity', () => {
  it('every commitment slug resolves to an ADR file on disk', () => {
    for (const c of COMMITMENTS) {
      const filePath = join(DECISIONS_DIR, `${c.adrSlug}.md`);
      expect(
        existsSync(filePath),
        `Architecture page references docs/decisions/${c.adrSlug}.md but the file does not exist on disk`,
      ).toBe(true);
    }
  });

  it("every commitment's adrTitle matches the ADR file's first H1 verbatim", () => {
    for (const c of COMMITMENTS) {
      const filePath = join(DECISIONS_DIR, `${c.adrSlug}.md`);
      const md = readFileSync(filePath, 'utf-8');
      const h1 = firstH1(md);
      expect(
        h1,
        `Architecture page claims adrTitle="${c.adrTitle}" but ${c.adrSlug}.md starts with H1="${h1}"`,
      ).toBe(c.adrTitle);
    }
  });

  it("every commitment's label matches the numeric prefix of its slug", () => {
    for (const c of COMMITMENTS) {
      // adrSlug starts with "0002-..." → label must be "ADR-0002"
      const m = /^(\d{4})-/.exec(c.adrSlug);
      expect(m, `adrSlug "${c.adrSlug}" must start with a 4-digit number`).toBeTruthy();
      const expectedLabel = `ADR-${m![1]}`;
      expect(c.label).toBe(expectedLabel);
    }
  });

  it('every commitment renders the full procurement structure', () => {
    for (const c of COMMITMENTS) {
      // Tight minimums — these are tighter than /principles because the
      // architecture page invites a deeper procurement read; under-length
      // cards weaken the commitment.
      expect(c.oneLine.length, `${c.adrSlug} oneLine`).toBeGreaterThan(30);
      expect(c.why.length, `${c.adrSlug} why`).toBeGreaterThan(120);
      expect(c.evidence.length, `${c.adrSlug} evidence`).toBeGreaterThan(20);
    }
  });

  it('no duplicate slugs', () => {
    const slugs = COMMITMENTS.map((c) => c.adrSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every theme has at least one commitment (no empty sections render)', () => {
    const themes = new Set(COMMITMENTS.map((c) => c.theme));
    // The three themes the page renders sections for:
    expect(themes.has('cryptographic-foundation')).toBe(true);
    expect(themes.has('verifiability')).toBe(true);
    expect(themes.has('neutrality')).toBe(true);
  });
});
