# `@aegis/adapter-cloudflare-workers`

> Drop-in AEGIS verification for Cloudflare Workers. Edge-safe; no Node-only deps.

```bash
pnpm add @aegis/adapter-cloudflare-workers @aegis/sdk
```

## Usage

```ts
// src/worker.ts
import { wrapWorker } from '@aegis/adapter-cloudflare-workers';

export default wrapWorker({
  minTrustBand: 'VERIFIED',
  handler: async (req, ctx) => {
    return Response.json({
      approvedBy: ctx.agentId,
      trustBand: ctx.trustBand,
    });
  },
});
```

Set the API key as a secret:

```bash
wrangler secret put AEGIS_API_KEY
```

Optional `vars` in `wrangler.toml`:

```toml
[vars]
AEGIS_REGION = "eu"             # us | eu | apac | auto (default)
AEGIS_API_URL = ""              # override for self-hosted AEGIS
```

## Options

| Option            | Type                                                      | Default            |
|-------------------|-----------------------------------------------------------|--------------------|
| `handler`         | `(req, ctx, env) => Response`                             | **required**       |
| `minTrustBand`    | `'FLAGGED'\|'WATCH'\|'VERIFIED'\|'PLATINUM'`              | none — any verify passes |
| `tokenHeader`     | `string`                                                  | `'X-AEGIS-Token'`  |
| `deriveContext`   | `(req) => VerifyContext`                                  | none — forwards action/amount/etc. |
| `protectedPaths`  | `string[]`                                                | `undefined` — gate all paths |

## Bundle size

This package depends only on `@aegis/sdk` (which depends only on
`@noble/ed25519`). Wrangler's bundler can't drag Node modules in, so
your worker bundle stays small.

## Status

**0.1.0-preview.** Seeded in Round 25 — see [docs/SEEDS.md](../../docs/SEEDS.md).

## License

MIT — © KLYTICS / AEGIS Labs.
