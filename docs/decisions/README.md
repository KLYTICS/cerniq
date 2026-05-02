# Architecture Decision Records

> One ADR per significant decision. Numbered sequentially. Markdown.

Adapted from Michael Nygard's lightweight ADR template + Spotify's
practice of writing the ADR *after* the decision is made (so we
document what we did, not what we hoped to do).

## When to write one

- A decision affects a public API or wire format.
- A decision sets a default that's hard to revisit (a curve, a
  monorepo layout, a database engine).
- A reviewer asked "why did you pick X?" and the answer wasn't
  obvious from the code.
- A decision is taken under time pressure and we want to record
  why so a future engineer doesn't unwind it without context.

## How to write one

1. Copy `0000-template.md` to `NNNN-<short-kebab>.md` with the next
   sequential ID.
2. Fill in. Aim for one page. Be brief about context, sharp about
   the decision, honest about trade-offs.
3. Update the index below.
4. Open a PR labelled `adr`.

## Status lifecycle

- **proposed** — under discussion, may change
- **accepted** — in force, do not deviate without writing a successor
- **superseded by ADR-NNNN** — kept as historical record; the
  successor explains the new direction

## Index

| ID  | Title                                                | Status   |
| --- | ---------------------------------------------------- | -------- |
| [0001](0001-monorepo-pnpm.md) | Monorepo with pnpm workspaces, no Turborepo (Phase 1) | accepted |
| [0002](0002-ed25519-only-crypto.md) | Ed25519-only cryptography                            | accepted |
| [0003](0003-portable-verify-path.md) | Portable verify hot path (framework-free algorithm)  | accepted |
| [0004](0004-denial-precedence-public-api.md) | Denial precedence is part of the public API          | accepted |
| [0005](0005-audit-chain-canonicalization.md) | Audit chain canonicalization (RFC 8785-lite)         | accepted |
