# CERNIQ — Complete API Reference

## Every Endpoint with Request/Response Examples

> **Base URL:** `https://api.cerniq.io`  
> **Auth:** `Authorization: Bearer <api_key>` on all endpoints except `/health`, `/ready`, `/.well-known/*`  
> **Version:** All endpoints are under `/v1/`  
> **Updated:** 2026-05-04

---

## Authentication

```bash
# All API requests require an API key
Authorization: Bearer ak_live_xxxxxxxxxxxxxxxxxxxx

# The API key identifies your principal (tenant)
# All data returned is scoped to your principal — cross-principal access is blocked
```

---

## 1. Health & Status

### GET /health

Public. No auth. Used by load balancers and uptime monitors.

```bash
curl https://api.cerniq.io/health
```

**Response 200:**

```json
{
  "status": "ok",
  "timestamp": "2026-05-04T12:00:00.000Z"
}
```

This endpoint NEVER checks DB or Redis. It always returns 200 if the process is running.

---

### GET /ready

Authenticated (admin token). Deep health check.

```bash
curl https://api.cerniq.io/ready \
  -H "X-CERNIQ-Admin: $CERNIQ_ADMIN_TOKEN"
```

**Response 200:**

```json
{
  "status": "ready",
  "db": "ok",
  "redis": "ok",
  "migrations": "current",
  "signingKey": "kms",
  "timestamp": "2026-05-04T12:00:00.000Z"
}
```

**Response 503:**

```json
{
  "status": "not_ready",
  "db": "error",
  "redis": "ok",
  "error": "Cannot connect to database"
}
```

---

### GET /.well-known/audit-signing-key

Public. Returns the current CERNIQ audit signing key as JWKS. Used by relying parties to verify audit chain signatures independently.

```bash
curl https://api.cerniq.io/.well-known/audit-signing-key
```

**Response 200:**

```json
{
  "keys": [
    {
      "kty": "OKP",
      "crv": "Ed25519",
      "kid": "key_2026_05_01",
      "use": "sig",
      "alg": "EdDSA",
      "x": "base64url-encoded-public-key"
    }
  ]
}
```

---

## 2. Agents

### POST /v1/agents

Register a new AI agent identity.

```bash
curl -X POST https://api.cerniq.io/v1/agents \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-payment-agent",
    "publicKey": "base64url-encoded-ed25519-public-key",
    "description": "Handles payment operations for my service",
    "metadata": {
      "model": "gpt-4o",
      "framework": "langchain",
      "version": "1.0.0"
    }
  }'
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `name` | string | ✓ | Human-readable agent name (unique per principal) |
| `publicKey` | string | ✓ | Base64url-encoded Ed25519 public key (32 bytes) |
| `description` | string | - | What this agent does |
| `metadata` | object | - | Arbitrary metadata (stored, not interpreted) |

**Response 201:**

```json
{
  "id": "agent_01HX5TZK2Q8MXVR9P3N7WQJD4",
  "name": "my-payment-agent",
  "publicKey": "base64url-encoded-ed25519-public-key",
  "status": "ACTIVE",
  "trustScore": 500,
  "trustBand": "VERIFIED",
  "principalId": "prin_01HX5TZK2Q8MXVR9P3N7WQJD4",
  "createdAt": "2026-05-04T12:00:00.000Z",
  "description": "Handles payment operations",
  "metadata": { "model": "gpt-4o" }
}
```

**Response 409** (name already exists):

```json
{
  "error": "AGENT_NAME_CONFLICT",
  "message": "An agent named 'my-payment-agent' already exists in your account"
}
```

---

### GET /v1/agents

List all agents for your principal.

```bash
curl https://api.cerniq.io/v1/agents \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -G \
  --data-urlencode "status=ACTIVE" \
  --data-urlencode "limit=20" \
  --data-urlencode "cursor=agent_xyz"
```

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | all | Filter by status: ACTIVE, REVOKED, SUSPENDED |
| `trustBand` | string | all | Filter by band: PLATINUM, VERIFIED, WATCH, FLAGGED |
| `limit` | number | 20 | Page size (max 100) |
| `cursor` | string | - | Pagination cursor from previous response |

**Response 200:**

```json
{
  "agents": [
    {
      "id": "agent_01HX5TZK...",
      "name": "my-payment-agent",
      "status": "ACTIVE",
      "trustScore": 823,
      "trustBand": "VERIFIED",
      "lastVerifiedAt": "2026-05-04T11:55:00.000Z",
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "hasMore": false,
    "cursor": null
  }
}
```

---

### GET /v1/agents/:id

Get a single agent with full trust detail.

```bash
curl https://api.cerniq.io/v1/agents/agent_01HX5TZK \
  -H "Authorization: Bearer $CERNIQ_API_KEY"
```

**Response 200:**

```json
{
  "id": "agent_01HX5TZK",
  "name": "my-payment-agent",
  "publicKey": "base64url-...",
  "status": "ACTIVE",
  "trustScore": 823,
  "trustBand": "VERIFIED",
  "trustExplanation": {
    "baseScore": 500,
    "contributors": [
      { "type": "SUCCESSFUL_VERIFY", "delta": 150, "count": 150 },
      { "type": "AGE_COHORT", "delta": 100, "daysActive": 8 },
      { "type": "FRAUD_REPORT_MINOR", "delta": -25, "count": 1 },
      { "type": "NORMAL_VELOCITY", "delta": 50, "distinctDays": 7 }
    ],
    "anomaliesActive": []
  },
  "policyIds": ["pol_abc123", "pol_def456"],
  "lastVerifiedAt": "2026-05-04T11:55:00.000Z",
  "verifyCount30d": 1247,
  "createdAt": "2026-05-01T00:00:00.000Z"
}
```

---

### PATCH /v1/agents/:id

Update agent metadata or description. (Cannot change publicKey — use rotation endpoint.)

```bash
curl -X PATCH https://api.cerniq.io/v1/agents/agent_01HX5TZK \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "description": "Updated description", "metadata": { "version": "2.0.0" } }'
```

**Response 200:** Updated agent object.

---

### DELETE /v1/agents/:id (Revoke)

Revoke an agent. Revocation propagates within 30 seconds. This action is irreversible — to re-enable, register a new agent.

```bash
curl -X DELETE https://api.cerniq.io/v1/agents/agent_01HX5TZK \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "No longer needed" }'
```

**Response 200:**

```json
{
  "id": "agent_01HX5TZK",
  "status": "REVOKED",
  "revokedAt": "2026-05-04T12:00:00.000Z",
  "reason": "No longer needed"
}
```

---

### POST /v1/agents/:id/rotate-key

Rotate an agent's Ed25519 public key. Existing tokens signed by the old key become invalid immediately.

```bash
curl -X POST https://api.cerniq.io/v1/agents/agent_01HX5TZK/rotate-key \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "newPublicKey": "base64url-encoded-new-public-key" }'
```

**Response 200:** Updated agent object with new publicKey.

---

## 3. Policies

### POST /v1/policies

Create a policy.

```bash
curl -X POST https://api.cerniq.io/v1/policies \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "payment-policy",
    "type": "BUILTIN",
    "scopes": ["payment:read", "payment:write"],
    "spendLimit": {
      "amount": 1000,
      "currency": "USD",
      "window": "day"
    },
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }'
```

**Policy Types:**
| Type | Description |
|------|-------------|
| `BUILTIN` | CERNIQ built-in scope + spend enforcement |
| `CEDAR` | Cedar policy language (enterprise) |
| `OPA` | OPA Rego policy (enterprise) |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `name` | string | ✓ | Policy name |
| `type` | string | ✓ | BUILTIN \| CEDAR \| OPA |
| `scopes` | string[] | - | Required scopes (BUILTIN only) |
| `spendLimit.amount` | number | - | Maximum spend per window |
| `spendLimit.currency` | string | - | Currency code (USD, EUR, etc.) |
| `spendLimit.window` | string | - | `call` \| `hour` \| `day` \| `month` |
| `expiresAt` | string | - | ISO8601 expiry datetime |
| `policy` | string | - | Cedar/OPA policy text (non-BUILTIN) |

**Response 201:**

```json
{
  "id": "pol_01HX5TZK",
  "name": "payment-policy",
  "type": "BUILTIN",
  "status": "ACTIVE",
  "scopes": ["payment:read", "payment:write"],
  "spendLimit": {
    "amount": 1000,
    "currency": "USD",
    "window": "day"
  },
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "createdAt": "2026-05-04T12:00:00.000Z"
}
```

---

### POST /v1/policies/:id/attach

Attach a policy to one or more agents.

```bash
curl -X POST https://api.cerniq.io/v1/policies/pol_01HX5TZK/attach \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "agentIds": ["agent_01HX5TZK", "agent_02HX5TZK"] }'
```

**Response 200:**

```json
{
  "attached": ["agent_01HX5TZK", "agent_02HX5TZK"],
  "alreadyAttached": [],
  "failed": []
}
```

---

### GET /v1/policies

List all policies.

```bash
curl https://api.cerniq.io/v1/policies \
  -H "Authorization: Bearer $CERNIQ_API_KEY"
```

**Response 200:**

```json
{
  "policies": [
    {
      "id": "pol_01HX5TZK",
      "name": "payment-policy",
      "type": "BUILTIN",
      "status": "ACTIVE",
      "agentCount": 3
    }
  ]
}
```

---

### DELETE /v1/policies/:id

Revoke a policy. All agents with this policy lose its grants immediately.

```bash
curl -X DELETE https://api.cerniq.io/v1/policies/pol_01HX5TZK \
  -H "Authorization: Bearer $CERNIQ_API_KEY"
```

**Response 200:**

```json
{ "id": "pol_01HX5TZK", "status": "REVOKED", "revokedAt": "2026-05-04T12:00:00.000Z" }
```

---

## 4. Verify (The Core Endpoint)

### POST /v1/verify

Verify an agent JWT and enforce policies. This is the highest-traffic endpoint — designed for < 50ms median latency.

```bash
curl -X POST https://api.cerniq.io/v1/verify \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
    "scopes": ["payment:write"],
    "amount": 99.99,
    "currency": "USD",
    "context": {
      "description": "Purchase order #12345",
      "relyingPartyId": "rp_01HX5TZK"
    }
  }'
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `token` | string | ✓ | EdDSA JWT signed by the agent's private key |
| `scopes` | string[] | - | Scopes required for this action |
| `amount` | number | - | Spend amount (for spend limit enforcement) |
| `currency` | string | - | Currency code (required if amount present) |
| `context.description` | string | - | Human-readable description (appears in audit log) |
| `context.relyingPartyId` | string | - | Your registered relying party ID |
| `context.idempotencyKey` | string | - | Idempotency key (prevents duplicate processing) |

**JWT Claims (the token must contain):**
| Claim | Description |
|-------|-------------|
| `sub` | Agent ID (e.g., `agent_01HX5TZK`) |
| `iss` | Must match your principal's expected issuer |
| `iat` | Issued at (Unix timestamp) |
| `exp` | Expiry (Unix timestamp, max 300s from iat) |
| `jti` | JWT ID (unique per token, prevents replay) |
| `scopes` | Array of scopes the agent is claiming |
| `amt` | Spend amount (optional, used for spend enforcement) |
| `cur` | Currency (required if amt present) |

**Response 200 (Approved):**

```json
{
  "approved": true,
  "agentId": "agent_01HX5TZK",
  "principalId": "prin_01HX5TZK",
  "trustBand": "VERIFIED",
  "trustScore": 823,
  "auditEventId": "evt_01HX5TZK",
  "scopes": ["payment:write"],
  "spendRemaining": 900.01,
  "spendCurrency": "USD",
  "spendWindow": "day",
  "verifiedAt": "2026-05-04T12:00:00.000Z"
}
```

**Response 403 (Denied):**

```json
{
  "approved": false,
  "denialReason": "SPEND_LIMIT_EXCEEDED",
  "agentId": "agent_01HX5TZK",
  "auditEventId": "evt_01HX5TZK",
  "details": {
    "spentToday": 1000.0,
    "limit": 1000.0,
    "currency": "USD",
    "resetsAt": "2026-05-05T00:00:00.000Z"
  }
}
```

**All 9 Denial Reasons and HTTP Status Codes:**

| `denialReason`         | HTTP | Meaning                                     | Fix                                                |
| ---------------------- | ---- | ------------------------------------------- | -------------------------------------------------- |
| `AGENT_NOT_FOUND`      | 404  | Agent ID doesn't exist in your principal    | Check agent ID and API key match                   |
| `AGENT_REVOKED`        | 403  | Agent has been revoked                      | Register a new agent                               |
| `INVALID_SIGNATURE`    | 401  | JWT signature verification failed           | Verify agent is using the correct private key      |
| `POLICY_REVOKED`       | 403  | The policy granting this access was revoked | Re-apply or create a new policy                    |
| `POLICY_EXPIRED`       | 403  | Policy has passed its expiry date           | Create a new policy with future expiry             |
| `SCOPE_NOT_GRANTED`    | 403  | Required scope not in agent's policies      | Add the scope to the agent's policy                |
| `SPEND_LIMIT_EXCEEDED` | 429  | Daily/hourly/call spend limit hit           | Wait for reset or increase limit                   |
| `TRUST_SCORE_TOO_LOW`  | 403  | Agent's trust score below policy minimum    | Allow time for score to increase, or lower minimum |
| `ANOMALY_FLAGGED`      | 403  | BATE anomaly detector triggered             | Review agent behavior, contact support             |

---

## 5. Audit Log

### GET /v1/audit

Query the audit log for your principal.

```bash
curl "https://api.cerniq.io/v1/audit?agentId=agent_01HX5TZK&limit=20" \
  -H "Authorization: Bearer $CERNIQ_API_KEY"
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `agentId` | string | Filter by agent |
| `outcome` | string | Filter: APPROVED \| DENIED \| ERROR |
| `denialReason` | string | Filter by denial reason |
| `from` | string | ISO8601 start datetime |
| `to` | string | ISO8601 end datetime |
| `limit` | number | Page size (max 100) |
| `cursor` | string | Pagination cursor |

**Response 200:**

```json
{
  "events": [
    {
      "id": "evt_01HX5TZK",
      "agentId": "agent_01HX5TZK",
      "action": "verify",
      "outcome": "APPROVED",
      "scopes": ["payment:write"],
      "amount": 99.99,
      "currency": "USD",
      "trustScore": 823,
      "trustBand": "VERIFIED",
      "relyingPartyId": "rp_01HX5TZK",
      "signature": "base64url-chain-signature",
      "prevEventId": "evt_prev",
      "signingKeyId": "key_2026_05_01",
      "createdAt": "2026-05-04T12:00:00.000Z"
    }
  ],
  "chainIntegrity": {
    "verified": true,
    "eventsChecked": 20
  },
  "pagination": { "hasMore": true, "cursor": "evt_cursor" }
}
```

---

### POST /v1/audit/verify-chain

Verify the integrity of your audit chain. Returns any breaks found.

```bash
curl -X POST https://api.cerniq.io/v1/audit/verify-chain \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "limit": 1000, "from": "2026-05-01T00:00:00.000Z" }'
```

**Response 200:**

```json
{
  "integrity": "ok",
  "eventsVerified": 847,
  "breaks": 0,
  "from": "evt_first",
  "to": "evt_last",
  "verifiedAt": "2026-05-04T12:00:00.000Z"
}
```

**Response 200 (breaks found):**

```json
{
  "integrity": "broken",
  "eventsVerified": 847,
  "breaks": 1,
  "breakDetails": [
    {
      "eventId": "evt_xyz",
      "expectedPrevSig": "abc123...",
      "computedPrevSig": "def456...",
      "createdAt": "2026-05-03T14:22:00.000Z"
    }
  ]
}
```

---

## 6. BATE — Trust & Behavioral Signals

### GET /v1/agents/:id/trust

Get a detailed trust score breakdown for an agent.

```bash
curl https://api.cerniq.io/v1/agents/agent_01HX5TZK/trust \
  -H "Authorization: Bearer $CERNIQ_API_KEY"
```

**Response 200:**

```json
{
  "agentId": "agent_01HX5TZK",
  "score": 823,
  "band": "VERIFIED",
  "explanation": {
    "baseScore": 500,
    "contributors": [
      { "type": "SUCCESSFUL_VERIFY", "delta": 200, "count": 200, "capApplied": false },
      { "type": "AGE_COHORT", "delta": 100, "daysActive": 12 },
      { "type": "NORMAL_VELOCITY", "delta": 50, "distinctActiveDays": 9 },
      { "type": "FRAUD_REPORT_MINOR", "delta": -25, "count": 1 },
      { "type": "FAILED_VERIFY", "delta": -2, "count": 1 }
    ],
    "anomaliesActive": [],
    "trustBandCutoffs": {
      "PLATINUM": 750,
      "VERIFIED": 500,
      "WATCH": 250,
      "FLAGGED": 0
    }
  },
  "history": [
    { "score": 500, "band": "VERIFIED", "date": "2026-05-01" },
    { "score": 650, "band": "VERIFIED", "date": "2026-05-02" },
    { "score": 823, "band": "VERIFIED", "date": "2026-05-04" }
  ]
}
```

---

### POST /v1/agents/:id/signals

Submit a behavioral signal for an agent (e.g., from a fraud report or external observation).

```bash
curl -X POST https://api.cerniq.io/v1/agents/agent_01HX5TZK/signals \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "FRAUD_REPORT_MINOR",
    "metadata": {
      "reportedBy": "rp_01HX5TZK",
      "description": "Agent made unauthorized purchase attempt",
      "externalReference": "case_12345"
    }
  }'
```

**Valid Signal Types:**
| Type | Score Delta | Description |
|------|-------------|-------------|
| `SUCCESSFUL_VERIFY` | +1 (cap +200) | Normal positive signal |
| `FAILED_VERIFY` | -2 | Signature or policy failure |
| `FRAUD_REPORT_MINOR` | -25 | Minor fraud report |
| `FRAUD_REPORT_MODERATE` | -100 | Moderate fraud report |
| `FRAUD_REPORT_SEVERE` | -250 | Severe fraud report |
| `FRAUD_REPORT_CRITICAL` | -500 | Critical security event |
| `AGENT_DPOP_REPLAY_ATTEMPT` | -200 (cap -600) | DPoP replay detected |

**Response 201:**

```json
{
  "signalId": "sig_01HX5TZK",
  "type": "FRAUD_REPORT_MINOR",
  "agentId": "agent_01HX5TZK",
  "scoreImpact": -25,
  "newScore": 798,
  "newBand": "VERIFIED",
  "createdAt": "2026-05-04T12:00:00.000Z"
}
```

---

## 7. Webhooks

### POST /v1/webhooks

Create a webhook subscription.

```bash
curl -X POST https://api.cerniq.io/v1/webhooks \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-service.com/webhooks/cerniq",
    "events": ["agent.revoked", "agent.trust_band_changed", "policy.expired"],
    "description": "My service webhook"
  }'
```

**Available Events:**
| Event | Fired When |
|-------|-----------|
| `agent.revoked` | Agent is revoked |
| `agent.suspended` | Agent is suspended |
| `agent.trust_band_changed` | Trust band changes (promotion or demotion) |
| `policy.revoked` | Policy is revoked |
| `policy.expired` | Policy reaches its expiry date |
| `principal.spend_warning` | Spend reaches 80% of limit |
| `anomaly.detected` | BATE anomaly triggered on an agent |

**Response 201:**

```json
{
  "id": "sub_01HX5TZK",
  "url": "https://your-service.com/webhooks/cerniq",
  "events": ["agent.revoked"],
  "secret": "whsec_xxxxxxxxxxxx",
  "status": "ACTIVE",
  "createdAt": "2026-05-04T12:00:00.000Z"
}
```

**IMPORTANT:** The `secret` is returned ONCE. Store it securely. Use it to verify the HMAC signature on incoming webhooks:

```typescript
const sig = req.headers['x-cerniq-signature'];
const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
if (sig !== expected) throw new Error('Invalid signature');
```

---

### Webhook Event Payload

Every webhook event has this format:

```json
{
  "id": "whe_01HX5TZK",
  "type": "agent.revoked",
  "createdAt": "2026-05-04T12:00:00.000Z",
  "data": {
    "agentId": "agent_01HX5TZK",
    "principalId": "prin_01HX5TZK",
    "reason": "Revoked by principal",
    "revokedAt": "2026-05-04T12:00:00.000Z"
  }
}
```

---

## 8. API Keys

### POST /v1/auth/api-keys

Create a new API key.

```bash
curl -X POST https://api.cerniq.io/v1/auth/api-keys \
  -H "Authorization: Bearer $CERNIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-key",
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }'
```

**Response 201:**

```json
{
  "id": "key_01HX5TZK",
  "name": "production-key",
  "key": "ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "createdAt": "2026-05-04T12:00:00.000Z"
}
```

**The `key` is returned ONCE. Copy it immediately.**

---

### GET /v1/auth/api-keys

List all API keys (key values are never returned, only metadata).

```bash
curl https://api.cerniq.io/v1/auth/api-keys \
  -H "Authorization: Bearer $CERNIQ_API_KEY"
```

---

### DELETE /v1/auth/api-keys/:id

Revoke an API key.

```bash
curl -X DELETE https://api.cerniq.io/v1/auth/api-keys/key_01HX5TZK \
  -H "Authorization: Bearer $CERNIQ_API_KEY"
```

---

## 9. Error Response Format

All error responses follow this format:

```json
{
  "statusCode": 403,
  "error": "SCOPE_NOT_GRANTED",
  "message": "Agent does not have scope 'payment:write'. Available scopes: ['payment:read']",
  "requestId": "req_01HX5TZK",
  "timestamp": "2026-05-04T12:00:00.000Z"
}
```

**Common HTTP Status Codes:**

| Status | Meaning                                       |
| ------ | --------------------------------------------- |
| 200    | Success                                       |
| 201    | Created                                       |
| 400    | Bad Request (validation error)                |
| 401    | Unauthorized (invalid/missing API key)        |
| 403    | Forbidden (denied)                            |
| 404    | Not Found                                     |
| 409    | Conflict (e.g., duplicate name)               |
| 429    | Too Many Requests (rate limit or spend limit) |
| 500    | Internal Server Error                         |
| 503    | Service Unavailable (maintenance mode)        |

---

## 10. Rate Limits

| Tier       | /v1/verify              | Other endpoints |
| ---------- | ----------------------- | --------------- |
| Free       | 10 req/sec, burst 20    | 5 req/sec       |
| Developer  | 50 req/sec, burst 100   | 20 req/sec      |
| Pro        | 500 req/sec, burst 1000 | 100 req/sec     |
| Enterprise | Custom                  | Custom          |

Rate limit headers on every response:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1714867230
```

---

## 11. Pagination

All list endpoints use cursor-based pagination:

```bash
# First page
curl "https://api.cerniq.io/v1/agents?limit=20"

# Next page (using cursor from previous response)
curl "https://api.cerniq.io/v1/agents?limit=20&cursor=agent_cursor_value"
```

Response includes:

```json
{
  "pagination": {
    "hasMore": true,
    "cursor": "agent_cursor_value",
    "total": null // not always available (expensive for large datasets)
  }
}
```

---

_API Reference version: 1.0 | CERNIQ Phase 1 GA_  
_OpenAPI spec: https://api.cerniq.io/openapi.json_  
_Postman collection: https://docs.cerniq.io/postman_
