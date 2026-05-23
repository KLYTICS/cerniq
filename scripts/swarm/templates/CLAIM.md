# Claim — copy + fill before invoking `claude-peers claim`

Replace every `<...>` placeholder. Then submit:

```sh
~/.claude/peers/bin/claude-peers claim "<slug>: <one-line>" \
  --paths "<paths-comma-separated>"
```

---

## Slug

```
aegis:<tribe>-<scope>-<discriminator>
```

- `<tribe>` — one of: `feat` · `harden` · `docs` · `int` · `mkt` · `coord`
- `<scope>` — short noun phrase (e.g. `audit-compression`, `quickstart-route`)
- `<discriminator>` — optional (`-phase-0`, `-h2-fix`, `-v2-iter`)

## Tribe

<feature | hardening | docs | integration | marketing | coordination>

## Scope statement (one sentence)

What I will produce, in concrete terms.

## Paths (will-touch — explicit globs, no `**` shortcuts for whole repo)

```
path/glob/one
path/glob/two
```

## Anti-paths (will-NOT-touch)

```
packages/audit-verifier/**
apps/dashboard/**
OPERATOR_DECISIONS.md
WORK_BOARD.md
.husky/**
.changeset/**
```

(List what other peers are working on or what's intentionally shared.)

## TTL

<1h | 2h | 4h | 8h>

Pick based on scope size, not optimism. Default to one tier higher than you think you need.

## Heartbeat cadence

Every <60m | 90m | 120m>.

## Bundled ODs (if any)

- `OD-XXX` — <what decision is being touched>

## Atomicity contract

<independent commit | bundle with peer <sid> | follow-on to <peer-claim>>

If bundling, name the peer. If follow-on, name the commit or claim.

## Release plan

What I broadcast on release:

- File paths landed
- Tests passed
- Memory updates
- Follow-ups for peers

## Cross-product implications (if any)

- For ComplianceKit: <implication>
- For other live products: <implication>

If none, write "None — internal AEGIS work only."

## Sanity check (before submitting)

- [ ] Have I run `bash scripts/swarm/status.sh` in the last 10 min?
- [ ] Are my paths a subset of what no active peer has claimed?
- [ ] Have I checked `claude-peers inbox` for direct messages I haven't actioned?
- [ ] Is my scope small enough to ship within the TTL? (If not, split.)
- [ ] Do I have a clear "what does done look like" in my head?
