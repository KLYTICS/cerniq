# OKORO — Express / Fastify / Hono Integration Guide
## Protecting Relying-Party APIs with Offline JWT Verification

> **Updated:** 2026-05-04  
> **Package:** `@okoro/verifier-rp`  
> **Use this guide** when you're building an API or service that AI agents call, and you want to verify their OKORO identity before processing requests.

---

## 1. Overview

`@okoro/verifier-rp` is a drop-in offline verifier for relying parties — services that receive requests from OKORO-verified agents. It:

- Verifies Ed25519 JWT signatures offline (no network call on the hot path)
- Caches public keys with SWR (stale-while-revalidate) refresh
- Maintains a replay prevention LRU cache (JTI-based)
- Maintains a revocation cache (refreshed via webhooks or polling)
- Ships adapters for Express, Fastify, Hono, and vanilla middleware

**Zero `node:crypto` dependency** — runs on Cloudflare Workers, Deno, Bun, and Node.js.

---

## 2. Install

```bash
npm install @okoro/verifier-rp
# or
pnpm add @okoro/verifier-rp
```

---

## 3. Express Integration

### 3.1 Middleware Setup

```typescript
import express from 'express';
import { createExpressMiddleware } from '@okoro/verifier-rp/express';

const app = express();

// Create the middleware
const okoroMiddleware = createExpressMiddleware({
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
  
  // Optional configuration
  requiredScopes: ['payment:read'],        // require these scopes on all protected routes
  trustBandMinimum: 'VERIFIED',            // reject WATCH/FLAGGED agents
  tokenHeader: 'x-okoro-token',           // default: Authorization: Bearer
  relyingPartyId: process.env.OKORO_RP_ID, // optional: for analytics
});

// Apply to specific routes
app.get('/api/account', okoroMiddleware, (req, res) => {
  // req.okoro is injected by the middleware:
  // req.okoro.agentId    — verified agent ID
  // req.okoro.trustBand  — PLATINUM | VERIFIED | WATCH | FLAGGED
  // req.okoro.trustScore — 0-1000
  // req.okoro.scopes     — scopes granted to this token
  // req.okoro.auditId    — audit event ID for this request
  
  res.json({
    message: `Hello, agent ${req.okoro.agentId}`,
    trustBand: req.okoro.trustBand,
  });
});

// Or apply globally
app.use('/api/agents/*', okoroMiddleware);
```

### 3.2 Per-Route Scope Requirements

```typescript
import { createExpressMiddleware } from '@okoro/verifier-rp/express';

// Create middleware with different scope requirements per route
const requireRead = createExpressMiddleware({
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
  requiredScopes: ['payment:read'],
});

const requireWrite = createExpressMiddleware({
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
  requiredScopes: ['payment:write'],
  trustBandMinimum: 'VERIFIED', // writes require higher trust
});

app.get('/api/balance', requireRead, getBalanceHandler);
app.post('/api/transfer', requireWrite, transferHandler);
```

### 3.3 Custom Denial Response

```typescript
const okoroMiddleware = createExpressMiddleware({
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
  
  onDenied: (result, req, res) => {
    // Customize the denial response
    const statusCode = {
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
    metrics.increment('okoro.denied', { reason: result.denialReason });
  },
});
```

---

## 4. Fastify Integration

```typescript
import Fastify from 'fastify';
import { createFastifyPlugin } from '@okoro/verifier-rp/fastify';

const fastify = Fastify({ logger: true });

// Register as a Fastify plugin
await fastify.register(createFastifyPlugin, {
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
  routePrefix: '/api', // only protect /api/* routes
});

// Protected route — req.okoro is available after verification
fastify.get('/api/data', {
  config: {
    okoro: {
      requiredScopes: ['data:read'],
      trustBandMinimum: 'WATCH', // allow WATCH+ for read operations
    },
  },
}, async (request, reply) => {
  return {
    agentId: request.okoro.agentId,
    data: await fetchData(request.okoro.agentId),
  };
});

// Route without OKORO protection (public endpoint)
fastify.get('/health', async () => ({ status: 'ok' }));

await fastify.listen({ port: 3000 });
```

### 4.1 Fastify Schema Integration

```typescript
// Add OKORO context to your Fastify TypeScript types
declare module 'fastify' {
  interface FastifyRequest {
    okoro: {
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

Hono works on Cloudflare Workers, Deno, Bun, and Node.js. `@okoro/verifier-rp` has zero `node:crypto` for exactly this use case:

```typescript
import { Hono } from 'hono';
import { createHonoMiddleware } from '@okoro/verifier-rp/hono';

const app = new Hono();

const okoroMiddleware = createHonoMiddleware({
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
});

app.use('/api/*', okoroMiddleware);

app.get('/api/quote', async (c) => {
  const okoro = c.get('okoro'); // injected by middleware
  return c.json({
    agentId: okoro.agentId,
    quote: await generateQuote(okoro.agentId, okoro.trustBand),
  });
});

export default app;
```

Cloudflare Workers deployment:
```typescript
// worker.ts
import { Hono } from 'hono';
import { createHonoMiddleware } from '@okoro/verifier-rp/hono';

const app = new Hono<{ Bindings: { OKORO_API_KEY: string } }>();

app.use('/api/*', async (c, next) => {
  const middleware = createHonoMiddleware({
    okoroUrl: 'https://api.okorolabs.io',
    apiKey: c.env.OKORO_API_KEY, // from Cloudflare secrets
  });
  return middleware(c, next);
});

export default app;
```

---

## 6. Vanilla Middleware (Framework-Agnostic)

For any HTTP framework:

```typescript
import { OkoroVerifier } from '@okoro/verifier-rp';

const verifier = new OkoroVerifier({
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
  // Warm up JWKS cache at startup (optional but recommended)
  prefetchJwks: true,
});

// Warm up at startup
await verifier.prefetchJwks();

// Use in any middleware/handler
async function verifyRequest(token: string, options?: {
  requiredScopes?: string[];
  minTrustBand?: string;
}) {
  const result = await verifier.verify(token, {
    scopes: options?.requiredScopes,
    trustBandMinimum: options?.minTrustBand,
  });
  
  if (!result.approved) {
    throw new Error(`OKORO denied: ${result.denialReason}`);
  }
  
  return result; // { agentId, trustBand, trustScore, scopes, auditEventId }
}
```

---

## 7. Advanced: Spend Tracking at the Relying Party

Sometimes the relying party knows the spend amount better than the agent does. Use the `reportSpend` option:

```typescript
// In your handler, after the operation completes
app.post('/api/execute-trade', okoroMiddleware, async (req, res) => {
  const { ticker, quantity } = req.body;
  
  // Execute the trade
  const tradeResult = await tradingService.execute({ ticker, quantity });
  
  // Report actual spend back to OKORO (out-of-band, doesn't block response)
  await verifier.reportSpend({
    agentId: req.okoro.agentId,
    amount: tradeResult.totalCost,
    currency: 'USD',
    operationId: req.okoro.auditEventId, // link to audit event
  });
  
  res.json({ success: true, trade: tradeResult });
});
```

---

## 8. Webhook Handler for Revocation

Keep your relying party's revocation cache fresh:

```typescript
import { createHmac } from 'crypto';
import type { OkoroVerifier } from '@okoro/verifier-rp';

function createWebhookHandler(verifier: OkoroVerifier, webhookSecret: string) {
  return async (req: express.Request, res: express.Response) => {
    // 1. Verify HMAC signature
    const sig = req.headers['x-okoro-signature'] as string;
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
      console.log(`[OKORO] Revoked agent ${event.data.agentId} — cache cleared`);
    }
    
    if (event.type === 'policy.updated') {
      await verifier.invalidateAgent(event.data.agentId); // bust policy cache too
    }
    
    res.json({ received: true });
  };
}

// Register webhook handler
app.post('/webhooks/okoro', 
  express.raw({ type: 'application/json' }), // preserve rawBody for HMAC
  (req, res, next) => {
    (req as any).rawBody = req.body;
    req.body = JSON.parse(req.body.toString());
    next();
  },
  createWebhookHandler(verifier, process.env.OKORO_WEBHOOK_SECRET!)
);
```

Register the webhook:
```bash
okoro webhooks create \
  --url https://your-api.com/webhooks/okoro \
  --events agent.revoked policy.updated \
  --description "My relying party webhook"
```

---

## 9. TypeScript Types Reference

```typescript
import type { VerifyOutcome, TrustBand, DenialReason } from '@okoro/verifier-rp';

// Successful verify result
interface ApprovedResult {
  approved: true;
  agentId: string;
  trustBand: TrustBand;          // 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED'
  trustScore: number;            // 0-1000
  scopes: string[];              // scopes granted in this token
  auditEventId: string;          // reference to audit log
  expiresAt: Date;               // when this token expires
}

// Denied verify result
interface DeniedResult {
  approved: false;
  denialReason: DenialReason;    // one of 9 reasons
  agentId?: string;              // may be undefined if AGENT_NOT_FOUND
  auditEventId?: string;         // audit event if agent was found
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
const verifier = new OkoroVerifier({
  okoroUrl: 'https://api.okorolabs.io',
  apiKey: process.env.OKORO_API_KEY!,
  
  // Tune for high throughput
  jwksCacheTtlMs: 5 * 60 * 1000,    // 5 minutes
  replayCacheSize: 50_000,            // 50K JTIs
  revocationCacheTtlMs: 60 * 1000,   // 1 minute (webhook updates immediately)
});
```

---

*Express/Fastify/Hono integration guide version: 1.0 | OKORO Phase 1*
