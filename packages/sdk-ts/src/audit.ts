import type { HttpClient } from './http.js';
import type { AuditLogPage, AuditSearchOptions } from './types.js';

/**
 * Audit log surface. Two read modes:
 *
 *   - `search(opts)` — tenant-wide search across every agent owned by the
 *     calling principal. Backs the auditor / compliance pull and the
 *     dashboard "all events" view.
 *   - `forAgent(agentId, opts)` — per-agent slice. Used by the agent
 *     detail page and by relying parties pulling their own activity.
 *
 * Both return `AuditLogPage` with `events`, `nextCursor`, and `count`.
 * Each event carries an `actionHash` and an AEGIS chain `signature`
 * verifiable offline against `/.well-known/audit-signing-key` (ADR-0011).
 */
export class AuditClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * Tenant-wide audit search across all agents owned by the calling
   * principal. CLAUDE.md invariant #5 — the server enforces principal
   * scoping; this method cannot leak cross-tenant rows.
   */
  search(opts: AuditSearchOptions = {}): Promise<AuditLogPage> {
    return this.http.request<AuditLogPage>('/audit-events', {
      method: 'GET',
      query: {
        from: opts.from,
        to: opts.to,
        limit: opts.limit,
        cursor: opts.cursor,
      },
    });
  }

  /**
   * Per-agent audit slice. Sister to `search()`; same shape, scoped to one
   * agent by URL path so cursor pagination doesn't need a re-filter.
   */
  forAgent(agentId: string, opts: AuditSearchOptions = {}): Promise<AuditLogPage> {
    return this.http.request<AuditLogPage>(
      `/agents/${encodeURIComponent(agentId)}/audit`,
      {
        method: 'GET',
        query: {
          from: opts.from,
          to: opts.to,
          limit: opts.limit,
          cursor: opts.cursor,
        },
      },
    );
  }
}
