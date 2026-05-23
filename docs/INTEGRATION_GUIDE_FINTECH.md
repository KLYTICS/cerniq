# OKORO — Fintech Integration Guide

## AI Agent Payments with Stripe + OKORO (ACP Compatibility)

> **Updated:** 2026-05-04  
> **Pattern:** OKORO handles agent identity + spend gates. Stripe handles money movement.  
> **ACP:** OKORO is additive to OpenAI/Stripe Agentic Commerce Protocol.

---

## 1. The Problem OKORO Solves for Fintech

Stripe can process payments. Stripe cannot answer:

- Is this AI agent authorized by a human to make this payment?
- Has this agent already spent $900 today (out of a $1,000 limit)?
- Was this payment approved by a policy signed by the agent's owner?
- If something goes wrong, is there a tamper-evident audit trail?

OKORO handles all four. Stripe handles the money. They're complementary, not competing.

---

## 2. Architecture: OKORO + Stripe

```
Human sets up:
  OKORO principal → agent registered → policy: "max $500/day, scope: payment:write"
  Stripe customer → payment method on file

AI agent wants to pay:
  1. Agent signs JWT: { sub: agent_id, scopes: ["payment:write"], amt: 99.00, cur: "USD" }
  2. Your payment service calls OKORO /v1/verify
  3. OKORO checks: identity ✓, policy ✓, spend limit ✓, trust band ✓
  4. OKORO returns: { approved: true, auditEventId: "evt_abc" }
  5. Your payment service calls Stripe with payment intent
  6. Stripe charges the card
  7. Your service appends the Stripe payment ID to the audit trail

Result: full chain of custody from agent authorization → payment execution → receipt
```

---

## 3. Express + Stripe + OKORO

### 3.1 Payment Route

```typescript
import express from 'express';
import Stripe from 'stripe';
import { createExpressMiddleware } from '@okoro/verifier-rp/express';
import { OkoroClient } from '@okoro/sdk';

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const okoro = new OkoroClient({
  apiKey: process.env.OKORO_API_KEY!,
});

// OKORO middleware: verify agent identity before ANY payment processing
const requirePaymentAuth = createExpressMiddleware({
  okoroUrl: 'https://api.okoroapp.com',
  apiKey: process.env.OKORO_API_KEY!,
  requiredScopes: ['payment:write'],
  trustBandMinimum: 'VERIFIED', // payments require VERIFIED or better
});

// Payment endpoint
app.post('/api/payments/charge', express.json(), requirePaymentAuth, async (req, res) => {
  const { amount, currency, description } = req.body;
  const { agentId, trustBand, auditEventId } = req.okoro;

  // At this point:
  // ✅ Agent identity verified (Ed25519 signature)
  // ✅ Policy checked (scope: payment:write)
  // ✅ Spend limit checked ($amount counted against daily limit)
  // ✅ Trust band verified (VERIFIED or PLATINUM)
  // ✅ Audit event written (signed, in chain)

  try {
    // Now do the actual Stripe charge
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents
      currency: currency.toLowerCase(),
      confirm: true,
      payment_method: await getAgentPaymentMethod(agentId),
      metadata: {
        // Link Stripe to OKORO audit trail
        okoro_agent_id: agentId,
        okoro_audit_event_id: auditEventId,
        okoro_trust_band: trustBand,
        description,
      },
    });

    res.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      auditEventId, // agent can reference this
      trustBand, // informational
    });
  } catch (stripeError) {
    // Payment failed — OKORO already recorded the attempt in audit log
    // Roll back spend counter (OKORO provides a spend rollback API)
    await okoro.verify.rollbackSpend(auditEventId);

    res.status(400).json({
      success: false,
      error: 'Payment failed',
      stripeError: (stripeError as Stripe.errors.StripeError).message,
      auditEventId, // still reference the attempt
    });
  }
});
```

### 3.2 Linking Payment Methods to Agents

Agents don't carry payment credentials — they're linked via your principal's Stripe customer:

```typescript
// When onboarding a new principal (human user):
async function onboardPrincipal(email: string, stripeCustomerId: string, agentIds: string[]) {
  // Store the mapping: principalId → stripeCustomerId
  await db.principals.update({
    where: { email },
    data: { stripeCustomerId },
  });

  // Register agents in OKORO
  for (const agentId of agentIds) {
    await okoro.agents.update(agentId, {
      metadata: { stripeCustomerId }, // link for payment routing
    });
  }
}

// When agent wants to pay:
async function getAgentPaymentMethod(agentId: string): Promise<string> {
  const agent = await okoro.agents.get(agentId);
  const customer = await stripe.customers.retrieve(agent.metadata.stripeCustomerId);
  // Return the default payment method
  return (customer as Stripe.Customer).invoice_settings.default_payment_method as string;
}
```

---

## 4. Spend Limit Patterns

### 4.1 Daily Spend Limit

```typescript
// Set up spend policy for an agent
await okoro.policies.apply({
  agentId: 'agent_xyz',
  scope: 'payment:write',
  spendLimit: {
    amount: 1000, // $1,000 per day
    currency: 'USD',
    window: 'day',
    action: 'deny', // deny (default) or alert
  },
});
```

### 4.2 Per-Transaction Limit

```typescript
await okoro.policies.apply({
  agentId: 'agent_xyz',
  scope: 'payment:write',
  spendLimit: {
    amount: 500, // max $500 per single transaction
    currency: 'USD',
    window: 'call', // per-call limit
    action: 'deny',
  },
});
```

### 4.3 Tiered Limits (Require Human Approval Above Threshold)

```typescript
// Pattern: auto-approve up to $100, require human approval above
app.post('/api/payments/charge', requirePaymentAuth, async (req, res) => {
  const { amount } = req.body;

  if (amount > 100) {
    // Large amount: require explicit human-in-the-loop approval
    const approval = await requestHumanApproval({
      agentId: req.okoro.agentId,
      amount,
      reason: req.body.description,
    });

    if (!approval.approved) {
      return res.status(403).json({
        error: 'HUMAN_APPROVAL_REQUIRED',
        approvalRequestId: approval.id,
      });
    }

    // Human approved — proceed with Stripe
  }

  // < $100: OKORO already verified, proceed directly
  await processStripePayment(req);
});
```

---

## 5. ACP (Agentic Commerce Protocol) Compatibility

OKORO is additive to ACP. Here's how they compose:

```
ACP handles:
  - Payment method storage
  - Currency conversion
  - Transaction processing
  - Dispute resolution

OKORO handles (before ACP):
  - Agent identity (who is making this request?)
  - Authorization (is this agent allowed to make payments?)
  - Spend gates (has this agent spent too much today?)
  - Audit trail (provable record of authorization)

Combined flow:
  Agent → [OKORO verify] → [ACP payment] → Receipt
```

### 5.1 ACP Token + OKORO Token

When an agent presents both an ACP token and an OKORO token:

```typescript
app.post('/api/acp/payment', async (req, res) => {
  const { acpToken, okoroToken } = req.body;

  // 1. Verify OKORO identity and policy first
  const okoroResult = await verifier.verify(okoroToken, {
    requiredScopes: ['payment:write'],
    trustBandMinimum: 'VERIFIED',
  });

  if (!okoroResult.approved) {
    return res.status(403).json({
      error: okoroResult.denialReason,
      source: 'okoro',
    });
  }

  // 2. Now process the ACP token (Stripe/payment rail)
  const acpResult = await acpClient.processPayment(acpToken, {
    okoroAuditId: okoroResult.auditEventId, // link the two audit trails
  });

  res.json({ success: true, acpResult, okoroAuditId: okoroResult.auditEventId });
});
```

---

## 6. Fraud Detection Integration

OKORO BATE signals can feed your fraud detection system:

```typescript
// After OKORO verify, use the trust signal to route payments
app.post('/api/payments/charge', requirePaymentAuth, async (req, res) => {
  const { trustBand, trustScore } = req.okoro;

  // Route based on BATE trust band
  if (trustBand === 'FLAGGED') {
    // High risk: block and flag for review
    await fraudReview.flag({
      agentId: req.okoro.agentId,
      amount: req.body.amount,
      reason: 'low_trust_band',
      okoroAuditId: req.okoro.auditEventId,
    });
    return res.status(403).json({ error: 'FRAUD_REVIEW_REQUIRED' });
  }

  if (trustBand === 'WATCH' && req.body.amount > 200) {
    // Medium risk: require additional verification
    return res.status(403).json({
      error: 'ADDITIONAL_VERIFICATION_REQUIRED',
      trustBand,
      maxAutoApproveAmount: 200,
    });
  }

  // VERIFIED and PLATINUM: normal processing
  await processStripePayment(req);
});
```

---

## 7. Refund and Rollback Flows

When a transaction fails or needs to be refunded:

```typescript
// Stripe webhook: charge.failed
app.post('/webhooks/stripe', async (req, res) => {
  const event = stripe.webhooks.constructEvent(
    req.rawBody,
    req.headers['stripe-signature'],
    process.env.STRIPE_WEBHOOK_SECRET!,
  );

  if (event.type === 'charge.failed') {
    const charge = event.data.object as Stripe.Charge;
    const okoroAuditId = charge.metadata.okoro_audit_event_id;

    if (okoroAuditId) {
      // Roll back the spend counter in OKORO
      // This allows the agent to retry (spend not consumed by failed payment)
      await okoro.verify.rollbackSpend(okoroAuditId);
      console.log(`Spend rolled back for audit event ${okoroAuditId}`);
    }
  }

  res.json({ received: true });
});

// Manual refund with audit trail
app.post('/api/payments/refund', async (req, res) => {
  const { paymentIntentId, reason } = req.body;

  // Create Stripe refund
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });

  // Append refund to OKORO audit trail
  await okoro.audit.append({
    agentId: req.okoro.agentId,
    action: 'payment:refund',
    metadata: {
      stripeRefundId: refund.id,
      originalPaymentIntentId: paymentIntentId,
      reason,
    },
  });

  res.json({ success: true, refundId: refund.id });
});
```

---

## 8. Compliance Reporting

Generate audit reports for compliance (SOC2, PCI-DSS):

```typescript
// Monthly payment audit report
async function generateComplianceReport(principalId: string, month: string) {
  const events = await okoro.audit.export({
    principalId,
    from: `${month}-01T00:00:00Z`,
    to: `${month}-31T23:59:59Z`,
    outcomes: ['approved', 'denied'],
    actions: ['payment:write', 'payment:read'],
    includeChainProof: true, // cryptographic proof of integrity
  });

  return {
    period: month,
    totalPayments: events.filter((e) => e.outcome === 'approved').length,
    totalDenied: events.filter((e) => e.outcome === 'denied').length,
    totalAmountApproved: events
      .filter((e) => e.outcome === 'approved' && e.amount)
      .reduce((sum, e) => sum + e.amount!, 0),
    byAgent: groupBy(events, 'agentId'),
    chainIntegrityProof: events[events.length - 1].chainProof,
    // Any auditor can verify this proof independently
  };
}
```

---

## 9. Environment Variables

```bash
# OKORO
OKORO_API_KEY=ak_live_xxxx
OKORO_AGENT_ID=agent_xxxx
OKORO_PRIVATE_KEY=base64_ed25519_private_key
OKORO_RELYING_PARTY_ID=rp_xxxx         # Register your service as a RP
OKORO_WEBHOOK_SECRET=whsec_xxxx        # For revocation webhooks

# Stripe
STRIPE_SECRET_KEY=sk_live_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx

# Your service
DATABASE_URL=postgresql://...
```

---

## 10. Security Checklist

Before going live with OKORO + Stripe payments:

```
[ ] OKORO_PRIVATE_KEY is stored in secrets manager, not environment variable
[ ] Stripe webhook signature verified on every webhook event
[ ] OKORO webhook signature verified on every OKORO event
[ ] Spend limits are set on all agents (no unbounded agents)
[ ] Trust band minimum is VERIFIED for payment:write scope
[ ] Refund rollback webhook is wired (prevents double-counting on Stripe failure)
[ ] Audit export tested: chain proof verifiable by third party
[ ] Revocation test: revoking an agent stops payments within 30 seconds
[ ] No raw payment card data passes through your server (Stripe handles it)
[ ] Daily spend limits tested: 11th call at $100 limit hits SPEND_LIMIT_EXCEEDED
```

---

_Fintech integration guide version: 1.0 | OKORO Phase 1_
