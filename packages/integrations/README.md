# `packages/integrations/` — peer-claimable integration stubs

This directory holds **scaffolded integration packages** ready for peer-claim and promotion to full workspace packages. None of these are workspace packages yet — they are intentionally outside the `pnpm-workspace.yaml` glob until a peer Claude (or human contributor) takes ownership and promotes them.

Drafted: 2026-05-15. Source-of-truth roadmap: [`docs/INTEGRATION_ROADMAP.md`](../../docs/INTEGRATION_ROADMAP.md).

## How a peer claims one

```sh
~/.claude/peers/bin/claude-peers claim aegis:int-<slug>
# Read packages/integrations/<slug>/README.md for the contract.
# Promote to a real workspace package:
mv packages/integrations/<slug> packages/aegis-<slug>
# Update its package.json name to @aegis/<slug>.
# Add to apps/marketing/lib/integrations.ts → flip status to 'beta'.
# Add paired tests under tests/integrations/<slug>/ or co-located *.spec.ts.
# `pnpm install && pnpm test:parity` must remain green.
~/.claude/peers/bin/claude-peers release aegis:int-<slug>
```

## Available stubs

| Stub | Pattern | Claim hook | Tier |
|---|---|---|---|
| [`openai/`](./openai/README.md) | A — Tool-call middleware | `aegis:int-openai` | A |
| [`anthropic/`](./anthropic/README.md) | A — Tool-call middleware | `aegis:int-anthropic` | A |
| [`vercel-ai-sdk/`](./vercel-ai-sdk/README.md) | A — Tool-call middleware | `aegis:int-vercel-ai-sdk` | A |
| [`langchain/`](./langchain/README.md) | A — Tool-call middleware | `aegis:int-langchain` | A |
| [`n8n/`](./n8n/README.md) | B — Workflow node | `aegis:int-n8n` | A |
| [`zapier/`](./zapier/README.md) | B — Workflow app | `aegis:int-zapier` | A |
| [`aws/`](./aws/README.md) | C — Cloud function adapter | `aegis:int-aws` | A |
| [`azure/`](./azure/README.md) | C — Cloud function adapter | `aegis:int-azure` | A |

## Shared design contract

All Pattern-A integrations expose a single canonical export:

```ts
export function withAegisVerification<T>(
  target: T,                       // The framework client / handler / chain
  config: {
    aegis: AegisClient;             // From @aegis/sdk
    actionPrefix: string;           // e.g. 'openai.', 'mcp.gh.'
    minTrustBand?: TrustBand;       // Default 'VERIFIED'
    onDenial?: (reason, ctx) => void;
  },
): T;
```

Pattern-B integrations expose a native node/app that the platform's runtime invokes; the wire shape is constrained by the platform.

Pattern-C integrations expose a provider-shaped middleware (e.g. `aegisLambdaWrapper(handler)`).

Pattern-D integrations expose a sink: `exportAuditEvents(events: SignedAuditEvent[], destination: SinkConfig)`.

The pattern guarantees consistency across all 90+ surfaces. A customer learns one mental model and applies it everywhere.

## What this directory is NOT

- **Not a workspace package directory.** `pnpm install` will not pick these up. That's intentional — these are *unclaimed* scaffolds.
- **Not production code.** Every `src/index.ts` has TODO bodies. Tests don't exist yet.
- **Not a release-blocker.** The marketing site references these in aspirational status (`'coming-soon'` / `'beta'` / `'planned'`); no customer journey depends on them existing.

Once a stub is claimed and promoted, the workspace package version of it (e.g. `packages/aegis-openai/`) becomes the source of truth.
