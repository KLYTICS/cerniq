import type { HttpClient } from './http.js';
import type {
  CreatePolicyBundle,
  CreatePolicyInput,
  PolicyListItem,
  PolicyListResponse,
  PolicyRecord,
  PolicyStatus,
} from './types.js';

/**
 * Overloads union for {@link PolicyClient.create}. The 2-arg form is the
 * canonical low-level call (agentId in the URL, body fields separately);
 * the single-object bundle form (OD-024 Option A) lets CLI / dashboard
 * pass everything in one bag with `expiresInSeconds` TTL-from-now sugar.
 */
function isCreatePolicyBundle(
  first: string | CreatePolicyBundle,
): first is CreatePolicyBundle {
  return typeof first !== 'string';
}

export class PolicyClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * Canonical 2-arg form: `create(agentId, input)`.
   */
  create(agentId: string, input: CreatePolicyInput): Promise<PolicyRecord>;
  /**
   * Bundle form (OD-024 Option A): `create({ agentId, scopes, ... })`.
   * `expiresInSeconds` is resolved to an absolute `expiresAt` server-side
   * by computing `Date.now() + expiresInSeconds*1000`. If both fields are
   * supplied, `expiresInSeconds` wins (more declarative).
   */
  create(input: CreatePolicyBundle): Promise<PolicyRecord>;
  // `async` matters: the overload branches throw synchronously on
  // missing-input invariants. Without `async`, those throws would
  // propagate as sync exceptions rather than Promise rejections —
  // inconsistent with the rest of the client and surprising to
  // `await`-style callers.
  async create(
    first: string | CreatePolicyBundle,
    maybeInput?: CreatePolicyInput,
  ): Promise<PolicyRecord> {
    let agentId: string;
    let body: { label?: string; scopes: CreatePolicyInput['scopes']; expiresAt: string };
    if (isCreatePolicyBundle(first)) {
      agentId = first.agentId;
      const expiresAt =
        first.expiresInSeconds !== undefined
          ? new Date(Date.now() + first.expiresInSeconds * 1000).toISOString()
          : first.expiresAt instanceof Date
            ? first.expiresAt.toISOString()
            : (first.expiresAt ?? '');
      if (!expiresAt) {
        throw new Error(
          'PolicyClient.create: bundle form requires `expiresInSeconds` or `expiresAt`',
        );
      }
      body = { label: first.label, scopes: first.scopes, expiresAt };
    } else {
      if (!maybeInput) {
        throw new Error('PolicyClient.create: 2-arg form requires `input` as second argument');
      }
      agentId = first;
      const expiresAt =
        maybeInput.expiresAt instanceof Date
          ? maybeInput.expiresAt.toISOString()
          : maybeInput.expiresAt;
      body = { label: maybeInput.label, scopes: maybeInput.scopes, expiresAt };
    }
    return await this.http.request<PolicyRecord>(
      `/agents/${encodeURIComponent(agentId)}/policies`,
      { method: 'POST', body },
    );
  }

  /**
   * List policies for an agent. `opts.agentId` is the per-agent filter
   * the API requires (`GET /agents/:agentId/policies`); `opts.status`
   * is forwarded as a query parameter so the SDK type matches CLI
   * intent even if the API ignores the filter today (forward-compat).
   *
   * Returns the wrapped `{ policies }` shape (rather than a bare array)
   * to match CLI access patterns and leave room for cursor pagination
   * fields without a breaking change.
   *
   * `agentId` is typed optional for caller ergonomics (MCP / CLI surfaces
   * receive it from runtime args); missing `agentId` throws per CLAUDE.md
   * §4 (no silent failures). OD-024 (Option A).
   *
   * TODO(OD-024 Phase A3): the API's `GET /agents/:agentId/policies`
   * handler ignores the `status` query param today; the SDK forwards
   * it forward-compat. Wire the controller to filter by
   * `status ∈ {ACTIVE, REVOKED, EXPIRED}` before claiming this in
   * public docs.
   */
  async list(opts: {
    agentId?: string;
    status?: PolicyStatus;
    limit?: number;
    cursor?: string;
  }): Promise<PolicyListResponse> {
    if (!opts.agentId) {
      throw new Error(
        'PolicyClient.list: opts.agentId is required (list scope is per-agent in the API)',
      );
    }
    const query: Record<string, string | number> = {};
    if (opts.status) query.status = opts.status;
    if (opts.limit !== undefined) query.limit = opts.limit;
    if (opts.cursor) query.cursor = opts.cursor;
    const arr = await this.http.request<PolicyListItem[]>(
      `/agents/${encodeURIComponent(opts.agentId)}/policies`,
      { method: 'GET', query: Object.keys(query).length > 0 ? query : undefined },
    );
    return { policies: arr };
  }

  /**
   * Lookup a single policy by id. The API doesn't expose a
   * `GET /policies/:policyId` endpoint — callers must already know the
   * owning agent. This method exists for MCP-tool surface symmetry
   * (`cerniq.policies.get`) and throws `NotImplemented` until a global
   * lookup endpoint lands. OD-024 (Option A).
   */
  get(_policyId: string, _opts?: { agentId?: string }): Promise<PolicyListItem> {
    throw new Error(
      'PolicyClient.get: not yet wired — API does not expose a policy-id-only lookup; use list({agentId}) and filter',
    );
  }

  /**
   * Revoke a policy. `opts.agentId` is required (the API endpoint is
   * `DELETE /agents/:agentId/policies/:policyId`); `opts.reason`, when
   * provided, is forwarded as the request body for audit-chain capture.
   * Made optional in the type signature for CLI ergonomics; missing
   * `agentId` throws at runtime per `no silent failures` (CLAUDE.md §4).
   * OD-024 (Option A).
   *
   * TODO(OD-024 Phase A2): the API's `DELETE /agents/:agentId/policies/
   * :policyId` handler has no `@Body()` parameter today — `reason` is
   * sent on the wire but silently dropped server-side. Wire the
   * controller to persist `reason` into the audit chain.
   */
  async revoke(policyId: string, opts?: { agentId?: string; reason?: string }): Promise<void> {
    if (!opts?.agentId) {
      throw new Error(
        'PolicyClient.revoke: opts.agentId is required (API needs both agent and policy ids)',
      );
    }
    await this.http.request<undefined>(
      `/agents/${encodeURIComponent(opts.agentId)}/policies/${encodeURIComponent(policyId)}`,
      {
        method: 'DELETE',
        ...(opts.reason !== undefined ? { body: { reason: opts.reason } } : {}),
      },
    );
  }
}
