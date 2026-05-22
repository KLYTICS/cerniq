# OKORO ↔ Auth0 Integration Guide

**Status**: design, ready to implement
**Owners**: M-019 (auth0 module impl), M-020 (dashboard auth wiring), M-026 (Prisma schema for OAuth/IDP fields)
**Related ADRs**: [ADR-0009 — Auth0 bridges human identity](../decisions/0009-auth0-bridge.md), [ADR-0008 — MCP as control plane](../decisions/0008-mcp-as-control-plane.md), [ADR-0002 — Non-custodial keys](../decisions/0002-non-custodial-key-policy.md)
**Spec references**: RFC 8693 (OAuth 2.0 Token Exchange), Auth0 docs on Application Grant Types, Auth0 Actions, Auth0 Organizations.

> **Doc-build blocker (must clear before publish):** WebFetch was denied in the working environment that drafted this file, so the Auth0 capabilities and RFC 8693 quotations below are reproduced from prior knowledge of the standards as of January 2026. A reviewer with network access must reconfirm against <https://auth0.com/docs/get-started/applications/application-grant-types> and <https://datatracker.ietf.org/doc/html/rfc8693> before relying parties code against this contract. Specifically: confirm whether Auth0 has GA'd "Custom Token Exchange" by the implementation date — if yes, prefer Flow A in §3; if no, fall back to Flow B (OKORO-side exchange).

---

## 1. The composition model (one paragraph)

**Auth0 owns humans; OKORO owns agents.** Auth0 authenticates the operator/admin/compliance officer who logs into the OKORO dashboard, manages enterprise SSO, MFA, SCIM, and the SOC2 audit trail of *human* logins. OKORO authenticates the agents that those humans register, signs short-lived EdDSA tokens for those agents, scores their behavior via BATE, and signs the audit chain of *agent* actions. The two surfaces are deliberately separate: ADR-0009 §5 forbids Auth0 from touching the verify hot path (`/v1/verify` is for agents only via `ApiKeyGuard`) and forbids OKORO from holding human credentials. The composition is "Auth0 user logs in → OKORO principal is bound → human registers agent → OKORO signs tokens that OKORO verifies — Auth0 is never round-tripped on agent calls." This means an Auth0 outage degrades dashboard access but never blocks agent verification, and an OKORO audit log row tells you both the human (`auth0|sub`) and the agent (`agent_<ulid>`) responsible for any action.

---

## 2. Auth0 tenant → OKORO Principal lifecycle

The mapping is **Auth0 Organization (`org_id`) ↔ OKORO Principal**, *not* Auth0 user ↔ Principal. A single Principal contains many human users (the org's employees) and many agents (the org's bots). This matches the multi-tenant `principalId` invariant from CLAUDE.md §5.

### Lifecycle states

```
        Auth0 Organization
              │
              │  (1) human first authenticates via Universal Login
              ▼
   ┌──────────────────────┐                ┌──────────────────────┐
   │  Auth0 Action fires  │  ───  POST  ──▶│  /v1/idp/auth0/action│
   │ okoro-audit-login.js │                │  Auth0Service        │
   └──────────────────────┘                └────────┬─────────────┘
                                                    │
              (2) ensurePrincipalForOrg             │
                  - lookup Principal by             │
                    (idpProvider='auth0',           ▼
                     idpOrganizationId=org_id)  ┌─────────────────┐
              (3) if absent, create:           │  Principal row  │
                  id = `p_a0_<sha256(org)[:12]>` │  created/found │
                  idpDomain = org domain        │                 │
                                                └─────────────────┘
                                                         │
              (4) audit row appended (action='auth0.login',
                  decision='APPROVED' or 'FLAGGED' if MFA missing)
                                                         │
              (5) Action returns; Auth0 finishes login   │
                  with extra app_metadata stamped:       │
                  { okoro_principal_id, okoro_roles }    │
                                                         ▼
                                          dashboard receives session
                                          with Auth0 access token
                                          containing okoro_principal_id
```

### Step-by-step (matches `auth0.adapter.ts` `ensurePrincipalForOrg()`)

1. **Operator creates an Auth0 Organization** for the customer (manual or via Auth0 Mgmt API in onboarding). Sets the org's `display_name` and connects identity providers (SAML, OIDC, Google Workspace, etc.).
2. **First human in the org logs in.** Auth0 Universal Login → identity provider → callback to Auth0.
3. **`okoro-audit-login.js` Action runs** in the Auth0 `post-login` flow trigger (see §4 for source). It calls `POST /v1/idp/auth0/action` with the user's `sub`, `org_id`, `email`, `email_verified`, `mfa` flag, `roles`, IP, UA. Authenticates with shared secret in `X-Auth0-Action-Secret`.
4. **`Auth0Service.handleActionLogin()` upserts the Principal** via `Auth0Adapter.ensurePrincipalForOrg({ idpOrganizationId, idpDomain })`. Principal id is deterministic: `p_a0_<sha256("auth0:" + org_id)[:12]>` so a re-create is idempotent.
5. **Action stamps `app_metadata.okoro_principal_id` on the user** so subsequent Auth0 access tokens carry it as a custom claim.
6. **Subsequent logins skip the create branch.** `ensurePrincipalForOrg` returns `{ created: false }`. The audit row is still written every time — the audit chain (ADR-0005) tracks every human login.
7. **Human revokes their own access** via Auth0 (block user, remove from org). OKORO Principal stays — it represents the org, not the user — but the user can no longer obtain a token for it.
8. **Org-level offboarding.** Operator calls `DELETE /v1/principals/:id` (NEW — M-026). This soft-deletes the Principal (`status='SUSPENDED'`), revokes all agents owned by the principal (cascades through agent service), and writes a chain of audit rows. Auth0 org is independently disabled by the operator.

### Role mapping

Auth0 custom claim `https://okoro.dev/roles` carries one or more of:

| Auth0 role | OKORO capability |
|---|---|
| `okoro:admin` | Full CRUD on agents, policies, MCP servers, billing. Can rotate API keys. |
| `okoro:operator` | CRUD on agents and policies. Cannot touch billing or MCP server registry. |
| `okoro:viewer` | Read-only on dashboard, audit log, BATE scores. |
| `okoro:auditor` | Read-only on the audit chain + verifier signature key. Pinned scope; no other privileges. |

Role assignment is done in Auth0 (Auth0 Roles + Organization Roles). OKORO reads them; OKORO does not write back. This keeps Auth0 the source of truth for human RBAC.

### Pending operator decisions

- **OD-009** (from `auth0/README.md`): finalize the custom-claim namespace. Current default `https://okoro.dev/`. Recommend keeping; matches our public domain.
- **OD-010**: enforce MFA hard-fail for `okoro:admin` at Action time, or warn-only? Current code paths log `decision: 'FLAGGED'` and let the login through. Recommend hard-fail in production, warn-only in dev.

---

## 3. Token exchange flow (RFC 8693)

The use case: a developer or admin has an Auth0 access token (from logging into the dashboard) and wants to obtain either (i) an OKORO API key for SDK use or (ii) an OKORO-signed agent-identity token to bootstrap a new agent. RFC 8693 ("OAuth 2.0 Token Exchange") is the standards-track answer; the parameters and response are defined there.

There are **two flow variants** depending on whether Auth0 itself can act as an RFC 8693 token-exchange endpoint:

### Flow A — Auth0 native token exchange (preferred, if available)

Auth0 has historically not exposed the public `urn:ietf:params:oauth:grant-type:token-exchange` grant on the standard `/oauth/token` endpoint. As of late 2025, Auth0 announced **Custom Token Exchange** (Auth0 Actions runtime) and **Token Vault** for federated identity. **The reviewer must verify GA status before committing** — if it is GA, OKORO configures Auth0 as the exchange endpoint and we issue an OKORO-signed token via an Action. If it is not GA, use Flow B below.

```
1. Dashboard has Auth0 access token  AT_h  (audience = api.okoro.dev)
2. POST https://okoro.us.auth0.com/oauth/token
        grant_type=urn:ietf:params:oauth:grant-type:token-exchange
        subject_token=AT_h
        subject_token_type=urn:ietf:params:oauth:token-type:access_token
        audience=https://okoro.dev/agents
        scope=okoro:agent.create okoro:policy.create
        requested_token_type=urn:ietf:params:oauth:token-type:jwt
3. Auth0 Custom Token Exchange Action:
   - Verifies AT_h
   - Calls OKORO POST /v1/idp/auth0/exchange (existing endpoint)
   - Receives api_key_id + signed agent-bootstrap JWT
   - Returns { access_token: <jwt>, token_type: "Bearer", expires_in: 28800, issued_token_type: "urn:ietf:params:oauth:token-type:jwt" }
4. Dashboard / SDK uses the returned token as the OKORO API key
```

**Trade-offs:** Auth0 owns the exchange endpoint, which is conceptually clean (clients only ever talk to Auth0). The downside is operational coupling — every exchange is a synchronous Auth0 → OKORO call inside an Action; an Auth0 outage blocks new tokens.

### Flow B — OKORO-side exchange (fallback, default for v1)

This is what `Auth0Service.exchangeToken()` already does (see `auth0.service.ts` lines 60–95). The dashboard hits OKORO directly with the Auth0 access token; OKORO verifies the token via JWKS, looks up / creates the Principal, and returns an OKORO API key. **This is the recommended default for v1** because it requires no Auth0 GA dependency and survives Auth0 outages for already-issued OKORO keys (the OKORO key is independently valid for its 8-hour TTL).

```
1. Dashboard has Auth0 access token  AT_h
2. POST https://api.okoro.dev/v1/idp/auth0/exchange
   Content-Type: application/json
   {
     "access_token": "<AT_h>",
     "requested_token_type": "urn:ietf:params:oauth:token-type:jwt",  // future: opaque API key today
     "audience": "https://okoro.dev/agents",
     "scope": "okoro:agent.create okoro:policy.create"
   }
3. Auth0Service.exchangeToken():
   - idp.verifyAccessToken(AT_h)            // JWKS-cached RS256 verify (auth0.adapter.ts)
   - assert idpOrganizationId present
   - assert email_verified
   - ensurePrincipalForOrg → Principal
   - mint API key in ApiKey table (handed off to api-key.service.ts)
   - audit.append(action='auth0.exchange', decision='APPROVED')
4. Response (current shape per Auth0ExchangeResultDto):
   {
     "api_key_id":   "okoro_live_01HZ...",
     "principal_id": "p_a0_a1b2c3d4e5f6",
     "roles":        ["okoro:admin"],
     "expires_at":   "2026-05-02T08:00:00Z"
   }
   (NEW — extend with RFC 8693 fields when full conformance lands:)
     "access_token":      "<okoro-edsa-jwt>",
     "token_type":        "Bearer",
     "issued_token_type": "urn:ietf:params:oauth:token-type:jwt",
     "expires_in":        28800
```

**RFC 8693 conformance checklist** for Flow B:
- ✅ `subject_token` accepted (`access_token` field — rename to `subject_token` for strict conformance)
- ✅ `subject_token_type` (must accept `urn:ietf:params:oauth:token-type:access_token`)
- ⚠️ `actor_token` / `actor_token_type` — currently ignored; OKORO does not support delegation chains in v1 (deferred to ADR-future, multi-agent delegation per spec §6.3)
- ⚠️ `requested_token_type` — currently fixed to `api-key`; must accept `urn:ietf:params:oauth:token-type:jwt` once we mint EdDSA JWTs
- ✅ `audience`, `scope`, `resource` parameters accepted
- ✅ Error response shape per RFC 6749 §5.2 (`invalid_request`, `invalid_grant`, `invalid_target`)

**Recommendation**: implement Flow B with full RFC 8693 wire conformance now (rename `access_token` field to `subject_token` in the DTO, add the missing fields). Flow A becomes a thin Auth0 Action that posts to Flow B once Auth0 Custom Token Exchange goes GA — the OKORO-side surface is unchanged.

### Token-exchange grant in the OAuth AS (cross-reference to MCP doc)

The OAuth AS surface introduced for MCP pattern (a) (see `docs/integrations/mcp.md` §5) **also** exposes `urn:ietf:params:oauth:grant-type:token-exchange` at `POST /v1/oauth/token`. The semantics are identical to Flow B but on the standards-conformant `/oauth/token` URL. This means a relying party that only knows OAuth standards can do:

```
POST https://okoro.dev/v1/oauth/token
  grant_type=urn:ietf:params:oauth:grant-type:token-exchange
  subject_token=<Auth0 access token>
  subject_token_type=urn:ietf:params:oauth:token-type:access_token
  audience=https://okoro.dev
  scope=okoro:agent.create
```

Internally this routes to the same `Auth0Service.exchangeToken()` code path. No duplicate logic.

---

## 4. Required Auth0 application configuration

### Auth0 tenant-level setup

| Item | Value |
|---|---|
| Tenant region | US (default) — EU tenant for sovereignty customers per ADR-future |
| Default audience | `https://api.okoro.dev` |
| Custom claim namespace | `https://okoro.dev/` (per OD-009) |
| Token signing algorithm | RS256 (current) → EdDSA (when GA — see ADR-0009 §3) |
| Refresh token rotation | Enabled |
| Refresh token reuse interval | 0 (single-use) |

### Application configuration

Create one Auth0 Application per OKORO surface:

#### App 1 — `okoro-dashboard` (Single Page Application)

| Setting | Value |
|---|---|
| Application Type | Single Page Application |
| Token Endpoint Auth Method | None (PKCE-protected) |
| Allowed Callback URLs | `https://dashboard.okoro.dev/api/auth/callback`, `http://localhost:3000/api/auth/callback` |
| Allowed Logout URLs | `https://dashboard.okoro.dev`, `http://localhost:3000` |
| Allowed Web Origins | same |
| Grant Types | Authorization Code, Refresh Token, **Token Exchange** (Flow A) |
| OIDC Conformant | Yes |
| Cross-Origin Authentication | Off |

#### App 2 — `okoro-api` (Machine-to-Machine, optional — only if Auth0-managed M2M is needed)

| Setting | Value |
|---|---|
| Application Type | Machine to Machine |
| Token Endpoint Auth Method | `client_secret_post` |
| Grant Types | Client Credentials |
| Authorized APIs | `https://api.okoro.dev` with scopes `okoro:read`, `okoro:write` |

### Auth0 API ("Resource Server")

Create an Auth0 API named `OKORO API`:

| Setting | Value |
|---|---|
| Identifier (audience) | `https://api.okoro.dev` |
| Signing Algorithm | RS256 |
| Allow Skipping User Consent | No |
| Allow Offline Access | Yes (refresh tokens for dashboard) |
| RBAC | Enabled |
| Add Permissions in Access Token | Yes |
| Token Exchange (RFC 8693) | Enabled — once Auth0 Custom Token Exchange is GA |

### Action source (for `infra/auth0/actions/`)

#### `okoro-audit-login.js` — `post-login` trigger

```js
// Auth0 post-login Action: bridge every login into OKORO audit chain.
// Trigger: Login Flow / post-login
// Secrets: OKORO_ACTION_SECRET (= AUTH0_ACTION_SECRET on OKORO side)
//          OKORO_API_BASE      (= https://api.okoro.dev)
exports.onExecutePostLogin = async (event, api) => {
  const orgId = event.organization?.id;
  if (!orgId) {
    api.access.deny('okoro_org_required');
    return;
  }
  const roles = (event.authorization?.roles || [])
    .filter(r => r.startsWith('okoro:'));

  // Set custom claims so the access token carries OKORO context.
  api.idToken.setCustomClaim('https://okoro.dev/roles', roles);
  api.accessToken.setCustomClaim('https://okoro.dev/roles', roles);
  api.accessToken.setCustomClaim('https://okoro.dev/domain', event.organization.metadata?.domain || '');

  // Bridge to OKORO audit chain.
  const body = {
    user_id: event.user.user_id,
    organization_id: orgId,
    email: event.user.email,
    email_verified: event.user.email_verified,
    mfa: (event.authentication?.methods || []).some(m => m.name === 'mfa'),
    roles,
    occurred_at: new Date().toISOString(),
    ip: event.request?.ip || '',
    user_agent: event.request?.user_agent || '',
  };

  const res = await fetch(`${event.secrets.OKORO_API_BASE}/v1/idp/auth0/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth0-action-secret': event.secrets.OKORO_ACTION_SECRET,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Fail-open on OKORO unavailability — login proceeds, audit row is
    // backfilled by reconciliation job. Operator policy choice; flip to
    // api.access.deny() for fail-closed environments.
    console.warn(`okoro audit bridge failed status=${res.status}`);
    return;
  }

  const result = await res.json();
  api.user.setAppMetadata('okoro_principal_id', result.principal_id);
};
```

#### `okoro-block-non-admin-mfa-skip.js` — `post-login` trigger

```js
// Auth0 post-login Action: enforce MFA for okoro:admin role.
// Trigger: Login Flow / post-login (after okoro-audit-login.js)
exports.onExecutePostLogin = async (event, api) => {
  const roles = (event.authorization?.roles || []).map(r => r.name || r);
  const isAdmin = roles.includes('okoro:admin');
  const mfaSatisfied = (event.authentication?.methods || []).some(m => m.name === 'mfa');

  if (isAdmin && !mfaSatisfied) {
    api.multifactor.enable('any', { allowRememberBrowser: false });
  }
};
```

#### `okoro-token-exchange.js` — Custom Token Exchange (Flow A, when GA)

```js
// Auth0 Custom Token Exchange Action.
// Trigger: Custom Token Exchange / on-execute
// Secrets: OKORO_ACTION_SECRET, OKORO_API_BASE
exports.onExecuteCustomTokenExchange = async (event, api) => {
  // event.transaction.subject_token is the Auth0 AT presented by the client.
  const res = await fetch(`${event.secrets.OKORO_API_BASE}/v1/idp/auth0/exchange`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth0-action-secret': event.secrets.OKORO_ACTION_SECRET,
    },
    body: JSON.stringify({
      access_token: event.transaction.subject_token,
      audience: event.transaction.requested_audience,
      scope: event.transaction.requested_scope,
      requested_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    }),
  });
  if (!res.ok) {
    api.access.rejectInvalidSubjectToken('okoro_exchange_failed');
    return;
  }
  const out = await res.json();
  api.accessToken.setCustomClaim('https://okoro.dev/api_key_id', out.api_key_id);
  api.accessToken.setCustomClaim('https://okoro.dev/principal_id', out.principal_id);
  // Auth0 mints the final access token; OKORO info rides as claims.
};
```

### Terraform skeleton (deferred — `infra/auth0/main.tf`)

Use the `auth0/auth0` Terraform provider. Pin the org, the API resource, the application, the Actions, and the role definitions. Sample stub:

```hcl
provider "auth0" { domain = var.tenant_domain  client_id = var.mgmt_client_id  client_secret = var.mgmt_client_secret }

resource "auth0_resource_server" "okoro_api" {
  name        = "OKORO API"
  identifier  = "https://api.okoro.dev"
  signing_alg = "RS256"
  enforce_policies = true
  token_dialect    = "access_token_authz"
}

resource "auth0_action" "audit_login" {
  name    = "okoro-audit-login"
  runtime = "node18"
  deploy  = true
  code    = file("${path.module}/actions/okoro-audit-login.js")
  supported_triggers { id = "post-login"  version = "v3" }
  secrets { name = "OKORO_ACTION_SECRET"  value = var.okoro_action_secret }
  secrets { name = "OKORO_API_BASE"       value = var.okoro_api_base       }
}
# ... okoro-block-non-admin-mfa-skip, okoro-token-exchange, role definitions
```

---

## 5. Required new code

The Auth0 module already exists at `apps/api/src/modules/auth0/` (see ADR-0009 implementation). What's missing for full integration is (a) the RFC 8693 conformance shape on the exchange endpoint, (b) the Auth0 guard for human-authenticated routes, (c) the dashboard auth wiring, and (d) the bridge to the new OAuth AS module from the MCP integration.

### Files to add or extend in `apps/api/src/modules/auth0/`

| File | Status | Purpose |
|---|---|---|
| `auth0.adapter.spec.ts` | NEW (M-019) | Unit tests with mocked JWKS endpoint and fixture tokens |
| `auth0.service.spec.ts` | NEW (M-019) | Unit tests with mocked `Auth0Adapter` + `AuditService` |
| `auth0.controller.e2e.spec.ts` | NEW (M-019) | Full-stack supertest including timing-safe Action secret |
| `auth0.guard.ts` | NEW | `Auth0Guard` for human routes (mirrors `ApiKeyGuard`); reads `Authorization: Bearer <auth0-jwt>`, calls `Auth0Adapter.verifyAccessToken`, sets `req.principal` and `req.idpUser` |
| `auth0.dto.ts` | EXTEND | Rename `access_token` → `subject_token` in `Auth0ExchangeDto` (keep `access_token` as deprecated alias for one minor); add `subject_token_type`, `requested_token_type`, `audience`, `scope`, `resource`, `actor_token` fields per RFC 8693 §2.1 |
| `auth0.controller.ts` | EXTEND | Add `POST /v1/idp/auth0/refresh` for API-key refresh before 8h TTL elapses; add `POST /v1/idp/auth0/logout` to revoke API keys on Auth0 logout webhook |
| `auth0.service.ts` | EXTEND | Wire `exchangeToken()` into `ApiKeyService.create()` (currently TODO per inline comment line 76); emit RFC 8693 response shape; support `requested_token_type: 'urn:ietf:params:oauth:token-type:jwt'` to mint an EdDSA JWT instead of an opaque API key |
| `idp.adapter.ts` | EXTEND | Add `verifyOrgAccess(orgId, userId): Promise<boolean>` so we can re-check membership at exchange time (Auth0 Mgmt API call, cached 60s) |
| `auth0.module.ts` | EXTEND | Register `Auth0Guard`, export `Auth0Adapter` so OAuth module can reuse it for the consent step |

### New module: `apps/api/src/modules/principals/`

Already scaffolded per file listing. Verify it has:

- `principals.controller.ts` — `GET /v1/principals/me` (returns the principal bound to the calling Auth0 session), `DELETE /v1/principals/:id` (org-level offboarding, cascades to agents)
- `principals.service.ts` — Auth0-aware lookup methods (`findByIdpOrg`)
- Foreign-key wiring to `ApiKey` so `okoro_live_*` keys are scoped to a principal

### Cross-module touchpoints

| File | Change |
|---|---|
| `apps/api/src/modules/auth/api-key.service.ts` | Accept `idpUserId` as the "issued by" attribution on creation; surface in `ApiKey.metadata.issuedBy` |
| `apps/api/src/modules/auth/api-key.guard.ts` | No change — still validates OKORO API keys. The two guards (`ApiKeyGuard` for agent routes, `Auth0Guard` for human routes) are mutually exclusive per ADR-0009 §5 |
| `apps/api/src/modules/oauth/oauth.controller.ts` (NEW per MCP doc) | The `/v1/oauth/authorize` handler delegates the user-auth step to Auth0 by 302-redirecting to Auth0 Universal Login; on callback it calls `Auth0Adapter.verifyAccessToken` and proceeds. Reuses `Auth0Service`. |
| `apps/dashboard/` | Switch from "no auth" stub to `@auth0/nextjs-auth0`. Wrap `_app.tsx` in `<UserProvider>`. Add `pages/api/auth/[...auth0].ts`. Use `useUser()` in pages. After Auth0 login, the dashboard calls `POST /v1/idp/auth0/exchange` with the Auth0 access token to get an OKORO API key it stores in an httpOnly cookie. (M-020) |
| `packages/sdk-ts/src/index.ts` | Add `Okoro.fromAuth0(accessToken: string): Promise<Okoro>` static helper that performs the exchange and returns a configured client |
| `config/config.schema.ts` | Existing `AUTH0_ISSUER`, `AUTH0_AUDIENCE`, `AUTH0_ACTION_SECRET`. Add `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET` for the `verifyOrgAccess` Mgmt API call |
| `apps/api/scripts/migrate-idp.ts.template` (mentioned in ADR-0009) | Realize the template — backfill script when migrating from Auth0 to a different IdP |

### New endpoints (summary)

```
# Existing (extended)
POST   /v1/idp/auth0/action       Auth0 Action webhook                       — extend with idempotency on (user_id, occurred_at)
POST   /v1/idp/auth0/exchange     Auth0 token → OKORO API key (or JWT)       — RFC 8693 wire shape

# New
POST   /v1/idp/auth0/refresh      Refresh OKORO API key before 8h TTL
POST   /v1/idp/auth0/logout       Revoke OKORO API key on Auth0 logout webhook
GET    /v1/principals/me          Returns current principal (Auth0Guard)
DELETE /v1/principals/:id         Org offboarding cascade

# MCP-side (cross-reference docs/integrations/mcp.md §5)
GET    /v1/oauth/authorize        Delegates to Auth0 for user step
POST   /v1/oauth/token            Includes RFC 8693 grant
```

### Schema additions (Prisma — coordinate with M-026)

```prisma
model Principal {
  id                  String   @id          // p_a0_<sha256(org)[:12]> for Auth0 orgs
  name                String
  status              PrincipalStatus @default(ACTIVE)

  // IDP binding (ADR-0009)
  idpProvider         String?              // "auth0" | "clerk" | "workos" | "keycloak"
  idpOrganizationId   String?
  idpDomain           String?

  apiKeys             ApiKey[]
  agents              Agent[]
  relyingParties      RelyingParty[]

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  suspendedAt         DateTime?

  @@unique([idpProvider, idpOrganizationId])
  @@index([idpDomain])
}

enum PrincipalStatus { ACTIVE  SUSPENDED  DELETED }

model ApiKey {
  // ... existing fields ...
  issuedByIdpUserId   String?              // Auth0 sub at time of issuance
  issuedViaExchange   Boolean  @default(false)  // true = via /idp/auth0/exchange
  expiresAt           DateTime?            // null = no expiry; 8h for exchange-issued
  @@index([principalId, expiresAt])
}
```

### Reuse from existing code

- `Auth0Adapter.verifyAccessToken()` — already implements JWKS-cached RS256 verify with audience and issuer checks. The new `Auth0Guard` and the OAuth `/authorize` handler both call this.
- `Auth0Adapter.ensurePrincipalForOrg()` — already idempotent. Both Action and exchange flows call it.
- `AuditService.append()` — every Auth0 event (login, exchange, refresh, logout) gets an audit row. ADR-0005 chain is preserved.
- `wellknown.controller.ts` — already serves the JWKS for OKORO-issued tokens. When `requested_token_type=jwt` is supported on exchange, MCP relying parties verify the resulting JWT against this same JWKS.
- `packages/mcp-bridge` `wrapMcpHandler` — pattern (b) flow. An Auth0-authenticated human creates an agent; the agent calls an MCP server through the bridge; the bridge calls `/v1/verify`; the verify decision references the principal that Auth0 created. End-to-end composition with no Auth0 round-trip on the agent path.

---

## References

- ADR-0009 — Auth0 bridges human identity (`docs/decisions/0009-auth0-bridge.md`)
- ADR-0008 — MCP as control plane (`docs/decisions/0008-mcp-as-control-plane.md`)
- ADR-0002 — Non-custodial keys (`docs/decisions/0002-non-custodial-key-policy.md`)
- ADR-0005 — Audit chain canonicalization (`docs/decisions/0005-audit-chain-canonicalization.md`)
- RFC 8693 — OAuth 2.0 Token Exchange: <https://datatracker.ietf.org/doc/html/rfc8693>
- RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens: <https://datatracker.ietf.org/doc/html/rfc9068>
- Auth0 Application Grant Types: <https://auth0.com/docs/get-started/applications/application-grant-types>
- Auth0 Actions: <https://auth0.com/docs/customize/actions>
- Auth0 Organizations: <https://auth0.com/docs/manage-users/organizations>
- Auth0 Custom Token Exchange (verify GA status before relying on Flow A)
- `@auth0/nextjs-auth0` SDK: <https://github.com/auth0/nextjs-auth0>
- Existing skeletons:
  - `apps/api/src/modules/auth0/auth0.adapter.ts` — JWKS-cached RS256 verify, org→principal mapping
  - `apps/api/src/modules/auth0/auth0.service.ts` — Action callback + token exchange
  - `apps/api/src/modules/auth0/auth0.controller.ts` — HTTP surface
  - `apps/api/src/modules/auth0/idp.adapter.ts` — provider-agnostic interface
