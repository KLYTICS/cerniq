# CERNIQ — Express / Fastify / Hono Integration Guide

## Protecting Relying-Party APIs with Offline JWT Verification

> **Updated:** 2026-05-04  
> **Package:** `@cerniq/verifier-rp`  
> **Use this guide** when you're building an API or service that AI agents call, and you want to verify their CERNIQ identity before processing requests.

---

## 1. Overview

`@cerniq/verifier-rp` is a drop-in offline verifier for relying parties — services that receive requests from CERNIQ-verified agents. It:

- Verifies Ed25519 JWT signatures offline (no network call on the hot path)
- Caches public keys with SWR (stale-while-revalidate) refresh
- Maintains a replay prevention LRU cache (JTI-based)
- Maintains a revocation cache (refreshed via webhooks or polling)
- Ships adapters for Express, Fastify, Hono, and vanilla middleware

**Zero `node:crypto` dependency** — runs on Cloudflare Workers, Deno, Bun, and Node.js.

---

## 2. Install

```bash
npm install @cerniq/verifier-rp
# or
pnpm add @cerniq/verifier-rp
```

---

## 3. Express Integration

### 3.1 Middleware Setup

```typescript
import express from 'express';
import { createExpressMiddleware } from '@cerniq/verifier-rp/express';

const app = express();

// Create the middleware
const cerniqMiddleware = createExpressMiddleware({
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,

  // Optional configuration
  requiredScopes: ['payment:read'], // require these scopes on all protected routes
  trustBandMinimum: 'VERIFIED', // reject WATCH/FLAGGED agents
  tokenHeader: 'x-cerniq-token', // default: Authorization: Bearer
  relyingPartyId: process.env.CERNIQ_RP_ID, // optional: for analytics
});

// Apply to specific routes
app.get('/api/account', cerniqMiddleware, (req, res) => {
  // req.cerniq is injected by the middleware:
  // req.cerniq.agentId    — verified agent ID
  // req.cerniq.trustBand  — PLATINUM | VERIFIED | WATCH | FLAGGED
  // req.cerniq.trustScore — 0-1000
  // req.cerniq.scopes     — scopes granted to this token
  // req.cerniq.auditId    — audit event ID for this request

  res.json({
    message: `Hello, agent ${req.cerniq.agentId}`,
    trustBand: req.cerniq.trustBand,
  });
});

// Or apply globally
app.use('/api/agents/*', cerniqMiddleware);
```

### 3.2 Per-Route Scope Requirements

```typescript
import { createExpressMiddleware } from '@cerniq/verifier-rp/express';

// Create middleware with different scope requirements per route
const requireRead = createExpressMiddleware({
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,
  requiredScopes: ['payment:read'],
});

const requireWrite = createExpressMiddleware({
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,
  requiredScopes: ['payment:write'],
  trustBandMinimum: 'VERIFIED', // writes require higher trust
});

app.get('/api/balance', requireRead, getBalanceHandler);
app.post('/api/transfer', requireWrite, transferHandler);
```

### 3.3 Custom Denial Response

```typescript
const cerniqMiddleware = createExpressMiddleware({
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,

  onDenied: (result, req, res) => {
    // Customize the denial response
    const statusCode =
      {
        AGENT_NOT_FOUND: 401,
        AGENT_REVOKED: 403,
        INVALID_SIGNATURE: 401,
        SPEND_LIMIT_EXCEEDED: 429,
        SCOPE_NOT_GRANTED: 403,
        TRUST_SCORE_TOO_LOW: 403,
      }[result.denialReason!] ?? 403;

    res.status(statusCode).json({
      error: result.denialReason,
      message: `Request denied: ${result.denialReason}`,
      auditId: result.auditEventId, // give caller a reference
    });

    // Log for your own metrics
    metrics.increment('cerniq.denied', { reason: result.denialReason });
  },
});
```

---

## 4. Fastify Integration

```typescript
import Fastify from 'fastify';
import { createFastifyPlugin } from '@cerniq/verifier-rp/fastify';

const fastify = Fastify({ logger: true });

// Register as a Fastify plugin
await fastify.register(createFastifyPlugin, {
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,
  routePrefix: '/api', // only protect /api/* routes
});

// Protected route — req.cerniq is available after verification
fastify.get(
  '/api/data',
  {
    config: {
      cerniq: {
        requiredScopes: ['data:read'],
        trustBandMinimum: 'WATCH', // allow WATCH+ for read operations
      },
    },
  },
  async (request, reply) => {
    return {
      agentId: request.cerniq.agentId,
      data: await fetchData(request.cerniq.agentId),
    };
  },
);

// Route without CERNIQ protection (public endpoint)
fastify.get('/health', async () => ({ status: 'ok' }));

await fastify.listen({ port: 3000 });
```

### 4.1 Fastify Schema Integration

```typescript
// Add CERNIQ context to your Fastify TypeScript types
declare module 'fastify' {
  interface FastifyRequest {
    cerniq: {
      agentId: string;
      trustBand: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
      trustScore: number;
      scopes: string[];
      auditEventId: string;
    };
  }
}
```

---

## 5. Hono Integration (Edge-Native)

Hono works on Cloudflare Workers, Deno, Bun, and Node.js. `@cerniq/verifier-rp` has zero `node:crypto` for exactly this use case:

```typescript
import { Hono } from 'hono';
import { createHonoMiddleware } from '@cerniq/verifier-rp/hono';

const app = new Hono();

const cerniqMiddleware = createHonoMiddleware({
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,
});

app.use('/api/*', cerniqMiddleware);

app.get('/api/quote', async (c) => {
  const cerniq = c.get('cerniq'); // injected by middleware
  return c.json({
    agentId: cerniq.agentId,
    quote: await generateQuote(cerniq.agentId, cerniq.trustBand),
  });
});

export default app;
```

Cloudflare Workers deployment:

```typescript
// worker.ts
import { Hono } from 'hono';
import { createHonoMiddleware } from '@cerniq/verifier-rp/hono';

const app = new Hono<{ Bindings: { CERNIQ_API_KEY: string } }>();

app.use('/api/*', async (c, next) => {
  const middleware = createHonoMiddleware({
    cerniqUrl: 'https://api.cerniqapp.com',
    apiKey: c.env.CERNIQ_API_KEY, // from Cloudflare secrets
  });
  return middleware(c, next);
});

export default app;
```

---

## 6. Vanilla Middleware (Framework-Agnostic)

For any HTTP framework:

```typescript
import { CerniqVerifier } from '@cerniq/verifier-rp';

const verifier = new CerniqVerifier({
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,
  // Warm up JWKS cache at startup (optional but recommended)
  prefetchJwks: true,
});

// Warm up at startup
await verifier.prefetchJwks();

// Use in any middleware/handler
async function verifyRequest(
  token: string,
  options?: {
    requiredScopes?: string[];
    minTrustBand?: string;
  },
) {
  const result = await verifier.verify(token, {
    scopes: options?.requiredScopes,
    trustBandMinimum: options?.minTrustBand,
  });

  if (!result.approved) {
    throw new Error(`CERNIQ denied: ${result.denialReason}`);
  }

  return result; // { agentId, trustBand, trustScore, scopes, auditEventId }
}
```

---

## 7. Advanced: Spend Tracking at the Relying Party

Sometimes the relying party knows the spend amount better than the agent does. Use the `reportSpend` option:

```typescript
// In your handler, after the operation completes
app.post('/api/execute-trade', cerniqMiddleware, async (req, res) => {
  const { ticker, quantity } = req.body;

  // Execute the trade
  const tradeResult = await tradingService.execute({ ticker, quantity });

  // Report actual spend back to CERNIQ (out-of-band, doesn't block response)
  await verifier.reportSpend({
    agentId: req.cerniq.agentId,
    amount: tradeResult.totalCost,
    currency: 'USD',
    operationId: req.cerniq.auditEventId, // link to audit event
  });

  res.json({ success: true, trade: tradeResult });
});
```

---

## 8. Webhook Handler for Revocation

Keep your relying party's revocation cache fresh:

```typescript
import { createHmac } from 'crypto';
import type { CerniqVerifier } from '@cerniq/verifier-rp';

function createWebhookHandler(verifier: CerniqVerifier, webhookSecret: string) {
  return async (req: express.Request, res: express.Response) => {
    // 1. Verify HMAC signature
    const sig = req.headers['x-cerniq-signature'] as string;
    const expected = createHmac('sha256', webhookSecret)
      .update((req as any).rawBody) // requires rawBody middleware
      .digest('hex');

    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    // 2. Handle revocation
    if (event.type === 'agent.revoked') {
      await verifier.invalidateAgent(event.data.agentId);
      console.log(`[CERNIQ] Revoked agent ${event.data.agentId} — cache cleared`);
    }

    if (event.type === 'policy.updated') {
      await verifier.invalidateAgent(event.data.agentId); // bust policy cache too
    }

    res.json({ received: true });
  };
}

// Register webhook handler
app.post(
  '/webhooks/cerniq',
  express.raw({ type: 'application/json' }), // preserve rawBody for HMAC
  (req, res, next) => {
    (req as any).rawBody = req.body;
    req.body = JSON.parse(req.body.toString());
    next();
  },
  createWebhookHandler(verifier, process.env.CERNIQ_WEBHOOK_SECRET!),
);
```

Register the webhook:

```bash
cerniq webhooks create \
  --url https://your-api.com/webhooks/cerniq \
  --events agent.revoked policy.updated \
  --description "My relying party webhook"
```

---

## 9. TypeScript Types Reference

```typescript
import type { VerifyOutcome, TrustBand, DenialReason } from '@cerniq/verifier-rp';

// Successful verify result
interface ApprovedResult {
  approved: true;
  agentId: string;
  trustBand: TrustBand; // 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED'
  trustScore: number; // 0-1000
  scopes: string[]; // scopes granted in this token
  auditEventId: string; // reference to audit log
  expiresAt: Date; // when this token expires
}

// Denied verify result
interface DeniedResult {
  approved: false;
  denialReason: DenialReason; // one of 9 reasons
  agentId?: string; // may be undefined if AGENT_NOT_FOUND
  auditEventId?: string; // audit event if agent was found
}

type VerifyResult = ApprovedResult | DeniedResult;

// DenialReason union:
type DenialReason =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_REVOKED'
  | 'POLICY_EXPIRED'
  | 'SCOPE_NOT_GRANTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED';
```

---

## 10. Performance Notes

The verifier-rp is designed for high-frequency use:

- **Ed25519 verify:** ~0.5ms per call (pure `@noble/ed25519`)
- **JWKS cache:** stale-while-revalidate, refresh every 5 minutes
- **Replay LRU:** in-memory, configurable size (default: 10K entries, 30s TTL)
- **Revocation cache:** in-memory + webhook invalidation

At 1000 RPS on a single Node.js process, verifier-rp adds ~1ms median latency.

```typescript
const verifier = new CerniqVerifier({
  cerniqUrl: 'https://api.cerniqapp.com',
  apiKey: process.env.CERNIQ_API_KEY!,

  // Tune for high throughput
  jwksCacheTtlMs: 5 * 60 * 1000, // 5 minutes
  replayCacheSize: 50_000, // 50K JTIs
  revocationCacheTtlMs: 60 * 1000, // 1 minute (webhook updates immediately)
});
```

---

_Express/Fastify/Hono integration guide version: 1.0 | CERNIQ Phase 1_
