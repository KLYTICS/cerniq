# `@aegis/adapter-vercel-edge`

> Drop-in AEGIS verification for Vercel Edge Functions.

```bash
pnpm add @aegis/adapter-vercel-edge @aegis/sdk
```

## Usage — Edge Function

```ts
// api/protected.ts
import { wrapEdgeFunction } from '@aegis/adapter-vercel-edge';

export const config = { runtime: 'edge' };

export default wrapEdgeFunction({
  minTrustBand: 'VERIFIED',
  handler: async (req, ctx) => {
    return Response.json({
      approvedBy: ctx.agentId,
      principalId: ctx.principalId,
    });
  },
});
```

Set the API key in the Vercel project settings:

```
AEGIS_API_KEY = aegis_live_xxxxxxxx...      # see https://docs.aegislabs.io/keys
AEGIS_REGION  = eu                 # optional
AEGIS_API_URL = https://...        # optional, self-hosted
```

## For Next.js middleware

If you're on Next.js, use `@aegis/adapter-nextjs/middleware` instead —
it ships the same edge-safe logic with the Next-specific `config.matcher`
pattern already wired.

## Options

| Option           | Type                                                      | Default            |
|------------------|-----------------------------------------------------------|--------------------|
| `handler`        | `(req, ctx) => Response`                                  | **required**       |
| `minTrustBand`   | `'FLAGGED'\|'WATCH'\|'VERIFIED'\|'PLATINUM'`              | none |
| `tokenHeader`    | `string`                                                  | `'X-AEGIS-Token'`  |
| `deriveContext`  | `(req) => VerifyContext`                                  | none |
| `client`         | `Aegis`                                                   | env-built |

## Status

**0.1.0-preview.** Seeded in Round 25 — see [docs/SEEDS.md](../../docs/SEEDS.md).

## License

MIT — © KLYTICS / AEGIS Labs.
