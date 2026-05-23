# Source-of-truth notice

CERNIQ's canonical repository lives on **Radicle**, a peer-to-peer git protocol where the project's identity is its own cryptographic hash and the network is held up by independent seeders rather than a single host.

- **Radicle ID (RID):** `rad:z3JUSaS2iRrV1raoSaqXxowLDHq6b`
- **Web view:** https://radicle.network/nodes/rosa.radicle.network/rad:z3JUSaS2iRrV1raoSaqXxowLDHq6b
- **Signed by node:** `did:key:z6MktaWRHDtqf9WBqcuoM2u7Qq7Nq91zciw9xE5ib8JkN3EA` (alias `anakin`)

## Why this matters

CERNIQ is an **Agent Gateway & Identity Stack** — cryptographic identity, policy enforcement, behavioral attestation, and tamper-evident audit rails for AI agents. Our own source code is published on the same kind of substrate we ask AI operators to trust their agents to: non-custodial, signed end-to-end, content-addressed, and resilient to any single host going away.

We eat what we ship.

## How to clone

You don't need a Radicle account. Install the CLI (`brew install radicle`) and run:

```bash
rad clone rad:z3JUSaS2iRrV1raoSaqXxowLDHq6b
```

This fetches the full git history from whichever Radicle peer is reachable and verifies every signed ref against the project's cryptographic identity.

## Mirrors

We also publish read-only mirrors for convenience and CI integration. **Open issues and pull requests against the Radicle canonical**, not the mirrors:

- **GitHub mirror** (this repo): https://github.com/KLYTICS/cerniq — read-only, redirects from the historical `KLYTICS/aegis` and `KLYTICS/okoro` names
- **GitLab mirror** (CI runner): _pending — link will be added when the klytics group on gitlab.com is provisioned_

Mirrors are pushed from a CI job that runs after every signed commit lands on the Radicle canonical, so they lag the canonical by minutes, not days. If you see a divergence, the Radicle copy is right.

## Provenance trail

The project's git history records its rebrand chain:

- `AEGIS` (initial codename)
- `OKORO` (interim rename — see `chore/rename-okoro` branch)
- `CERNIQ` (current — see [README.md](README.md))

All three names point at the same signed Radicle project. The history is preserved end-to-end; you can `git log` your way through the rebrand.

---

© 2026 KLYTICS LLC — Apache-2.0
