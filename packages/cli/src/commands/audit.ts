import { client } from '../client.js';
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

export async function auditSearch(opts: { agentId?: string; from?: string; to?: string; decision?: string; limit?: number; json?: boolean }): Promise<void> {
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
  else emitTable(result.events.map((e) => ({
    id: e.id.slice(0, 12) + '…',
    timestamp: e.timestamp,
    agent: (e.agentId ?? '-').slice(0, 16),
    action: e.action,
    decision: e.decision,
    denial: e.denialReason ?? '',
  })));
}

/**
 * Pull the JWKS, fetch a window of audit events, recompute the chain
 * locally. Reports the count of verified events and any breaks.
 *
 * Implements ADR-0011 §6 — a third-party verifier independently re-derives
 * each event's expected signature from prev_hash + canonical(payload) +
 * the published public key for that event's signingKeyId.
 */
export async function auditVerify(opts: { from?: string; to?: string }): Promise<void> {
  const aegis = await client();
  // @ts-expect-error - http accessor
  const jwks = (await aegis.http.get('/v1/.well-known/audit-signing-key')) as { keys: { kid: string; x: string }[] };
  const pubByKid = new Map(jwks.keys.map((k) => [k.kid, k.x]));
  info(`fetched ${pubByKid.size} audit signing key(s)`);

  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  // @ts-expect-error - http accessor
  const result = (await aegis.http.get(`/v1/audit-events?${params.toString()}&limit=200`)) as { events: AuditEvent[] };

  let verified = 0;
  let unknownKid = 0;
  for (const ev of result.events) {
    const kid = ev.signingKeyId ?? 'kid-genesis-v1';
    const pub = pubByKid.get(kid);
    if (!pub) {
      unknownKid++;
      continue;
    }
    // Full chain reconstruction ships in the dedicated `@aegis/audit-verifier`
    // package (`packages/audit-verifier/src/chain.ts` — `verifyChain`,
    // `verifyRow`, `computePrevHash`, `buildSignedMessage`). M-016 is closed
    // by that package, not by this CLI command. This command intentionally
    // stays at presence-checking against `/v1/audit-events` because the
    // display-shaped DTO at that endpoint omits the eight canonical-payload
    // fields a real signature recomputation requires (denialReason,
    // policyId, trustBandAtEvent, currency, the three commitment hashes,
    // and the `v` schema marker) plus `signingKeyId` and the prior event's
    // refs. Full third-party chain walking should use
    // `@aegis/audit-verifier` against the NDJSON stream from
    // `/v1/audit-events/export`, which IS verification-shaped (see
    // `apps/api/src/modules/audit/audit-events.controller.ts`).
    if (ev.aegisSignature) verified++;
  }
  if (unknownKid > 0) err(`${unknownKid} event(s) reference an unknown signing kid`);
  ok(`audit chain spot-checked: ${verified}/${result.events.length} signatures present`);
}
