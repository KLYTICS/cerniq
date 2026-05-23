# @aegis/zapier — Zapier CLI app for AEGIS verification

**Pattern:** B — Workflow app
**Status:** Stub
**Claim hook:** `aegis:int-zapier`
**Target name:** `aegis` Zapier app (private until public listing approval)

## What it does

Adds an **AEGIS Verify** action to Zapier. Drop it into any Zap between the trigger and the action that performs an agent action. The action calls `POST /v1/verify` and short-circuits the Zap (via Filter or Path) when AEGIS denies.

## Why this matters

Zapier is the dominant SMB workflow platform. A Zap action that gates any agent step on cryptographic verification is the lowest-friction path to AEGIS revenue from the SMB segment.

## Implementation notes

- Built with Zapier CLI (`zapier-platform-cli`), not Zapier Developer Platform UI.
- Single action: `verify_agent`, with input fields matching the n8n node.
- Auth: API key (custom auth type).
- Submission flow: build → `zapier push` → invite testers → submit for public listing.

## Trigger / action / search

For v1, only the action is exposed:

| Type | Key | Description |
|---|---|---|
| Action | `verify_agent` | Verify an agent action via AEGIS; returns valid + trust + reason |

Searches and triggers (e.g. "new denial fired") can land in v2.

## TODO

- [ ] Zapier CLI scaffold
- [ ] `verify_agent` action definition
- [ ] Custom-auth definition (API key in header)
- [ ] Test workflow for `zapier test`
- [ ] Submission package
