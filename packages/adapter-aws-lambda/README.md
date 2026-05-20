# `@aegis/adapter-aws-lambda`

> Drop-in AEGIS verification for AWS Lambda. Supports API Gateway v1, v2, ALB, and Lambda Function URLs.

```bash
pnpm add @aegis/adapter-aws-lambda @aegis/sdk
```

## Usage

```ts
// handler.ts
import { wrapLambda } from '@aegis/adapter-aws-lambda';

export const handler = wrapLambda({
  minTrustBand: 'VERIFIED',
  handler: async (event, ctx) => ({
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      approvedBy: ctx.aegis.agentId,
      principalId: ctx.aegis.principalId,
      trustBand: ctx.aegis.trustBand,
    }),
  }),
});
```

## Environment

| Variable        | Notes                                                |
|-----------------|------------------------------------------------------|
| `AEGIS_API_KEY` | Required. Set via Lambda env vars or Secrets Manager.|
| `AEGIS_REGION`  | Optional. `us`/`eu`/`apac`/`auto`.                   |
| `AEGIS_API_URL` | Optional. Override for self-hosted AEGIS deployments.|

## Event-shape support

| Event source              | Tested |
|---------------------------|--------|
| API Gateway HTTP API (v2) | ✓      |
| API Gateway REST API (v1) | ✓      |
| ALB (multi-value headers) | ✓      |
| Lambda Function URLs      | ✓ (same shape as v2) |

Header lookup is case-insensitive — the wrapper normalizes across the
quirks of API Gateway v1 vs v2 vs ALB.

## Options

| Option           | Type                                                      | Default            |
|------------------|-----------------------------------------------------------|--------------------|
| `handler`        | `(event, ctx) => LambdaResult`                            | **required**       |
| `minTrustBand`   | `'FLAGGED'\|'WATCH'\|'VERIFIED'\|'PLATINUM'`              | none |
| `tokenHeader`    | `string`                                                  | `'x-aegis-token'`  |
| `deriveContext`  | `(event) => VerifyContext`                                | none |
| `client`         | `Aegis`                                                   | env-built |

## Status

**0.1.0-preview.** Seeded in Round 25 — see [docs/SEEDS.md](../../docs/SEEDS.md).

## License

MIT — © KLYTICS / AEGIS Labs.
