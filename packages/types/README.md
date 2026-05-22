# @okoro/types

Shared API contract for OKORO — Zod schemas + inferred TypeScript types.

This package is the single source of truth for request/response shapes
across the OKORO API, the official SDKs, and the developer dashboard.
Every other workspace consumes types from here.

## Stability

Every schema exported from `./schemas` is part of the public OKORO API
contract. Breaking changes require a coordinated SDK version bump and a
`BREAKING` entry in CHANGELOG.

## Usage

```ts
import { VerifyRequestSchema, type VerifyResponse } from '@okoro/types';

const parsed = VerifyRequestSchema.parse(body); // throws on invalid
```

See `docs/spec/OKORO_API_SPEC.yaml` for the OpenAPI mirror.
