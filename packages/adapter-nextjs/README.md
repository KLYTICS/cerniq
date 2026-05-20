# `@aegis/adapter-nextjs`

> Drop-in AEGIS verification helpers for Next.js — App Router, Pages Router, and Edge Middleware.

```bash
pnpm add @aegis/adapter-nextjs @aegis/sdk
# or: npm install / yarn add
```

## App Router route handler

```ts
// app/api/buy/route.ts
import { withAegis } from '@aegis/adapter-nextjs';

export const POST = withAegis(
  async (req, ctx) => {
    // ctx.agentId / ctx.principalId / ctx.trustBand are guaranteed populated.
    // ctx.verify has the full VerifyResult.
    return Response.json({ approvedBy: ctx.agentId });
  },
  {
    minTrustBand: 'VERIFIED',
    deriveContext: (req) => ({ action: 'commerce.purchase', amount: 100, currency: 'USD' }),
  },
);
```

## Pages Router API route

```ts
// pages/api/buy.ts
import { withAegisPages } from '@aegis/adapter-nextjs';

export default withAegisPages(async (req, res, ctx) => {
  res.status(200).json({ approvedBy: ctx.agentId });
});
```

## Edge Middleware

```ts
// middleware.ts (project root)
import { aegisMiddleware } from '@aegis/adapter-nextjs/middleware';

export default aegisMiddleware({
  minTrustBand: 'VERIFIED',
  protectedPaths: ['/api/'],
});

export const config = { matcher: ['/api/:path*'] };
```

The middleware runs on the Edge runtime (`@noble/ed25519` is edge-safe;
no Node-only imports). Requests outside `protectedPaths` pass through
untouched. Verified requests proceed to their route handler; denied
requests get the canonical AEGIS envelope.

## Configuration

All three entry points share `WithAegisOptions`:

| Option         | Type                          | Default                            | Notes |
|----------------|-------------------------------|------------------------------------|-------|
| `client`       | `Aegis`                       | `new Aegis()` (reads env)          | Reuse across handlers in production |
| `tokenHeader`  | `string`                      | `'X-AEGIS-Token'`                  | Matches `@aegis/mcp-bridge` |
| `minTrustBand` | `'FLAGGED'\|'WATCH'\|'VERIFIED'\|'PLATINUM'` | none — any successful verify | Higher = stricter |
| `deriveContext`| `(req) => VerifyContext`      | none                                | Forwards action/amount/etc. to the verify algorithm |
| `onDenial`     | `(input) => void`             | none                                | Structured logging hook |

## Errors — junior-grade

Every denial returns a canonical AEGIS envelope:

```json
{
  "error": "trust_score_too_low",
  "message": "Agent trust band WATCH below required VERIFIED.",
  "statusCode": 403,
  "requestId": "...",
  "next": "Build agent reputation over time or lower minTrustBand for this route"
}
```

The `next` field comes from the shared error catalog — same wording the
SDK + dashboard + `aegis doctor` use.

## Status

**0.1 — preview.** Pattern validated for the App + Pages routers and
Edge Middleware. Round 26 will land `@aegis/adapter-vercel-edge`,
`@aegis/adapter-aws-lambda`, `@aegis/adapter-cloudflare-workers`, and
`@aegis/adapter-hono` using this same shape.

## License

MIT — © KLYTICS / AEGIS Labs.
