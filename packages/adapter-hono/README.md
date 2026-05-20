# `@aegis/adapter-hono`

> Drop-in AEGIS verification middleware for [Hono](https://hono.dev). Edge-safe; works on Workers, Vercel Edge, Deno, Bun, and Node.

```bash
pnpm add @aegis/adapter-hono @aegis/sdk hono
```

## Usage

```ts
import { Hono } from 'hono';
import { aegis, type AegisHonoVars } from '@aegis/adapter-hono';

const app = new Hono<{ Variables: AegisHonoVars }>();

app.use('/api/*', aegis({ minTrustBand: 'VERIFIED' }));

app.post('/api/purchase', (c) => {
  // c.get('aegis') is typed because of the Variables generic above.
  const { agentId, principalId, trustBand } = c.get('aegis');
  return c.json({ approvedBy: agentId, principalId, trustBand });
});

export default app;
```

The middleware sets `c.var.aegis` on success (use `c.get('aegis')` to
read). On any denial, it returns the canonical AEGIS error envelope as
JSON without calling `next()`.

## Options

| Option           | Type                                                      | Default            |
|------------------|-----------------------------------------------------------|--------------------|
| `client`         | `Aegis`                                                   | env-built          |
| `tokenHeader`    | `string`                                                  | `'X-AEGIS-Token'`  |
| `minTrustBand`   | `'FLAGGED'\|'WATCH'\|'VERIFIED'\|'PLATINUM'`              | none |
| `deriveContext`  | `(c: Context) => VerifyContext`                           | none |

## Runtimes

Hono runs on every modern runtime, and so does this adapter. Tested:

- Node ≥18
- Bun
- Deno
- Cloudflare Workers
- Vercel Edge

## Status

**0.1.0-preview.** Seeded in Round 25 — see [docs/SEEDS.md](../../docs/SEEDS.md).

## License

MIT — © KLYTICS / AEGIS Labs.
