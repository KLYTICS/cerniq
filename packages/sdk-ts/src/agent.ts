import type { HttpClient } from './http.js';
import { resolveIdempotencyKey, type IdempotencyOptions } from './idempotency.js';
import { paginate, type PaginationOptions } from './pagination.js';
import type { AgentRecord, AgentStatus, RegisterAgentInput, TrustBand } from './types.js';

export interface HandshakeChallenge {
  agentId: string;
  /** base64url-encoded 256-bit nonce. Single-use, 5 min TTL. */
  challenge: string;
  expiresIn: number;
  protocolVersion: 'aegis-handshake-v1';
  /** UTF-8 string the SDK signs verbatim. */
  message: string;
}

export interface HandshakeVerified {
  agentId: string;
  verifiedAt: string;
  protocolVersion: 'aegis-handshake-v1';
  trustScore: number;
  recordTtlSeconds: number;
}

export interface HandshakeStatus {
  agentId: string;
  verified: boolean;
  verifiedAt?: string;
  protocolVersion?: 'aegis-handshake-v1';
}

export class AgentClient {
  constructor(private readonly http: HttpClient) {}

  register(input: RegisterAgentInput, idem?: IdempotencyOptions): Promise<AgentRecord> {
    return this.http.request<AgentRecord>('/agents/register', {
      method: 'POST',
      body: input,
      idempotencyKey: resolveIdempotencyKey('agents.register', idem),
    });
  }

  list(query?: { limit?: number; cursor?: string }): Promise<{ agents: AgentRecord[]; nextCursor: string | null }> {
    return this.http.request('/agents', { method: 'GET', query });
  }

  /**
   * Async-iterable wrapper around `list()`. Composes `paginate()` so
   * callers can iterate the full agent stream without managing cursors
   * by hand:
   *
   *   for await (const agent of aegis.agents.listAll({ status: 'ACTIVE' })) {
   *     console.log(agent.id);
   *   }
   *
   * Composes with M-ABORT-1 via `options.signal` — abort terminates
   * the iteration between pages with the signal's reason. Safety cap
   * (`PaginationOptions.maxPages`) defaults to `DEFAULT_MAX_PAGES`.
   */
  listAll(
    query?: { limit?: number; status?: AgentStatus },
    options?: PaginationOptions,
  ): AsyncIterableIterator<AgentRecord> {
    type Page = { agents: AgentRecord[]; nextCursor: string | null };
    type Query = { limit?: number; status?: AgentStatus; cursor?: string };
    return paginate<AgentRecord, Page, Query>(
      (q) => this.list(q),
      (page) => page.agents,
      (page) => page.nextCursor,
      (query ?? {}) as Query,
      options,
    );
  }

  get(agentId: string): Promise<AgentRecord> {
    return this.http.request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'GET',
    });
  }

  async revoke(agentId: string, idem?: IdempotencyOptions): Promise<void> {
    await this.http.request<undefined>(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
      idempotencyKey: resolveIdempotencyKey('agents.revoke', idem),
    });
  }

  status(
    agentId: string,
  ): Promise<{ agentId: string; status: AgentStatus; trustScore: number; trustBand: TrustBand }> {
    return this.http.request(`/agents/${encodeURIComponent(agentId)}/status`, {
      method: 'GET',
      verifyOnly: true,
    });
  }

  audit(
    agentId: string,
    query?: { from?: string; to?: string; limit?: number; cursor?: string },
  ): Promise<{ events: unknown[]; nextCursor: string | null; count: number }> {
    return this.http.request(`/agents/${encodeURIComponent(agentId)}/audit`, {
      method: 'GET',
      query,
    });
  }

  /**
   * Async-iterable wrapper around `audit()`. Iterates the agent's
   * full audit event stream across all pages — useful for SOC2
   * evidence export, time-bounded compliance queries, and incident
   * forensics. The compliance-export pattern:
   *
   *   for await (const event of aegis.agents.auditAll(agentId, {
   *     from: '2026-01-01T00:00:00Z',
   *     to: '2026-04-01T00:00:00Z',
   *   })) {
   *     ndjsonStream.write(JSON.stringify(event) + '\n');
   *   }
   *
   * Safety cap matters here more than for `listAll` — audit streams
   * can be large. Set `options.maxPages: Infinity` only when you
   * have an external bound (date range, agent id) that guarantees
   * the stream terminates.
   */
  auditAll(
    agentId: string,
    query?: { from?: string; to?: string; limit?: number },
    options?: PaginationOptions,
  ): AsyncIterableIterator<unknown> {
    type Page = { events: unknown[]; nextCursor: string | null; count: number };
    type Query = { from?: string; to?: string; limit?: number; cursor?: string };
    return paginate<unknown, Page, Query>(
      (q) => this.audit(agentId, q),
      (page) => page.events,
      (page) => page.nextCursor,
      (query ?? {}) as Query,
      options,
    );
  }

  /**
   * Issue a single-use handshake challenge for the agent. Pair with
   * `signHandshake(privateKey, response.message)` and `verifyHandshake()`.
   */
  challenge(agentId: string, idem?: IdempotencyOptions): Promise<HandshakeChallenge> {
    // Per the policy table: `agents.challenge` is operator-configured.
    // The default expectation is 'forbidden' since each call must mint
    // a fresh nonce; resolveIdempotencyKey returns undefined in that
    // case regardless of `idem`, so the SDK won't leak a replay key
    // onto an idempotent-by-design endpoint.
    return this.http.request<HandshakeChallenge>(
      `/agents/${encodeURIComponent(agentId)}/challenge`,
      {
        method: 'POST',
        idempotencyKey: resolveIdempotencyKey('agents.challenge', idem),
      },
    );
  }

  /**
   * Submit a signed handshake response. On success the agent's trust score
   * is lifted to ≥600 and a 30-day proof-of-possession record is cached
   * server-side.
   */
  verifyHandshake(
    agentId: string,
    signature: string,
    idem?: IdempotencyOptions,
  ): Promise<HandshakeVerified> {
    return this.http.request<HandshakeVerified>(
      `/agents/${encodeURIComponent(agentId)}/verify-handshake`,
      {
        method: 'POST',
        body: { signature },
        idempotencyKey: resolveIdempotencyKey('agents.verifyHandshake', idem),
      },
    );
  }

  /**
   * Read the cached handshake-completed record. Returns `verified: false`
   * when the agent has never proven possession (or the record has expired).
   */
  handshakeStatus(agentId: string): Promise<HandshakeStatus> {
    return this.http.request<HandshakeStatus>(
      `/agents/${encodeURIComponent(agentId)}/handshake-status`,
      { method: 'GET' },
    );
  }

  report(
    agentId: string,
    body: {
      eventType:
        | 'fraud_confirmed'
        | 'anomaly'
        | 'policy_violation'
        | 'suspicious_behavior'
        | 'false_positive';
      severity?: 'low' | 'medium' | 'high' | 'critical';
      description?: string;
      transactionId?: string;
      evidence?: Record<string, unknown>;
    },
    idem?: IdempotencyOptions,
  ): Promise<{ accepted: true }> {
    return this.http.request(`/agents/${encodeURIComponent(agentId)}/report`, {
      method: 'POST',
      body,
      idempotencyKey: resolveIdempotencyKey('agents.report', idem),
    });
  }
}
