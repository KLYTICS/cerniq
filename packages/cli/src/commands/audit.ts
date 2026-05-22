import {
  loadJwksFromUrl,
  parseAuditNdjson,
  verifyChain,
  type ChainReport,
} from '@aegis/audit-verifier';

import { client } from '../client.js';
import { resolveCredentials } from '../credentials.js';
import { emitJson, emitTable, info, ok, err } from '../output.js';

interface AuditEvent {
  id: string;
  timestamp: string;
  agentId: string | null;
  action: string;
  decision: string;
  denialReason: string | null;
  signingKeyId?: string;
  aegisSignature?: string;
}

export async function auditSearch(opts: {
  agentId?: string;
  from?: string;
  to?: string;
  decision?: string;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const aegis = await client();
  const params = new URLSearchParams();
  if (opts.agentId) params.set('agent_id', opts.agentId);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.decision) params.set('decision', opts.decision);
  if (opts.limit) params.set('limit', String(opts.limit));
  // @ts-expect-error - http accessor on Aegis client
  const result = (await aegis.http.get(`/v1/audit-events?${params.toString()}`)) as { events: AuditEvent[] };
  if (opts.json) emitJson(result);
  else
    emitTable(
      result.events.map((e) => ({
        id: e.id.slice(0, 12) + '…',
        timestamp: e.timestamp,
        agent: (e.agentId ?? '-').slice(0, 16),
        action: e.action,
        decision: e.decision,
        denial: e.denialReason ?? '',
      })),
    );
}

/**
 * Independently verify the AEGIS audit chain against the published JWKS.
 *
 * Closes the M-016 surface in the operator CLI. Pulls the verification-
 * shaped NDJSON from `/v1/audit-events/export`, parses each row as a
 * canonical AuditEventRow, fetches the JWKS, and hands both to
 * `@aegis/audit-verifier`'s `verifyChain`. The verifier walks every row
 * — recomputes prev_hash, canonicalizes the payload, checks the Ed25519
 * signature — and surfaces any breaks.
 *
 * This is the same primitive that `aegis-audit-verify` (the standalone
 * binary in `@aegis/audit-verifier`) ships. Using it here keeps the
 * chain-verification algorithm single-sourced; the CLI is just a
 * convenience wrapper around the same library a third-party auditor
 * would install. See ADR-0011 §6 for the third-party verifier design
 * and `docs/SECURITY.md` § "Audit chain integrity" for the operational
 * story.
 *
 * Flags:
 *   --from <iso>           Lower bound on event timestamp (inclusive).
 *   --to <iso>             Upper bound on event timestamp (exclusive).
 *   --no-fail-fast         Walk every row even after a break.
 *   --max-row-detail <n>   Cap per-row detail in JSON output (default 100).
 *   --json                 Emit the full ChainReport as JSON to stdout.
 */
export async function auditVerify(opts: {
  from?: string;
  to?: string;
  failFast?: boolean;
  maxRowDetail?: number;
  json?: boolean;
}): Promise<void> {
  const creds = await resolveCredentials();
  if (!creds) {
    err('not logged in: run `aegis bootstrap` or set AEGIS_API_KEY env');
    process.exit(2);
  }

  const baseUrl = creds.baseUrl.replace(/\/+$/, '');

  // The audit-signing JWKS is a public discovery endpoint — no auth required.
  // `@aegis/audit-verifier`'s loadJwksFromUrl validates the shape (kty=OKP,
  // crv=Ed25519, base64url x) before returning.
  const jwksUrl = `${baseUrl}/v1/.well-known/audit-signing-key`;
  const jwks = await loadJwksFromUrl(jwksUrl);
  info(`fetched ${jwks.keys.length} audit signing key(s) from ${jwksUrl}`);

  // The export endpoint streams NDJSON in chronological order so a chain
  // verifier can walk forward with `event[i-1].id + signature` as the
  // prev_hash inputs for event[i]. It's verification-shaped: every field
  // the canonical payload requires is present, unlike the display-shaped
  // /v1/audit-events DTO.
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  const exportUrl = `${baseUrl}/v1/audit-events/export${params.toString() ? `?${params.toString()}` : ''}`;

  const res = await fetch(exportUrl, {
    headers: {
      'X-AEGIS-API-Key': creds.apiKey,
      Accept: 'application/x-ndjson',
    },
  });
  if (!res.ok) {
    err(`fetch ${exportUrl} → HTTP ${res.status} ${res.statusText}`);
    process.exit(2);
  }
  const ndjson = await res.text();
  const rows = parseAuditNdjson(ndjson);
  info(`streamed ${rows.length} audit event row(s) from ${exportUrl}`);

  // Defaults mirror the audit-verifier binary's defaults: fail-fast on so
  // breaks surface at the first violation; max-row-detail at 100 to bound
  // JSON output size. Callers (operator running `aegis audit verify
  // --no-fail-fast --max-row-detail 1000`) can override.
  const report: ChainReport = await verifyChain(rows, {
    jwks,
    failFast: opts.failFast ?? true,
    maxRowDetail: opts.maxRowDetail ?? 100,
  });

  if (opts.json) {
    emitJson(report);
    if (!report.valid) process.exit(1);
    return;
  }

  const tag = report.valid ? '✓ INTACT' : '✗ BROKEN';
  ok(`AEGIS audit chain — ${tag}`);
  info(`rows verified : ${report.totalRows}`);
  info(`signing keys  : ${report.signingKeys.join(', ') || '(none)'}`);
  info(`rotations     : ${report.rotationEvents.length}`);
  for (const r of report.rotationEvents) {
    info(`  • atIndex=${r.atIndex}  ${r.fromKid} → ${r.toKid}`);
  }
  info(`duration      : ${report.durationMs}ms`);
  if (report.firstBreak) {
    err(`first break   : row ${report.firstBreak.index} (${report.firstBreak.eventId})`);
    err(`  kid         : ${report.firstBreak.signingKeyId}`);
    err(`  signature   : ${report.firstBreak.signatureValid ? 'ok' : 'INVALID'}`);
    err(`  chain link  : ${report.firstBreak.chainLinkValid ? 'ok' : 'INVALID'}`);
    err(`  reason      : ${report.firstBreak.reason ?? '(none)'}`);
    process.exit(1);
  }
}
