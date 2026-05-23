# KLYTICS Audit Discipline (mirror)

> Cross-product engineering canon for KLYTICS LLC products. This file is a thin pointer for in-repo discoverability — it does NOT define the discipline; the canonical doc does.

Classification: **KLYTICS RESTRICTED**.

## Canonical location

- **Repo**: `KLYTICS/cerniq` (private GitHub)
- **Path**: `docs/platform/KLYTICS_AUDIT_DISCIPLINE.md`
- **As-of commit**: `96d68cd2` on branch `claude/enterprise-quality-hardening` (2026-05-15). This SHA will move when the branch merges to main (rebase/squash); re-resolve via `git log --diff-filter=A -- docs/platform/KLYTICS_AUDIT_DISCIPLINE.md` if the reference rots.

When in doubt about a Rule N citation, read the canonical file — this mirror lists rule *titles* only, not normative text.

## Why this file exists in AEGIS

The canon lives in cerniq because cerniq had the largest existing audit-discipline scaffolding (DataGap, ReportArtifact, Model Registry, Golden tests) at the time of the 2026-05-15 audit. **AEGIS is the reference implementation** for Rules 3, 4, 5, 6, and 7 — its `@aegis/audit-verifier` package, append-only signed `AuditEvent` chain, canonical-JSON parity tests (`packages/audit-verifier/src/canonical.ts` + `tests/cross-package/audit-manifest-parity.spec.ts`), and `principalId` tenancy boundary are cited by name in the canon.

This mirror surfaces the canon inside AEGIS's tree so Claude sessions landing here see "this is bigger than AEGIS — these rules apply to four products" without having to walk other repos.

## The 12 rules (titles only — canon §1 has normative text + adoption checklists)

1. **No silent zeros** — typed marker over `0`, `NaN`, empty arrays, hardcoded fallbacks
2. **Structured gap manifests on regulator-bound artifacts**
3. **Immutable artifacts with SHA-256 + lineage**
4. **Append-only audit trail**
5. **Canonical JSON for signing and hashing**
6. **Tenant isolation at every layer** (app + DB)
7. **Lineage in regulator-bound outputs** (model versions, dataset versions, prompt fingerprints, snapshot timestamps)
8. **Golden tests with drift detection** (manual update IS the gate)
9. **Cost and prompt provenance on every LLM call**
10. **Append-only migrations after merge**
11. **No `any` without `// type-rationale:` comment**
12. **Cryptographic randomness in security/audit/billing paths**

## AEGIS's maturity (canon §3, as of 2026-05-15)

**11/11 — reference implementation.** Every rule is implemented and grades ✅ in the matrix. AEGIS is the model other products converge toward, not the other way around.

Notable AEGIS-canonical implementations cited in the canon:

- Rule 3 (immutable artifacts): `SignedAuditCompressionManifest` with Ed25519 over canonical JSON (`packages/audit-verifier/src/manifest.ts`)
- Rule 4 (append-only audit): `AuditEvent` hash-chained, Ed25519-signed (CLAUDE.md invariant #3)
- Rule 5 (canonical JSON): `canonicalize()` in `@aegis/audit-verifier`; cross-package parity test (`tests/cross-package/audit-manifest-parity.spec.ts`)
- Rule 6 (tenant isolation): `principalId` boundary all the way through Prisma + cache keys + queues + webhooks (CLAUDE.md invariant #5)
- Rule 7 (lineage): `signingKeyId` committed to signed manifest bytes; `payloadVersionMin/Max` recorded per manifest
- Rule 11 (`any` discipline): enforced via `eslint-config`
- Rule 12 (crypto randomness): enforced via quality bar in CLAUDE.md

Rule 9 is marked `—` (not applicable) because AEGIS has no LLM-using audit-relevant paths today. If/when that changes (e.g., an AI-assisted reviewer for verify decisions), this row promotes from `—` to `❌` and Rule 9 adoption begins.

## When AEGIS's quality bar (`CLAUDE.md` §"Quality bar") conflicts with this doc

For cross-cutting governance (the 12 rules), the canon wins. For AEGIS-specific implementation choices (denial precedence order, Ed25519 vs alternative curves, hot-path portability), CLAUDE.md wins. Most rules in this doc are already encoded in AEGIS's CLAUDE.md quality bar — they pre-date the canon and informed it.

## How to update

1. Edit `cerniq:docs/platform/KLYTICS_AUDIT_DISCIPLINE.md` (the canon).
2. If a rule changes, update the maturity matrix in canon §3 for all four products in the same PR.
3. PR with a cross-product reviewer if normative text changes (i.e., a rule's "Normative:" line).
4. Bump the as-of commit SHA in each mirror file (this one, ComplianceKit's, apex's) once the canon PR merges to cerniq main.

## Reading order suggestion when this mirror is in scope

Per AEGIS's `CLAUDE.md` §"When in doubt", read order is: root CLAUDE.md → scoped CLAUDE.md → SERVICE_MAP → ARCHITECTURE → SECURITY → TECHNICAL_SPEC → schema.prisma. **This mirror slots in around position 4** — alongside ARCHITECTURE — because it is governance-shaped (defines invariants across products) rather than AEGIS-specific design.
