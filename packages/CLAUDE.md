# CERNIQ Packages - Claude contract

This directory owns public and shared packages: `@cerniq/types`, `@cerniq/sdk`,
`cerniq` Python SDK, `@cerniq/cli`, `@cerniq/verifier-rp`, `@cerniq/mcp-server`,
`@cerniq/mcp-bridge`, shared tsconfig, and eslint config.

## Package invariants

- Public package APIs are contracts. Preserve backward compatibility unless the
  task explicitly includes a versioned breaking change.
- Runtime portability matters. Browser/edge packages must not import Node-only
  APIs. Relying-party middleware must keep framework adapters optional.
- `packages/types` is the wire-contract source of truth. Update OpenAPI, API
  DTOs, generated enums, SDK types, and parity tests together.
- SDKs hold private keys locally but never send them to CERNIQ.
- Error classes and denial reasons must match the API catalog exactly.
- Package builds should be tree-shakeable and side-effect-light.

## Per-package notes

| Path           | Standard                                                            |
| -------------- | ------------------------------------------------------------------- |
| `types/`       | Zod schemas, constants, generated catalogs, OpenAPI parity          |
| `sdk-ts/`      | Browser/edge-safe TS SDK, no Node-only crypto assumptions           |
| `sdk-py/`      | Python 3.11+, pydantic v2, strict mypy, typed HTTP errors           |
| `cli/`         | Operator workflows, no secret echoing, scriptable output            |
| `verifier-rp/` | Offline verification, JWKS cache, replay defense, optional adapters |
| `mcp-server/`  | Tools exposed to MCP hosts, precise schemas and safe errors         |
| `mcp-bridge/`  | Middleware boundary around MCP calls, minimal assumptions           |

## Required verification

Use package-specific filters:

- `pnpm --filter @cerniq/types typecheck && pnpm --filter @cerniq/types test`
- `pnpm --filter @cerniq/sdk typecheck && pnpm --filter @cerniq/sdk test`
- `pnpm --filter @cerniq/verifier-rp typecheck && pnpm --filter @cerniq/verifier-rp test`
- `pnpm --filter @cerniq/mcp-server typecheck && pnpm --filter @cerniq/mcp-server test`
- `pnpm --filter @cerniq/mcp-bridge typecheck && pnpm --filter @cerniq/mcp-bridge test`
- `cd packages/sdk-py && python -m pytest` when Python dependencies are installed

Run `pnpm test:parity` when a package contract must agree with API, dashboard,
OpenAPI, or generated files.
