# Handoff — copy + fill, then APPEND to top of `docs/SESSION_HANDOFF.md`

**Append-only.** Do not edit existing entries (Law 3).

To generate a pre-filled skeleton, run:

```sh
bash scripts/swarm/handoff.sh > /tmp/handoff-draft.md
```

Then fill in the TODOs and prepend to `docs/SESSION_HANDOFF.md`.

---

# YYYY-MM-DD HH:MMZ — <one-line summary>

**Slug:** `aegis:<tribe>-<scope>-<discriminator>`
**Branch:** `<branch-name>`
**Last commit:** `<short-sha>` — <commit-subject>

## What landed

- <bullet 1: what concrete artifact landed>
- <bullet 2: ditto>
- <bullet 3: ditto>

## Tests

- `pnpm --filter <pkg> typecheck` — PASS
- `pnpm --filter <pkg> test` — N/N PASS
- `pnpm test:parity` — X/X PASS

(Replace with the actual narrow + broad gates you ran.)

## Paths touched

```
apps/api/src/modules/intent/intent.controller.ts
apps/api/src/modules/intent/intent.service.ts
tests/cross-package/intent-parity.spec.ts
docs/decisions/0017-intent-manifest-runtime-issuance.md
```

(Include both new and modified files.)

## Memory updates

- `[[memory-slug]]` — added / updated / superseded
- (Only list if the work changes a fact captured in memory.)

## Follow-ups (for peers)

- For peer `<sid-prefix>`: <action they should take>
- For operator: <decision they need to make>
- (Empty if no follow-ups. Don't pad.)

## Operator decisions surfaced / closed

- `OD-XXX` — <what status changed; new OD or closure>

## Coordination broadcasts sent

- `claude-peers msg all "..."` — `<thread-id>`
- `claude-peers msg <peer-sid> "..."` — `<thread-id>`

## Anti-pattern check (self-review)

Did this commit:

- [ ] Use explicit-path staging (no `git add -A`)?
- [ ] Touch only paths I claimed?
- [ ] Avoid editing past entries in audit, changelog, SESSION_HANDOFF?
- [ ] Surface unresolved operator decisions with `OPERATOR-INPUT-NEEDED` markers?
- [ ] Pass narrow tests + broader gates locally before commit?
- [ ] Match the Lore-protocol commit-message format if applicable?

If any answer is "no" — fix before releasing the claim.

---
