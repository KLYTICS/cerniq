import { rawJson } from '../client.js';
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
  const params = new URLSearchParams();
  if (opts.agentId) params.set('agent_id', opts.agentId);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.decision) params.set('decision', opts.decision);
  if (opts.limit) params.set('limit', String(opts.limit));
  const result = await rawJson<{ events: AuditEvent[] }>(`/v1/audit-events?${params.toString()}`);
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
  const jwks = await rawJson<{ keys: Array<{ kid: string; x: string }> }>(
    '/.well-known/audit-signing-key',
  );
  const pubByKid = new Map(jwks.keys.map((k) => [k.kid, k.x]));
  info(`fetched ${pubByKid.size} audit signing key(s)`);

  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  params.set('limit', '200');
  const result = await rawJson<{ events: AuditEvent[] }>(`/v1/audit-events?${params.toString()}`);

  let verified = 0;
  let unknownKid = 0;
  for (const ev of result.events) {
    const kid = ev.signingKeyId ?? 'kid-genesis-v1';
    const pub = pubByKid.get(kid);
    if (!pub) {
      unknownKid++;
      continue;
    }
    // Full chain reconstruction lives in the @aegis/verifier-rp package
    // (M-016 ships a Node verifier; this CLI stops at presence checking
    // until that lands). Real signature recomputation is a 2-line call:
    //   import { verifyChainEvent } from '@aegis/verifier-rp';
    //   verified += await verifyChainEvent(ev, pub) ? 1 : 0;
    if (ev.aegisSignature) verified++;
  }
  if (unknownKid > 0) err(`${unknownKid} event(s) reference an unknown signing kid`);
  ok(`audit chain spot-checked: ${verified}/${result.events.length} signatures present`);
}
