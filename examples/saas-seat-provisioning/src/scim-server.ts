// SCIM-shaped agent provisioning endpoint.
//
// The SaaS owns:
//   - the SCIM endpoint surface (auth, schema, filtering)
//   - the seat table (tier, tenant, externalId, agentId, policyId)
//   - the per-tier policy template (scope, spend cap, domains)
//
// CERNIQ owns:
//   - the cryptographic agent identity
//   - the signed policy JWT
//   - the audit chain
//
// On POST /scim/v2/Agents the SaaS:
//   1. Validates the SCIM body.
//   2. cerniq.agents.register() — creates the cryptographic identity.
//   3. cerniq.policies.create() — mints a tier-shaped scoped policy.
//   4. Persists a seat row joining (tenant, externalId, agentId, policyId).
//   5. Returns the SCIM-shaped 201 Created.
//
// On DELETE the SaaS revokes both the CERNIQ agent (immediate) and the
// policy (idempotent — agent revocation kills any signed token anyway).

import express, { type Request, type Response } from 'express';
import { Cerniq } from '@cerniq/sdk';

const cerniq = new Cerniq({
  baseUrl: process.env.CERNIQ_API_BASE ?? 'https://api.cerniq.io',
  apiKey: requireEnv('CERNIQ_API_KEY'),
});

const tenantId = requireEnv('SAAS_TENANT_ID');

// In production this is a real DB. In-memory map keeps the example
// readable; the policy-per-tier mapping is the part that matters.
const seats = new Map<string, SeatRow>();

const POLICY_TEMPLATES: Record<SeatTier, PolicyTemplate> = {
  free: { scope: 'read:basic', maxPerDay: '0.00', domains: [] },
  pro: { scope: 'read:basic write:own', maxPerDay: '100.00', domains: ['*.your-saas.com'] },
  business: { scope: 'read:basic write:any', maxPerDay: '1000.00', domains: ['*.your-saas.com'] },
  enterprise: { scope: '*', maxPerDay: '99999.00', domains: ['*.your-saas.com'] },
};

const app = express();
app.use(express.json({ type: ['application/json', 'application/scim+json'] }));

app.post('/scim/v2/Agents', async (req: Request, res: Response) => {
  const body = req.body as ScimCreateBody;
  if (!body || !body.externalId || !body.displayName || !body.publicKey) {
    return res
      .status(400)
      .json(scimError('invalidValue', 'externalId, displayName, publicKey required'));
  }
  // SCIM idempotency: re-POSTing the same externalId returns the
  // existing row, not 409 Conflict (per RFC 7644 §3.3).
  const key = `${tenantId}::${body.externalId}`;
  const existing = seats.get(key);
  if (existing) return res.status(200).json(scimRender(existing));

  const tier: SeatTier = (body.urn?.['urn:cerniq:saas:1.0:Agent']?.tier ?? 'free') as SeatTier;
  const tpl = POLICY_TEMPLATES[tier];
  if (!tpl) {
    return res.status(400).json(scimError('invalidValue', `unknown tier ${tier}`));
  }

  const agent = await cerniq.agents.register({
    publicKey: body.publicKey,
    runtime: 'CUSTOM',
    metadata: { tenantId, externalId: body.externalId, displayName: body.displayName },
  });
  const policy = await cerniq.policies.create({
    agentId: agent.id,
    scope: tpl.scope,
    maxPerDay: tpl.maxPerDay,
    allowedDomains: tpl.domains,
    expiresInSeconds: 365 * 86400,
  });
  const seat: SeatRow = {
    id: 'seat_' + body.externalId,
    tenantId,
    externalId: body.externalId,
    displayName: body.displayName,
    tier,
    agentId: agent.id,
    policyId: policy.id,
    createdAt: new Date().toISOString(),
  };
  seats.set(key, seat);
  return res.status(201).json(scimRender(seat));
});

app.get('/scim/v2/Agents/:id', (req, res) => {
  for (const seat of seats.values()) {
    if (seat.id === req.params.id) return res.json(scimRender(seat));
  }
  return res.status(404).json(scimError('notFound', `no agent ${req.params.id}`));
});

app.delete('/scim/v2/Agents/:id', async (req, res) => {
  for (const [key, seat] of seats.entries()) {
    if (seat.id !== req.params.id) continue;
    await cerniq.agents.revoke(seat.agentId).catch(() => undefined);
    await cerniq.policies.revoke(seat.policyId).catch(() => undefined);
    seats.delete(key);
    return res.status(204).end();
  }
  return res.status(404).json(scimError('notFound', `no agent ${req.params.id}`));
});

app.get('/scim/v2/ServiceProviderConfig', (_req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://docs.cerniq.io/integrations/scim',
    patch: { supported: false },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      { type: 'httpbasic', name: 'HTTP Basic', description: 'Customer IDP API key' },
    ],
  });
});

const port = Number(process.env.PORT ?? '3002');
app.listen(port, () => {
  process.stderr.write(`saas-seat-provisioning SCIM server on :${port}\n`);
});

// types -----------------------------------------------------------

type SeatTier = 'free' | 'pro' | 'business' | 'enterprise';

interface PolicyTemplate {
  scope: string;
  maxPerDay: string;
  domains: string[];
}

interface SeatRow {
  id: string;
  tenantId: string;
  externalId: string;
  displayName: string;
  tier: SeatTier;
  agentId: string;
  policyId: string;
  createdAt: string;
}

interface ScimCreateBody {
  externalId: string;
  displayName: string;
  publicKey: string;
  urn?: { 'urn:cerniq:saas:1.0:Agent'?: { tier?: SeatTier } };
}

function scimRender(seat: SeatRow): Record<string, unknown> {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Agent', 'urn:cerniq:saas:1.0:Agent'],
    id: seat.id,
    externalId: seat.externalId,
    displayName: seat.displayName,
    'urn:cerniq:saas:1.0:Agent': {
      tier: seat.tier,
      agentId: seat.agentId,
      policyId: seat.policyId,
    },
    meta: { resourceType: 'Agent', created: seat.createdAt },
  };
}

function scimError(scimType: string, detail: string): Record<string, unknown> {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    scimType,
    detail,
    status: scimType === 'notFound' ? '404' : '400',
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`saas-seat-provisioning: ${name} is required`);
  }
  return v;
}
