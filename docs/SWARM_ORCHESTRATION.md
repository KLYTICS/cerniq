# AEGIS Swarm Orchestration Protocol

> **Read this if you are a Claude session opening in `~/Desktop/aegis` or a `.claude/worktree/*` derived from it.**
>
> *N parallel minds, one coherent output.* The Testament (`docs/THE_AEGIS_TESTAMENT.md`) is doctrine; this is its operational counterpart. The Testament tells you *why*; this tells you *how to ship in concert with N-1 other Claude sessions without stomping their work*.
>
> Codified: 2026-05-16 · Custodian: Erwin Kiess-Alfonso · Re-read on every new repo session, not just the first one.

---

## I. Preamble — colliding as one

A swarm is not a herd. A herd avoids collision; a swarm channels it. When two Claude sessions work the same repo, their work *will* collide — on shared files, on shared concepts, on overlapping mental models. The question is not *whether* but *how*: destructively (one commit clobbers the other; one Claude rewrites what another wrote 90 seconds prior) or *productively* (peer A's audit-compression substrate sharpens peer B's marketing surface; peer C's review-findings closeout converts peer D's scaffold into a shippable package).

This document is the aim. It exists because:

1. **Memory is a snapshot.** Two Claudes loading the same memory at different times build different mental models. Without protocol, those mental models drift.
2. **Claims are advisory.** `claude-peers` records claims; it does not enforce them. Discipline is the enforcement.
3. **Git is the shared truth.** Two Claudes in the same working tree share `pnpm-lock.yaml`, share `WORK_BOARD.md`, share staged-state. `git add -A` in this context is friendly fire.
4. **Doctrine decays without re-reading.** Operating contracts that aren't loaded into every session erode at the rate of one session per decay cycle. This document is the reload.

If you load this and you are alone in the repo (`claude-peers status` shows only your sid), most of this document still applies — to *future-you* opening this repo in 7 days, who must coordinate with *past-you* via the audit chain, the changelog, and `SESSION_HANDOFF.md`. The swarm is temporal as well as parallel.

---

## II. The inviolable laws — Leviticus parallel

Eight laws. They are not negotiable. They mirror `CLAUDE.md §architecture-invariants` but at the *coordination* layer rather than the *cryptography* layer.

### Law 1 — Always claim before working

```sh
~/.claude/peers/bin/claude-peers claim "aegis:<tribe>-<scope>: <one-sentence statement>" \
  --paths "path/glob/one,path/glob/two"
```

A claim is a public contract: *I will touch these paths, you should not.* No claim = no contract = expect to be stomped.

**Exception:** Read-only inspection (`git log`, `Read`, `grep`) is always free.

### Law 2 — Explicit-path staging only

```sh
# WRONG — sweeps peer work:
git add -A
git commit -m "..."

# RIGHT — only your paths:
git add path/one path/two
git commit -m "..."
```

Memory: `[[feedback_shared_tree_git_coordination]]` codifies the incident that led to this law. The blast radius of `git add -A` in a shared working tree is one or more peer commits silently absorbed into yours. Recovery is `git reset` + manual unwind across two or more diverged peer commits. The single character difference (`-A` vs explicit paths) prevents an hour of cleanup.

### Law 3 — Append-only memory + audit + changelog + SESSION_HANDOFF

Do not edit past entries. If a fact has changed, *supersede* it with a new entry that explicitly references the old:

```markdown
**2026-05-16 sync — supersedes 2026-05-09 §C below.**
- New fact: X is now Y.
- Why: peer Z released claim ABC.
- Old §C kept as historical record.
```

This mirrors the AEGIS audit chain itself (CLAUDE.md invariant #3). The discipline of append-only flows down from the customer-facing surface (we promise customers we never edit their audit log) to the internal-facing surface (we never edit our own coordination log). Eating our own dogfood is the strongest procurement signal we ship.

### Law 4 — Respect peer claim boundaries

Read every active claim before staging. Two practical rules:

- **Within their paths:** Do not touch. Even small edits — typo fixes, lint cleanups, comment polish. If you see something that needs fixing, message the peer; do not surgical-strike inside their scope.
- **Outside their paths:** You are clear to work, even if it sits adjacent.

The exception is shared files that *no peer claims* but everyone touches (`pnpm-lock.yaml`, `package.json`, `WORK_BOARD.md`, `SESSION_HANDOFF.md`, `OPERATOR_DECISIONS.md`). These need extra care:

| Shared file | Coordination |
|---|---|
| `pnpm-lock.yaml` | If multiple peers add deps in the same window, expect merge churn. Commit lockfile changes in the same commit as the dep additions. |
| `WORK_BOARD.md` | Treat as `OPERATOR_DECISIONS.md` — single-writer at a time. If you need to touch it, claim it explicitly with a short TTL (<30m). |
| `SESSION_HANDOFF.md` | Append-only. Newest entry at top. Other peers' entries must not be moved. |
| `OPERATOR_DECISIONS.md` | Append OD rows; never edit existing ones. Operator-driven section is read-only for peers. |
| `CLAUDE.md` | Treat as constitutional. Touch only via explicit operator-approved PR. |

### Law 5 — Surface operator decisions explicitly

When you reach a fork that requires the operator (Erwin) to decide, **do not guess**. Mark it `OPERATOR-INPUT-NEEDED` in code/docs and proceed with the documented placeholder behavior. Examples from this repo:

- BATE scoring weights (`docs/BATE_ALGORITHM.md`)
- Stripe price IDs (`OPERATOR_DECISIONS.md` OD-003 / ADR-0014)
- Auth0 v4 SDK install + provider config (CLAUDE.md §pending-decisions)
- PQ-hybrid trigger (OD-014)
- Default IdP (OD-015)
- Audit-compression sub-decisions (OD-017)

The wrong move is silent default-with-fingers-crossed. The right move is `OPERATOR-INPUT-NEEDED: choosing X for now; OD-018 will decide`. The operator sees the flag, decides, the comment becomes a one-character removal.

### Law 6 — Append-only across products

A Claude in `~/Desktop/aegis` and a Claude in `~/Desktop/cerniq` are different repos but the same operator. If your AEGIS work has implications for ComplyKit, ComplianceKit, or any other live product:

- Send a `claude-peers msg` broadcast (works cross-repo via the peer system)
- Add a memory entry that cross-references both products via `[[link]]`
- Note in your SESSION_HANDOFF that a cross-product implication exists

You do not edit the other product's files. You signal the implication; their peers ratify or push back.

### Law 7 — No silent failures

Mirrors CLAUDE.md invariant #4. If a peer's broadcast fails, surface it. If a hook fails, surface it (do not `--no-verify` past). If a peer claim conflict is detected and your work proceeds anyway in advisory mode, log the override decision in your eventual commit message.

The pattern: every failure is either *fixed* or *visible to the operator*. Neither *hidden* nor *swallowed*.

### Law 8 — Emergency stop responsiveness

If the operator (Erwin) sends a `claude-peers msg` containing the word `STOP` or `HALT` or `ABORT`, every receiving Claude:

1. Stops writing immediately. Finish the current Edit/Write/Bash call; do not start another.
2. Stages current work-in-progress under an explicit-path `git add` (but do not commit).
3. Reports current state via `claude-peers msg <operator-sid>` with: current claim, files touched, last test result, last commit SHA.
4. Awaits an explicit `RESUME` message before continuing.

This is the only protocol-level interrupt. It is uncontested. The Testament has the operator as ultimate decider; this is the technical realization of that doctrine.

---

## III. The six tribes

Every claim belongs to one of six tribes. The tribe determines the claim slug prefix, the typical TTL, and the typical landing pattern.

| Tribe | Prefix | Typical TTL | Typical landing | Examples |
|---|---|---|---|---|
| **Feature** | `aegis:feat-` | 4-8h | Standalone commit on feature branch | new module, new endpoint, new SDK function |
| **Hardening** | `aegis:harden-` | 2-4h | Bundle with feature OR follow-on commit | security fix, GHSA closeout, test parity |
| **Docs** | `aegis:docs-` | 1-2h | Standalone commit | ADR, runbook, spec, README |
| **Integration** | `aegis:int-` | 4-8h | Promotes a stub package | `aegis:int-openai`, `aegis:int-n8n` |
| **Marketing** | `aegis:mkt-` | 2-4h | Standalone commit on `apps/marketing/**` | landing copy, integrations page, SEO |
| **Coordination** | `aegis:coord-` | 1-2h | This doc; SESSION_HANDOFF entries; meta-work | swarm protocol, memory updates, peer reconciliation |

A claim that doesn't fit any tribe is an anti-pattern — split it.

---

## IV. Lifecycle of a claim

Six phases. Each has explicit entry conditions and exit signals.

### Phase 1 — Discover (10-30 min)

Before you propose work, build situational awareness:

```sh
# One-line full read:
bash scripts/swarm/status.sh

# Or run components:
git status --short --branch
git log --all --since="6 hours ago" --oneline
~/.claude/peers/bin/claude-peers status
~/.claude/peers/bin/claude-peers inbox
```

Read recent SESSION_HANDOFF entries (top 5 minimum). Skim `CHANGELOG` or `docs/INTEGRATION_ROADMAP.md` for in-flight work. If memory's [[project_aegis]] has a "2026-MM-DD sync" header newer than 7 days, trust the sync first.

**Exit signal:** You can name every active peer claim, the current branch, and any in-flight bundle in flight.

### Phase 2 — Plan (10 min)

Write the claim *before* you start touching files. Use `scripts/swarm/templates/CLAIM.md`. The claim is a public commitment:

```
slug: aegis:<tribe>-<scope>-<discriminator>
tribe: <one of six>
scope: <one sentence>
paths: <explicit globs>
anti-paths: <explicit "NOT TOUCHING" list>
ttl: <1h | 2h | 4h | 8h>
atomicity: <independent | bundle-with-X | follow-on-to-Y>
bundled ODs: <OD-XXX if any>
```

Submit the claim with explicit `--paths` so other peers see your scope:

```sh
~/.claude/peers/bin/claude-peers claim "aegis:mkt-quickstart: build interactive /quickstart route. Paths: apps/marketing/app/quickstart, apps/marketing/components." \
  --paths "apps/marketing/app/quickstart,apps/marketing/components"
```

If you get a "WARNING — overlap detected" response, **stop and read the overlap.** If your paths genuinely conflict, *do not* proceed in advisory mode; pivot or coordinate via msg.

**Exit signal:** Claim recorded in `claude-peers status`; no genuine path overlap; TTL set.

### Phase 3 — Execute (40-90% of total time)

Standard Claude execution: TaskCreate, Read, Edit/Write, Bash test verifications. The discipline:

- Stay inside your paths. If you reach for a path outside your claim, *stop and amend the claim* (`claude-peers claim` again with widened paths) before touching the file.
- Run the narrowest meaningful verification (`pnpm --filter <pkg> typecheck` or `--filter <pkg> test`) frequently, not just at the end.
- If you discover that your scope is wrong-sized (too small or too large), surface it: split into multiple claims, or fold the extra into your existing claim with an amended description.

**Exit signal:** All planned work landed in the working tree; tests pass; you have a clear paragraph for the commit message.

### Phase 4 — Coordinate (10 min)

Before staging, broadcast the landing:

```sh
~/.claude/peers/bin/claude-peers msg all "Landed <slug>. Touched: <paths>. Tests: <X/X>. Following up with: <peer> on <topic>."
```

If your work has implications for another peer's in-flight work, send a *direct* message in addition to the broadcast:

```sh
~/.claude/peers/bin/claude-peers msg <sid-prefix> "Direct: my <work> implies you should <action> in your <claim>."
```

**Exit signal:** Broadcast sent; direct messages to affected peers sent; no incoming messages indicate a coordination problem.

### Phase 5 — Land (5 min)

Explicit-path staging. NEVER `git add -A`:

```sh
git status --short                        # confirm what's unstaged
git diff --stat <your-paths>              # confirm size
git add path/one path/two path/three      # explicit only
git status --short                        # confirm nothing accidental staged
git commit -m "$(cat <<'EOF'
<tribe>(<scope>): <one-line summary>

<2-4 paragraph context: what landed, why, what follows>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git status                                # verify clean
```

If `pnpm-lock.yaml` changed, include it in the same commit as the dep additions.

If you have CLAUDE.md's commit-standard "Lore protocol" trailers to add (`Constraint:`, `Rejected:`, `Confidence:`, `Tested:`, `Not-tested:`), add them between the body and the Co-Authored-By line.

**Exit signal:** Clean `git status`; `git log -1` shows your commit; `pnpm <narrow>` still green post-commit.

### Phase 6 — Handoff (5 min)

Three updates close out the claim:

1. **`docs/SESSION_HANDOFF.md` entry** — newest at top, ~5-15 lines describing what landed, paths, tests, follow-ups. Use `scripts/swarm/handoff.sh` to generate.
2. **Memory update** — if your work changes a fact captured in `~/.claude/projects/-Users-money/memory/`, supersede the relevant memory entry (see Law 3).
3. **Release the claim** — `claude-peers release <slug>`.

**Exit signal:** Claim no longer in `claude-peers status`; handoff entry visible; memory consistent with reality.

---

## V. Claim taxonomy

### Slug format

```
aegis:<tribe>-<scope>-<discriminator>
```

- `<tribe>` — one of `feat`, `harden`, `docs`, `int`, `mkt`, `coord`
- `<scope>` — short noun phrase identifying the area (`audit-compression`, `mcp-bridge`, `quickstart-route`)
- `<discriminator>` — optional, distinguishes parallel claims in the same scope (`-phase-0`, `-h2-fix`, `-v2-iter`)

**Examples from this week:**
- `aegis:feat-intent-manifest-phase-2`
- `aegis:harden-mcp-bridge-h2-action-scoping`
- `aegis:docs-adr-0015-audit-compression`
- `aegis:int-openai-stub`
- `aegis:mkt-cinematic-landing-v2`
- `aegis:coord-swarm-orchestration-doc` (this very claim)

### Paths field

Always explicit. Glob-style. Examples:

```
apps/api/src/modules/intent/**
packages/audit-verifier/src/manifest*.ts
docs/decisions/0015-audit-storage-compression.md
apps/marketing/app/quickstart/**
```

### Anti-paths

State what you will *not* touch, especially adjacent paths that other peers may have. This is high-leverage: it eliminates ambiguity faster than any other coordination signal.

Example from peer 2b178d04:

> NOT TOUCHING apps/dashboard/** (CSS bleed group), not touching OPERATOR_DECISIONS.md / WORK_BOARD.md (docs group).

Two sentences. Removes 90% of overlap concerns for adjacent peers.

### TTL

| Scope size | TTL | Heartbeat cadence |
|---|---|---|
| Single file edit | 1h | none |
| Multi-file feature | 2h | every 60m |
| Module / package | 4h | every 90m |
| Cross-package or breaking | 8h | every 120m |

Heartbeat: `~/.claude/peers/bin/claude-peers heartbeat <slug>` extends the TTL. If you go silent past TTL, your claim expires and another peer may take the scope.

---

## VI. Message threading

Three message patterns, three uses:

| Pattern | Tool | Use |
|---|---|---|
| **Broadcast** | `claude-peers msg all "..."` | Ecosystem changes: new architecture, breaking change, claim released, swarm doc updated |
| **Direct** | `claude-peers msg <sid-prefix> "..."` | Peer-specific: handoff request, coordination on shared scope, dependency declaration |
| **Threaded reply** | `claude-peers msg <thread-id> "..."` | Continuation of an existing thread |

Standard fields any message should include:

- **What landed** — concrete artifacts, file paths, commit SHAs
- **Implications** — what changed for other peers
- **Asks** — explicit "I need you to X" if applicable
- **Status** — ongoing / blocked / done

Bad message: *"Hey, finished my thing."*
Good message: *"Landed aegis:feat-intent-manifest-phase-2 — `apps/api/src/modules/intent/**` (12 files, 1.9K LOC) live behind `AEGIS_INTENT_MANIFEST_ENABLED`. ADR-0017 + memory adapter. 12/12 jest + 114/114 parity green. **Asks:** marketing peer to flip /use-cases coming-soon → available when intent-* examples promote."*

---

## VII. Conflict resolution

When two peers want the same scope (path overlap, ADR overlap, identifier collision):

| Situation | Resolution |
|---|---|
| First claim, then second tries same scope | First wins. Second pivots to adjacent scope or coordinates via msg. |
| Equal-time claims (within 60s) | Smaller scope defers. If equal: alphabetical sid wins (deterministic tiebreaker). |
| Both urgent, both have valid reasons | Split + coordinate. Send a `claude-peers msg` proposing the split. Operator may need to adjudicate. |
| Peer A's commit accidentally touched peer B's paths | Peer A reverts the unrelated changes (`git revert` or surgical re-edit); apologizes in broadcast; re-commits clean. |
| Peer A's claim expires while still working | Peer B picks up if needed; otherwise peer A re-claims with extended TTL + heartbeat. |
| Peer states "advisory mode — claim proceeding" but you see real conflict | Stop. Send peer a direct message. Wait for response before continuing. |

The Testament Book IV (Numbers) has the operator as ultimate adjudicator. When peers cannot resolve, the operator gets the message. If the operator is offline, the more conservative peer (the one willing to defer) acts first.

---

## VIII. Operator decision queue

Operator decisions are the *visible-but-not-actionable* category. They are flagged in `OPERATOR_DECISIONS.md`. Open ODs as of 2026-05-16:

| OD | Topic | Blocks |
|---|---|---|
| OD-003 | Stripe price IDs in prod env | Customer signup live mode |
| OD-014 | PQ-hybrid trigger criteria | ADR-0013 flag flip |
| OD-015 | Default IdP for new dashboards | First Clerk-using customer |
| OD-016 | GDPR redact API public exposure | EU GA |
| OD-017 | Audit compression eight-decision package | M-036 Phases 1-3 |
| OD-018/019/020 | Intent manifest Phase 2.1 Prisma adapter | Persistent storage |

Peers consult this queue to:

1. **Avoid blocking on it.** If your work needs an OD-X decision, route around it with `OPERATOR-INPUT-NEEDED` markers and proceed on the documented placeholder.
2. **Surface new pending decisions.** If your work uncovers a fork the operator must decide, append a new OD row (do not edit existing).
3. **Confirm the decision before proceeding.** Once the operator marks an OD `DECIDED`, the next peer to touch the relevant code can act on the decision.

**The wrong pattern:** silently choosing a default, then later discovering the operator wanted a different default. Cost: a refactor + a memory supersede + a coordination broadcast.

**The right pattern:** explicit `OPERATOR-INPUT-NEEDED` marker, default behavior documented, work proceeds.

---

## IX. Cross-product narrative threading

Erwin runs multiple products: **AEGIS** + **ComplianceKit / ComplyKit** (`~/Desktop/ComplianceKit` + `~/Downloads/ComplyKit (2)`) are currently live. Other products are cold-stored per [[project_cold_storage_pivot]].

When AEGIS work has implications for another live product (and vice versa):

1. **Detect the implication.** Does your AEGIS change touch a contract another product depends on? Audit chain export format, JWKS shape, intent manifest schema, ACP compatibility, FAPI 2.0 profile, denial precedence?
2. **Signal via cross-product broadcast.** `claude-peers msg all` works across repos via the central peer service.
3. **Cross-link memory.** Add `[[other-product-memory]]` wiki-links in your AEGIS memory entry and (when you next open that repo) vice versa.

The wrong pattern: shipping a breaking change in AEGIS that ComplianceKit silently depends on, discovering the breakage 3 days later when ComplianceKit CI fails.

The right pattern: broadcast the breaking change pre-commit; ComplianceKit peers acknowledge or push back; coordinate the upgrade.

---

## X. Emergency stop protocol

Word triggers in incoming `claude-peers msg`: `STOP`, `HALT`, `ABORT`, `EMERGENCY`, `RED LIGHT`.

On receipt:

```
[T+0]   Finish current tool call. Do not start another Edit/Write/Bash.
[T+0]   Reply ACK to operator: "Stopped. Current claim: <slug>.
                                 Files in working tree: <list>.
                                 Last test result: <pass/fail>.
                                 Last commit SHA: <sha>."
[T+0]   Stage current work-in-progress with explicit paths (do NOT commit).
        git add <paths>  # explicit only
[T+0]   Await RESUME message before continuing.
```

The operator may follow up with:
- `RESUME` — continue current work
- `ROLLBACK` — `git reset HEAD --keep` to unstage, then await further instructions
- `RELEASE` — release your peer claim; do not commit; another peer or operator handles
- `INVESTIGATE <topic>` — switch to read-only mode and gather info on the topic

If no operator response within 30 minutes, default to `RELEASE`: stage nothing, release claim, send "Standing down at T+30m without operator response" message, end session.

---

## XI. Anti-patterns

Patterns that violate the laws or the spirit of the swarm. If you find yourself doing any of these, stop and re-read this doc.

| Anti-pattern | What it looks like | Why it's bad |
|---|---|---|
| `git add -A` in shared tree | One-liner stage-everything commit | Friendly fire on peer in-flight work |
| Editing past audit / SESSION_HANDOFF / CHANGELOG entries | "Just a small fix to that 2-day-old entry" | Violates Law 3 append-only |
| Claiming everything | `aegis:feat-all-the-things --paths "**"` | Defeats the purpose of claims; no one knows what you actually own |
| Claiming nothing | Working in shared tree without a claim | No discoverability, no protection |
| Silent fallback on hook fail | `git commit --no-verify` | Violates Law 7 no-silent-failures |
| Guessing on an OD | "I'll just pick A; we can change it later" | Operator's role; violates Law 5 |
| Stomping a peer's adjacent file | "Just a typo fix in their file" | Violates Law 4; if it really needs fixing, send a msg |
| Cargo-cult Lore trailers | `Confidence: high` on every commit regardless | Trailers must be true and useful or omit |
| Ignoring `prefers-reduced-motion` in animations | Heavy motion as default | Violates accessibility; ships hostile UX |
| Math.random in production paths | Anywhere on the verify hot path | Violates CLAUDE.md §quality-bar |
| Mocking peer work that should be observed | "Their bundle isn't merged yet; I'll fake the import" | Better: stub the import; flag with TODO referencing the peer claim |

---

## XII. Appendix — scripts, templates, references

### Scripts (in `scripts/swarm/`)

| Script | Purpose |
|---|---|
| `status.sh` | One-line situational awareness: peer status + git + recent commits + inbox count |
| `handoff.sh` | Generates a `docs/SESSION_HANDOFF.md` entry from current state |
| `promote-stub.sh <slug>` | Promotes `packages/integrations/<slug>/` → `packages/aegis-<slug>/` workspace package |

### Templates (in `scripts/swarm/templates/`)

| Template | When |
|---|---|
| `CLAIM.md` | Before submitting a peer claim |
| `HANDOFF.md` | When releasing a claim |

### Related docs

- `CLAUDE.md` — root operating contract; architecture invariants
- `docs/THE_AEGIS_TESTAMENT.md` — vision + doctrine
- `docs/SPRINT_PROTOCOL.md` — older sibling of this doc; sprint-cadence rules
- `docs/SESSION_HANDOFF.md` — newest-first per-claim handoff log
- `docs/INTEGRATION_ROADMAP.md` — peer-claim hooks for integration work
- `docs/LAUNCH_RUNBOOK.md` — operator-side ship-to-revenue sequence
- `OPERATOR_DECISIONS.md` — open decisions blocking some peer scopes
- `WORK_BOARD.md` — module status board
- `~/.claude/projects/-Users-money/memory/` — persistent memory across sessions

### Cross-repo peer-system commands

```sh
~/.claude/peers/bin/claude-peers status                    # all repos
~/.claude/peers/bin/claude-peers status --repo aegis        # this repo only
~/.claude/peers/bin/claude-peers claim "<slug>" --paths "..."
~/.claude/peers/bin/claude-peers heartbeat <slug>
~/.claude/peers/bin/claude-peers release <slug>
~/.claude/peers/bin/claude-peers msg all "<body>"
~/.claude/peers/bin/claude-peers msg <sid-prefix> "<body>"
~/.claude/peers/bin/claude-peers inbox
~/.claude/peers/bin/claude-peers inbox --unread
~/.claude/peers/bin/claude-peers conflict-check            # path overlap pre-commit
```

---

## XIII. When in doubt

Read in this order:

1. This file (you are here)
2. `CLAUDE.md` (root scope)
3. The scoped `CLAUDE.md` for the surface you are touching (e.g. `apps/api/CLAUDE.md`)
4. `docs/THE_AEGIS_TESTAMENT.md` for doctrinal questions
5. The relevant ADR in `docs/decisions/`
6. The relevant memory entry under `~/.claude/projects/-Users-money/memory/`

When the protocol and the code disagree, the code wins (it's the running reality). When the protocol and the operator disagree, the operator wins. When the protocol and your judgment disagree on a small thing, the protocol wins (consistency beats local optimization). When the protocol and your judgment disagree on a *large* thing — pause and message the operator.

The Testament's line applies here too: *"When in doubt, the verse wins."*

---

**Version:** 1.0.0 · **Effective:** 2026-05-16 · **Supersedes:** `docs/SPRINT_PROTOCOL.md` (older sibling; remains valid for sprint-cadence specifics not covered here).

**Ratification:** broadcast on creation; peers may propose amendments via PR + operator sign-off. Append-only changelog at the bottom of this file once first amendment lands.

**Changelog (append-only):**

- *2026-05-16* — v1.0.0 codified by `aegis:coord-swarm-orchestration-doc` claim. Initial laws, tribes, lifecycle, taxonomy, threading, conflict resolution, OD queue, cross-product threading, emergency stop, anti-patterns, appendix.
