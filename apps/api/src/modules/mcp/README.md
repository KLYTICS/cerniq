# MCP control-plane module

Implements ADR-0008. Manages the registry of trusted MCP servers per
principal. Each registration tells AEGIS:

- *who* runs this MCP server (`principalId`)
- *where* it lives (`endpoint`, `transport`)
- *what* tools it exposes (`actionPrefix`, optional `manifestUrl`)
- *how trusted* its callers must be (`minTrustBand`)

Verify-time wiring (so `relyingPartyId` is stamped on audit events when
a tool call goes through `@aegis/mcp-bridge`) is delivered by M-022 —
peer holds the verify path.

## Endpoints

```
POST   /v1/mcp-servers
GET    /v1/mcp-servers
DELETE /v1/mcp-servers/:id
```

All require ApiKeyGuard. Per-principal isolation via `req.principalId`.

## Files to follow up

- `mcp.service.spec.ts` — unit tests with mocked Prisma + Audit (M-022).
- `mcp.controller.e2e.spec.ts` — full-stack test (M-022).
- `M-026` Prisma migration: `RelyingPartyKind = HTTP_API | MCP_SERVER | OTHER`,
  plus `AuditEvent.relyingPartyId` foreign key.

## Cast: `kind: 'MCP_SERVER' as never`

Until M-026 lands the new Prisma enum value, the writes use a runtime
cast. This is intentional and documented — TypeScript will reject the
cast as soon as the schema regenerates the enum, at which point peer's
M-026 PR also drops the `as never` in this module.

## Reference

- ADR-0008: `docs/decisions/0008-mcp-as-control-plane.md`
- Bridge package: `packages/mcp-bridge/`
- Server package: `packages/mcp-server/` (this session)
