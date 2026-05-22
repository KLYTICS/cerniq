# OKORO ↔ MCP Integration Guide

**Status**: design, ready to implement
**Owners**: M-021 (mcp-server impl), M-022 (mcp module CRUD wiring)
**Related ADRs**: [ADR-0008 — MCP as control plane](../decisions/0008-mcp-as-control-plane.md), [ADR-0003 — Portable verify path](../decisions/0003-portable-verify-path.md), [ADR-0010 — DPoP](../decisions/0010-dpop-replay-prevention.md)
**Spec reference**: MCP Authorization, revision **2025-03-26** (current at time of writing). Operator must reconfirm against the live spec at <https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/authorization/> before public launch — see *Open questions* §4.

> **Doc-build blocker (must clear before publish):** WebFetch was denied in the working environment that drafted this file, so the spec quotations below are reproduced from prior knowledge of the 2025-03-26 revision. A reviewer with network access must diff this file against the live spec before we tell relying parties it is authoritative.

---

## 1. How MCP authorization works in the 2025-03 spec (one paragraph)

The 2025-03-26 revision of the MCP Authorization specification adopts **OAuth 2.1** (draft-ietf-oauth-v2-1) as the security model for HTTP-based MCP transports (`streamable-http` and the legacy `sse` transport); the `stdio` transport sits outside the spec because it is local-only. The MCP **server is the OAuth resource server**; the MCP **client is a confidential or public OAuth client**; the **authorization server (AS) may be the MCP server itself or a third-party** and is discovered via OAuth 2.0 Authorization Server Metadata (RFC 8414) at `/.well-known/oauth-authorization-server`. PKCE (RFC 7636) is **mandatory** for all clients (S256 only). Dynamic Client Registration (RFC 7591) at `/register` is **recommended** so an MCP client can self-onboard without out-of-band credentialing. Access tokens are passed on every JSON-RPC request as `Authorization: Bearer <token>`; the spec is **token-format agnostic** — opaque tokens require RFC 7662 introspection, JWTs can be locally verified via JWKS at `/.well-known/jwks.json`. The authorization code flow with PKCE is the only fully-specified user-facing flow; client credentials and token exchange (RFC 8693) are permitted but out of scope for the base profile.

That paragraph is the lens for everything below. OKORO slots into this picture in three different positions, and they have different operational and trust trade-offs.

---

## 2. Three integration patterns

| Pattern | OKORO role | MCP server change | Auth0 needed? | Token shape | Best for |
|---|---|---|---|---|---|
| **(a) OKORO as Authorization Server** | OAuth 2.1 AS for the MCP server | Verify our JWT, trust our metadata | No (or yes for human consent step) | EdDSA JWT signed by OKORO audit key | New MCP servers, OKORO-native shops |
| **(b) OKORO as token verifier** | Sidecar verifier the MCP server calls before tool execution | Add `okoro.verify()` call in the tool handler (or `wrapMcpHandler` from `@okoro/mcp-bridge`) | No, MCP server keeps its own AS | Whatever the MCP server's AS issues, plus OKORO agent token | Existing MCP servers that already have an AS |
| **(c) OKORO-signed JWT, JWKS-verified** | Pure issuer of EdDSA JWTs, no runtime call | Verify JWT via `/.well-known/jwks.json` cache | No | EdDSA JWT signed by OKORO audit key (same as (a)) | High-throughput / edge MCP servers, p99-sensitive |

### Trade-offs

#### (a) OKORO as the OAuth 2.1 Authorization Server

**Pros**
- Single source of truth: agent identity, policy, and OAuth all live in OKORO. The MCP server only knows how to verify a token.
- Implements the full spec — `/authorize`, `/token`, `/.well-known/oauth-authorization-server`, `/register`, `/jwks.json` — meaning *any* spec-conformant MCP client (Claude Desktop, Cursor, Cline, future hosts) works without per-server SDK changes.
- BATE signals (denial reasons, anomaly flags) bubble through the OAuth error responses (`invalid_grant`, `access_denied`) so MCP clients get a standard error shape.

**Cons**
- We commit to running an OAuth 2.1 surface, including the human-consent screen for the authorization-code flow. This is **the most code we have to write** (estimated 2–3 weeks per WORK_BOARD M-021).
- Adds a stateful AS to OKORO: authorization-code storage, refresh-token rotation, client-credentials store. ADR-0009 says human identity is Auth0's job — for the consent screen we **delegate the user-auth step to Auth0** and then mint our own OKORO access token. See §3 pattern (a) step 4.
- DPoP (ADR-0010) becomes mandatory for the issued tokens; relying parties on the MCP side need a DPoP-aware verifier. Acceptable cost, just visible.

**Recommended when:** the operator owns the MCP server (e.g. an internal "FORGE-tools" MCP server, or a customer who is greenfielding) and wants the cleanest end-to-end story.

#### (b) OKORO as token verifier (sidecar)

**Pros**
- **Zero changes to the MCP server's auth.** Operator keeps Okta / Auth0 / their own AS for the human-or-machine login part; OKORO verifies the *agent identity* on top.
- Two independent signals — "this client passed our OAuth" + "this agent is in good standing per OKORO" — defense in depth.
- Already implemented as a skeleton: `packages/mcp-bridge/src/index.ts` `wrapMcpHandler()`. One `import` and one `wrap()` call per tool handler.
- Compatible with stdio transport (where the OAuth flow is undefined) because the OKORO token rides in `params._okoro_token` per `extractToken()` in the bridge.

**Cons**
- Two tokens on every call. Marginally heavier wire and more failure modes ("OAuth said yes but OKORO said no" UX).
- The MCP server still has to operate its own AS — none of that complexity goes away for the operator.
- Latency: every tool call triggers a network round-trip to OKORO `/v1/verify`. Mitigate with the Phase-3 Cloudflare Workers edge per ADR-0003.

**Recommended when:** the MCP server already has a working OAuth setup the operator does not want to disturb (most third-party servers in 2026).

#### (c) OKORO-signed JWT, JWKS-verified locally

**Pros**
- **Zero round-trip.** The MCP server downloads `https://okoro.dev/.well-known/jwks.json` once, caches it (TTL from `Cache-Control: max-age=86400` per `wellknown.controller.ts`), and verifies every request locally. p99 verification is sub-millisecond.
- Works at the edge (Cloudflare Workers, Vercel Edge, Deno Deploy) without an OKORO dependency in the hot path.
- The token still encodes scope, principal, agent id, and `cnf.jkt` for DPoP, so the MCP server has everything it needs to enforce policy locally.
- This is the *same JWT shape* as (a) — pattern (c) is just (a) without the round-trip-on-every-call. An MCP server can start at (a) and migrate to (c) by flipping a config flag.

**Cons**
- **Revocation lag.** A revoked agent or expired policy is honored only when the JWT TTL elapses (60 s default per ADR-0010). Acceptable for tool calls, **not** acceptable for high-value commerce — those should layer (b) on top.
- BATE trust score is fixed at issue time, not refreshed. Patterns (a) and (b) get fresh scores per call.
- The MCP server has to implement EdDSA JWT verification — most JWT libraries support it (jose, jsonwebtoken with @noble/ed25519, golang-jwt) but it is not the default in older stacks.

**Recommended when:** the MCP server is latency-critical and the operator accepts ≤60 s revocation lag, or as the *outer* layer in a (b)+(c) stack ("verify JWT signature locally, then call `/v1/verify` only for high-risk actions").

### Default recommendation

**Pattern (b) is the default for v1.** It maps 1:1 to the existing `@okoro/mcp-bridge` skeleton (one `wrap()` call, no spec ceremony), keeps revocation immediate, and does not require us to ship an OAuth 2.1 AS implementation in the same release as the verify-path hardening. Pattern (a) ships in a follow-on (M-021) once the AS surface is cut and audited. Pattern (c) is a deployment switch on top of (a), flipped per-relying-party from the dashboard.

---

## 3. Concrete integration steps (10 steps each)

### Pattern (a) — OKORO as OAuth 2.1 AS for an MCP server

1. **MCP server operator registers their server with OKORO.** `POST /v1/mcp-servers` (existing in `mcp.controller.ts`) with `endpoint`, `transport: 'streamable-http'`, `actionPrefix`, `minTrustBand`. Returns an `mcp_<ulid>` id.
2. **OKORO provisions an OAuth client record** (NEW — M-021). Per the AS-metadata standard (RFC 8414), OKORO exposes the metadata document at `https://okoro.dev/.well-known/oauth-authorization-server` containing `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `jwks_uri`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code", "refresh_token", "client_credentials", "urn:ietf:params:oauth:grant-type:token-exchange"]`.
3. **MCP server points its `WWW-Authenticate` challenge at the OKORO metadata URL.** When an unauthenticated request arrives the server replies `401 WWW-Authenticate: Bearer realm="okoro", as_uri="https://okoro.dev/.well-known/oauth-authorization-server"`. Spec-conformant clients (Claude Desktop ≥ 2025-04, Cursor ≥ 0.45, Cline ≥ 3.0) parse this and start the auth flow.
4. **MCP client performs Dynamic Client Registration** (RFC 7591) against `POST /v1/oauth/register` (NEW). OKORO returns `client_id`, `client_secret` (only for confidential clients), `registration_access_token`. Public-client / native MCP clients (Claude Desktop) get no secret.
5. **MCP client starts authorization-code + PKCE flow.** Browser opens `GET /v1/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&scope=mcp:tools.invoke&state=...`.
6. **OKORO delegates the human consent step to Auth0** (per ADR-0009). The `/v1/oauth/authorize` handler checks for an active Auth0 session cookie; if absent, redirects to Auth0 Universal Login. After Auth0 callback, OKORO shows the consent screen ("MCP server X wants to invoke tools on behalf of agent Y owned by you"), records consent in `OAuthConsent` table, and 302s back to the MCP client's `redirect_uri` with `code=<authorization_code>`.
7. **MCP client exchanges the code for tokens.** `POST /v1/oauth/token` with `grant_type=authorization_code&code=...&code_verifier=...&client_id=...`. OKORO validates PKCE, issues an EdDSA JWT (`access_token`, 60 s TTL) signed by the audit key, plus a refresh token. JWT carries `iss`, `sub: <agentId>`, `aud: <mcpServerId>`, `scope`, `cnf: { jkt: <DPoP thumbprint> }` (if DPoP), `principalId`, `trustBand` claims.
8. **MCP client invokes tools with the token.** Every JSON-RPC request includes `Authorization: Bearer <jwt>` and (per ADR-0010) `DPoP: <proof-jwt>`.
9. **MCP server verifies the JWT.** Either via `@okoro/mcp-bridge.wrapMcpHandler({ okoro, mode: 'jwks' })` (local verify, pattern (c)) or by calling `POST /v1/verify` (round-trip, pattern (b) hybrid). Both paths share the same algorithm via `verify.algorithm.ts` per ADR-0003.
10. **OKORO audits every issuance.** `OAuthIssuance` audit row per token, signed via the audit chain (ADR-0005). Refresh-token rotation logged as `oauth.refresh`. Revocation via `POST /v1/oauth/revoke` (RFC 7009) — flips `revoked=true` and posts an audit event; pattern-(c) consumers see staleness only until JWT TTL elapses.

### Pattern (b) — OKORO as a sidecar verifier

1. **MCP server operator keeps their existing AS** (Auth0, Okta, Keycloak, custom). No change to the human-or-machine login flow.
2. **MCP server operator registers the server with OKORO:** `POST /v1/mcp-servers` (same as pattern (a) step 1). The registration is what gives the server an `mcp_<ulid>` audit slice.
3. **MCP server adds the OKORO verifier package** to dependencies: `pnpm add @okoro/mcp-bridge @okoro/sdk`.
4. **MCP server wraps each tool handler:**
   ```ts
   import { wrapMcpHandler } from '@okoro/mcp-bridge';
   import { Okoro } from '@okoro/sdk';
   const okoro = new Okoro({ apiKey: process.env.OKORO_VERIFY_KEY });
   server.setRequestHandler(ToolSchema, wrapMcpHandler(
     { okoro, actionPrefix: 'mcp.fs.', minTrustBand: 'VERIFIED' },
     async (req, ctx) => readFile(req.params.path),
   ));
   ```
5. **Agent (the MCP client side) acquires an OKORO token** via the SDK: `await okoro.agent.sign({ action: 'mcp.fs.read_file', amount: null })`. This is the existing flow; no MCP-specific changes.
6. **Agent passes the token alongside the MCP server's own auth.** For `streamable-http` transport: `Authorization: Bearer <mcp-server-token>` AND `X-OKORO-Token: <okoro-token>` (header constant `OKORO_HEADER_TOKEN` from `@okoro/types`). For `stdio`: OKORO token rides in `params._okoro_token` per the bridge's `extractToken()`.
7. **MCP server's transport authenticates the request** via its existing AS (no OKORO involvement).
8. **The bridge intercepts before the tool handler runs**, calls `okoro.verify(token, { action: 'mcp.fs.<method>' })` against `POST /v1/verify`, and either invokes the tool or throws `BridgeDenialError` with the OKORO denial reason.
9. **OKORO records the verify** with `relyingPartyId = mcp_<ulid>` (M-022 wiring) so the dashboard can show "MCP server X invoked Y tools today, Z denied."
10. **Operator monitors via `GET /v1/mcp-servers` and audit search.** Revocation: `DELETE /v1/mcp-servers/:id` flips status to `REVOKED`; subsequent verifies for that server return `denial=AGENT_NOT_FOUND` (the bridge can opt in to a different reason if it tracks server-side state).

### Pattern (c) — OKORO-signed JWT, JWKS-verified

1. **OKORO publishes its JWKS** (already live: `wellknown.controller.ts` `GET /.well-known/jwks.json`). EdDSA / Ed25519 public key, `kid` is the audit-key thumbprint, `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.
2. **MCP server operator registers** as in pattern (b) step 2 — registration gives the audit-trail wiring even when the verify path is local.
3. **Agent acquires an OKORO access token** from `POST /v1/oauth/token` with `grant_type=client_credentials&audience=<mcpServerId>` (NEW endpoint — pattern (a) infrastructure). Returns an EdDSA JWT.
4. **Agent invokes the MCP tool** with `Authorization: Bearer <jwt>` and a DPoP proof.
5. **MCP server fetches and caches the JWKS** at startup. In Node: `import { createRemoteJWKSet, jwtVerify } from 'jose'; const jwks = createRemoteJWKSet(new URL('https://okoro.dev/.well-known/jwks.json'));`. The `jose` library honors `Cache-Control` automatically.
6. **MCP server verifies the JWT locally** on every call: `const { payload } = await jwtVerify(token, jwks, { issuer: 'https://okoro.dev', audience: mcpServerId, algorithms: ['EdDSA'] });`. Reject if `payload.cnf.jkt` doesn't match the DPoP proof's JWK thumbprint.
7. **MCP server enforces scope and trust band locally** from the JWT claims (`scope`, `trustBand`, `principalId`).
8. **MCP server schedules a periodic `GET /v1/agents/:agentId/status`** (5-minute cadence) for any long-lived session — this is the staleness mitigation for revocation. Optional: subscribe to webhook `okoro.agent.trust_score_changed` for push.
9. **For high-risk actions** (`amount > $threshold` or `scope ∈ commerce.*`), the MCP server falls through to pattern (b) — call `POST /v1/verify` for a fresh decision. This is the "(c) outer, (b) inner" stack the §2 default talks about.
10. **MCP server reports anomalies back** via `POST /v1/agent/:agentId/report` with `eventType: 'anomaly'` and evidence — this is what feeds BATE so other relying parties get the signal.

---

## 4. Open questions for operator

1. **Spec verification.** WebFetch was denied; a reviewer with network access must diff §1 above against the live 2025-03-26 spec before this doc goes public. Specifically confirm: (a) is dynamic client registration `MUST` or `SHOULD` for MCP clients, (b) is PKCE `S256` mandatory or is `plain` still permitted as a fallback for non-confidential clients, (c) what is the canonical AS-discovery URL — `oauth-authorization-server` or `openid-configuration`.
2. **OAuth AS scope (pattern (a)).** Do we ship the AS as part of v1 (M-021), or wait until at least one customer asks for it? Pattern (b) covers most use cases without it. Recommendation: defer to v1.1.
3. **JWT audience policy.** Should an OKORO-issued JWT be valid for a *single* MCP server (`aud: mcp_01HZ...`) or for any MCP server the principal owns (`aud: <principalId>`)? Single-server is safer, multi-server is friendlier. Recommendation: single-server, with a `aud_list` extension claim if multi-server is needed.
4. **DPoP vs. mTLS for MCP-server-side trust.** Pattern (c) leans on DPoP per ADR-0010. For high-assurance customers (banks, govt), do we also offer mTLS as an alternate proof-of-possession? Open until a customer asks.
5. **Consent UX.** Pattern (a) step 6 needs a consent screen. Where does it live — `apps/dashboard` (which already has Auth0 for the operator) or a separate `apps/consent` route? Recommendation: subroute of dashboard at `/consent/oauth/:request_id`.
6. **Refresh-token lifetime.** Default 30 days is OAuth norm; OKORO short-lived ethos suggests 24 hours. Open. Recommendation: 7 days, rotated on every use, revocable per agent.
7. **Token introspection (RFC 7662).** Required for opaque-token relying parties; not needed if everyone is on JWT pattern (c). Defer until a customer needs opaque tokens.

---

## 5. Required new code

All new code lives under `apps/api/src/modules/mcp/` and a new sibling `apps/api/src/modules/oauth/`. The `wellknown` module gains one new route. The `auth` module gains an OAuth-aware guard variant.

### New files

| File | Purpose | Pattern enabled |
|---|---|---|
| `apps/api/src/modules/oauth/oauth.module.ts` | Nest module wiring the AS surface | (a), (c) |
| `apps/api/src/modules/oauth/oauth.controller.ts` | HTTP routes — `/authorize`, `/token`, `/register`, `/revoke`, `/introspect` | (a) |
| `apps/api/src/modules/oauth/oauth.service.ts` | Code/token issuance, PKCE verify, refresh rotation | (a) |
| `apps/api/src/modules/oauth/oauth-client.service.ts` | RFC 7591 client registration + lookup | (a) |
| `apps/api/src/modules/oauth/oauth-consent.service.ts` | Consent screen state + `OAuthConsent` rows | (a) |
| `apps/api/src/modules/oauth/dto/*.ts` | Zod-validated DTOs for each endpoint | (a) |
| `apps/api/src/modules/oauth/oauth-token.util.ts` | EdDSA JWT mint + `cnf.jkt` binding (calls existing `crypto/audit-chain`) | (a), (c) |
| `apps/api/src/modules/oauth/oauth.service.spec.ts` | Unit tests | (a) |
| `apps/api/src/modules/oauth/oauth.controller.e2e.spec.ts` | Spec-conformance tests against the AS metadata document | (a) |
| `apps/api/src/modules/wellknown/oauth-as-metadata.controller.ts` | Serves `/.well-known/oauth-authorization-server` (RFC 8414) | (a) |
| `apps/api/src/modules/mcp/mcp.discovery.controller.ts` | `GET /v1/mcp-servers/:id/manifest` — proxies the registered manifest URL with caching | (b), (c) |
| `apps/api/src/modules/mcp/mcp-verify.controller.ts` | `POST /v1/mcp-servers/:id/verify` — convenience wrapper around `/v1/verify` that stamps `relyingPartyId` automatically (saves the bridge a parameter) | (b) |
| `packages/mcp-server/` (NEW package) | The `@okoro/mcp-server` distribution — exposes OKORO API as MCP tools per ADR-0008 §1.2 | inverse direction |

### New endpoints (summary)

```
# Pattern (a) — AS surface
GET    /.well-known/oauth-authorization-server     RFC 8414 metadata
POST   /v1/oauth/register                          RFC 7591 client registration
GET    /v1/oauth/authorize                         Authorization-code initiation (delegates to Auth0)
POST   /v1/oauth/token                             grant_type ∈ {authorization_code, refresh_token,
                                                                 client_credentials, token-exchange}
POST   /v1/oauth/revoke                            RFC 7009 revocation
POST   /v1/oauth/introspect                        RFC 7662 introspection (deferred)

# Pattern (b) — sidecar
POST   /v1/mcp-servers/:id/verify                  Convenience verify (stamps relyingPartyId)

# Pattern (c) — JWKS
GET    /.well-known/jwks.json                      EXISTS (wellknown.controller.ts)
                                                   New claim shape: cnf, scope, trustBand, principalId

# Discovery
GET    /v1/mcp-servers/:id/manifest                Proxied tools/list manifest, 1-hour cache
```

### Schema additions (Prisma — coordinate with M-026)

```prisma
model OAuthClient {
  id                    String   @id           // client_id
  clientSecretHash      String?                 // null for public clients
  registrationToken     String   @unique
  redirectUris          String[]
  grantTypes            String[]
  tokenEndpointAuthMethod String  @default("client_secret_basic")
  principalId           String                  // owner
  mcpServerId           String?                 // optional bind-on-create
  createdAt             DateTime @default(now())
  revokedAt             DateTime?
  @@index([principalId])
}

model OAuthAuthorizationCode {
  code                  String   @id           // ULID, single-use
  clientId              String
  agentId               String
  principalId           String
  scope                 String
  codeChallenge         String
  codeChallengeMethod   String                  // "S256"
  redirectUri           String
  expiresAt             DateTime                // 60 s TTL
  consumedAt            DateTime?
  @@index([expiresAt])
}

model OAuthRefreshToken {
  id                    String   @id
  hash                  String   @unique
  clientId              String
  agentId               String
  principalId           String
  scope                 String
  cnfJkt                String?                 // DPoP binding
  rotatedFromId         String?
  expiresAt             DateTime
  revokedAt             DateTime?
  @@index([clientId, agentId])
}

model OAuthConsent {
  id                    String   @id
  principalId           String                  // human (Auth0 sub via principal binding)
  agentId               String
  clientId              String
  scope                 String
  grantedAt             DateTime @default(now())
  revokedAt             DateTime?
  @@unique([principalId, agentId, clientId, scope])
}
```

### Reuse from existing code

- `wellknown.service.ts` `getJwks()` — extend its `kid` rotation logic to surface OAuth-issuance keys.
- `verify.algorithm.ts` (peer-owned per ADR-0003) — token verification path is shared between `/v1/verify` (REST), `/v1/mcp-servers/:id/verify` (sidecar convenience), and the OAuth `/token` validation step.
- `audit.service.append()` — every OAuth issuance, refresh, and revocation goes through this. No exceptions.
- `Auth0Service.exchangeToken()` — pattern (a) step 6 reuses this verbatim for the human consent step.
- `packages/mcp-bridge` — already implements pattern (b) end-to-end. Pattern (c) adds a `mode: 'jwks'` config to `wrapMcpHandler` that swaps the network call for a local `jwtVerify`.

### Wiring touchpoints

- `app.module.ts` — register `OAuthModule`. ApiKeyGuard already excludes `.well-known/*` per `wellknown.controller.ts`; add `/v1/oauth/(authorize|token|register)` to the same exclusion list.
- `config/config.schema.ts` — add `OAUTH_ISSUER` (default `https://okoro.dev`), `OAUTH_AUTHORIZATION_CODE_TTL_S=60`, `OAUTH_REFRESH_TTL_S=604800`, `OAUTH_REQUIRE_DPOP=true`.
- `packages/types/src/constants.ts` — add `OAUTH_GRANT_TYPES`, `OAUTH_SCOPES_MCP` (e.g. `mcp:tools.invoke`, `mcp:resources.read`, `mcp:prompts.list`).

---

## References

- ADR-0008 — MCP as control plane (`docs/decisions/0008-mcp-as-control-plane.md`)
- ADR-0009 — Auth0 bridge (`docs/decisions/0009-auth0-bridge.md`)
- ADR-0010 — DPoP replay prevention (`docs/decisions/0010-dpop-replay-prevention.md`)
- MCP spec rev 2025-03-26: <https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/authorization/>
- OAuth 2.1: <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1>
- RFC 8414 (AS metadata): <https://datatracker.ietf.org/doc/html/rfc8414>
- RFC 7591 (Dynamic Client Registration): <https://datatracker.ietf.org/doc/html/rfc7591>
- RFC 7636 (PKCE): <https://datatracker.ietf.org/doc/html/rfc7636>
- RFC 9449 (DPoP): <https://www.rfc-editor.org/rfc/rfc9449>
- Existing skeletons:
  - `apps/api/src/modules/mcp/mcp.controller.ts` — registry CRUD
  - `apps/api/src/modules/mcp/mcp.service.ts` — registry service
  - `apps/api/src/modules/wellknown/wellknown.controller.ts` — JWKS surface
  - `packages/mcp-bridge/src/index.ts` — `wrapMcpHandler` (pattern (b) implementation)
