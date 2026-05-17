// Server-side API client for the AEGIS dashboard.
//
// Phase 1 contract: every fetch is server-side (Next.js Server Components or
// Server Actions). The client never sees the API key. When Auth0 wiring lands
// (M-020), `getSessionApiKey()` will resolve a per-principal key bound to the
// user session; until then we fall back to `AEGIS_DASHBOARD_API_KEY`.
//
// All methods return typed results or throw `AegisApiError`. Pages render
// errors via boundaries — never fabricate empty results to mask failure
// (CLAUDE.md invariant 4).

import { getSessionApiKey } from './auth';

// Header constants — kept local rather than imported because the SDK does
// not re-export them and the dashboard doesn't depend on the SDK runtime.
// The values are part of the public AEGIS API contract — see packages/types
// constants.ts.
const AEGIS_HEADER_API_KEY = 'X-AEGIS-API-Key';
const AEGIS_HEADER_REQUEST_ID = 'X-Request-Id';

const DEFAULT_TIMEOUT_MS = 8_000;

export interface AgentRow {
  agentId: string;
  publicKey: string;
  principalId: string;
  runtime: string;
  model: string | null;
  label: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  trustScore: number;
  trustBand: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  registeredAt: string;
  lastSeenAt: string | null;
}

export interface AgentListResult {
  agents: AgentRow[];
  nextCursor: string | null;
  total: number;
}

export interface AgentListParams {
  limit?: number;
  cursor?: string;
  status?: AgentRow['status'];
  runtime?: string;
  search?: string;
}

export interface PolicyRow {
  policyId: string;
  agentId: string;
  signedToken: string;
  scopes: unknown[];
  expiresAt: string;
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  label?: string | null;
}

export interface AuditRow {
  id: string;
  agentId: string;
  decision: 'approved' | 'denied' | 'flagged';
  decisionReason?: string | null;
  /**
   * Closed-enum discriminator below `decisionReason`. Present on denial
   * rows when the API populates it (planned: future audit-row schema
   * extension once verify-side denialContext is persisted on
   * `AuditEvent`). Until then, this field is always absent. Surfacing
   * it now keeps the type contract honest and lets the UI render the
   * kind label as soon as the API ships it.
   *
   * Closed-enum values: see `@aegis/types` `DENIAL_CONTEXT_KINDS`.
   */
  denialContextKind?: string | null;
  policyId?: string | null;
  amount?: number | null;
  currency?: string | null;
  domain?: string | null;
  signature: string;
  prevHash: string;
  timestamp: string;
}

export interface AuditPage {
  events: AuditRow[];
  nextCursor: string | null;
}

export class AegisApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'AegisApiError';
  }
}

export class AegisAuthMissingError extends AegisApiError {
  constructor() {
    super(0, 'NO_API_KEY', 'No AEGIS API key available for this dashboard session.');
    this.name = 'AegisAuthMissingError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const apiKey = await getSessionApiKey();
  if (!apiKey) throw new AegisAuthMissingError();

  const baseUrl = process.env.AEGIS_API_BASE_URL ?? 'http://localhost:4000';
  const url = buildUrl(baseUrl, `/v1/${path.replace(/^\/?(v1\/)?/, '')}`, opts.query);

  // Combine caller-provided AbortSignal with the timeout. If both fire, the
  // first one wins; the request rejects with a stable shape regardless.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('request_timeout')), DEFAULT_TIMEOUT_MS);
  const onAbort = (): void => ac.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        [AEGIS_HEADER_API_KEY]: apiKey,
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: ac.signal,
    });

    const requestId = res.headers.get(AEGIS_HEADER_REQUEST_ID) ?? undefined;

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const payload = text ? safeJson(text) : undefined;

    if (!res.ok) {
      const code = (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as Record<string, unknown>).error)
        : `HTTP_${res.status}`) as string;
      const message = (payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as Record<string, unknown>).message)
        : res.statusText) as string;
      throw new AegisApiError(res.status, code, message, requestId);
    }
    return payload as T;
  } catch (err) {
    if (err instanceof AegisApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AegisApiError(0, 'TIMEOUT', `Request to AEGIS API timed out after ${DEFAULT_TIMEOUT_MS}ms.`);
    }
    const msg = err instanceof Error ? err.message : 'unknown';
    throw new AegisApiError(0, 'NETWORK_ERROR', `AEGIS API unreachable: ${msg}`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Public surface ────────────────────────────────────────────────────────

export async function listAgents(params: AgentListParams = {}): Promise<AgentListResult> {
  return request<AgentListResult>('agents', { query: { ...params } });
}

export async function getAgent(agentId: string): Promise<AgentRow> {
  return request<AgentRow>(`agents/${encodeURIComponent(agentId)}`);
}

export async function registerAgent(input: {
  publicKey: string;
  runtime: string;
  model?: string;
  label?: string;
}): Promise<AgentRow> {
  return request<AgentRow>('agents/register', { method: 'POST', body: input });
}

export async function revokeAgent(agentId: string): Promise<void> {
  await request<void>(`agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
}

export async function listPolicies(agentId: string): Promise<PolicyRow[]> {
  return request<PolicyRow[]>(`agents/${encodeURIComponent(agentId)}/policies`);
}

export async function revokePolicy(agentId: string, policyId: string): Promise<void> {
  await request<void>(
    `agents/${encodeURIComponent(agentId)}/policies/${encodeURIComponent(policyId)}`,
    { method: 'DELETE' },
  );
}

export async function listAudit(
  agentId: string,
  params: { limit?: number; cursor?: string; from?: string; to?: string } = {},
): Promise<AuditPage> {
  return request<AuditPage>(`agents/${encodeURIComponent(agentId)}/audit`, { query: { ...params } });
}

// ── Handshake (M-003) ─────────────────────────────────────────────────────

export interface HandshakeStatus {
  agentId: string;
  verified: boolean;
  verifiedAt?: string;
  protocolVersion?: 'aegis-handshake-v1';
}

export async function getHandshakeStatus(agentId: string): Promise<HandshakeStatus> {
  return request<HandshakeStatus>(`agents/${encodeURIComponent(agentId)}/handshake-status`);
}

// ── Webhooks ─────────────────────────────────────────────────────────────

export interface WebhookSubscriptionRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

export async function listWebhooks(): Promise<WebhookSubscriptionRow[]> {
  return request<WebhookSubscriptionRow[]>('webhooks');
}

export async function createWebhook(input: {
  url: string;
  events: string[];
}): Promise<{ id: string; secret: string }> {
  return request<{ id: string; secret: string }>('webhooks', { method: 'POST', body: input });
}

export async function deleteWebhook(id: string): Promise<void> {
  await request<void>(`webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Billing ──────────────────────────────────────────────────────────────

export interface PlanSummary {
  planTier: 'FREE' | 'DEVELOPER' | 'GROWTH' | 'ENTERPRISE';
  monthlyQuota: number;
  remaining: number;
  monthVerifyCount: number;
  hardStop: boolean;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export async function getPlanSummary(): Promise<PlanSummary> {
  return request<PlanSummary>('billing/plan');
}

export async function createCheckout(planTier: 'DEVELOPER' | 'GROWTH'): Promise<{ url: string }> {
  return request<{ url: string }>('billing/checkout', { method: 'POST', body: { planTier } });
}
