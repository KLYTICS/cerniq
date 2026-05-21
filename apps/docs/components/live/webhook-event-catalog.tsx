import { WEBHOOK_EVENT } from '@aegis/types';

// Per-event human-readable copy. The catalog itself (the set of event names)
// is the wire constant — the parity test
// (tests/cross-package/docs-webhook-events-parity.spec.ts) fails the build
// if this component drops or shadows the import.

const EVENT_COPY: Record<string, { when: string; payload: string }> = {
  'aegis.agent.trust_score_changed': {
    when: 'BATE recompute crosses a band threshold for an agent.',
    payload:
      '{ agentId, previousScore, newScore, previousBand, newBand, signalsThatTriggered }',
  },
  'aegis.agent.anomaly_detected': {
    when: 'Rule-based anomaly detector (R-1…R-5) classifies an event as suspicious.',
    payload: '{ agentId, rule, severity, evidence }',
  },
  'aegis.agent.policy_expired': {
    when: 'Scheduled sweep marks an agent policy past its `exp` timestamp.',
    payload: '{ agentId, policyId, expiredAt }',
  },
  'aegis.agent.flagged_by_relying_party': {
    when: 'A relying party submits an `agents.report(...)` flag against the agent.',
    payload: '{ agentId, relyingPartyId, reason, contextHash }',
  },
  'aegis.agent.revoked': {
    when: 'Principal calls `DELETE /v1/agents/:id` or revocation triggers automatically.',
    payload: '{ agentId, revokedAt, revokedBy }',
  },
};

const EVENTS = Object.values(WEBHOOK_EVENT);

export function WebhookEventCatalog() {
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-[var(--aegis-mist)] bg-[var(--aegis-ink)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--aegis-steel)] text-xs uppercase tracking-wider text-[var(--aegis-fog)]">
          <tr>
            <th className="px-4 py-3 text-left">Event</th>
            <th className="px-4 py-3 text-left">When AEGIS emits it</th>
            <th className="px-4 py-3 text-left">Payload shape</th>
          </tr>
        </thead>
        <tbody>
          {EVENTS.map((event) => {
            const meta = EVENT_COPY[event];
            return (
              <tr key={event} className="border-t border-[var(--aegis-mist)]">
                <td className="px-4 py-3 font-mono text-[var(--aegis-cyan)]">{event}</td>
                <td className="px-4 py-3 text-[var(--aegis-fog)]">
                  {meta?.when ?? 'See WEBHOOKS.md'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--aegis-fog)]">
                  {meta?.payload ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-[var(--aegis-mist)] bg-[var(--aegis-graphite)] px-4 py-2 text-xs text-[var(--aegis-shadow)]">
        Live source: <code className="font-mono">packages/types/src/constants.ts &rarr; WEBHOOK_EVENT</code>
      </div>
    </div>
  );
}
