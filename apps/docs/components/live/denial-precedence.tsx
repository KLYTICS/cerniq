import { DENIAL_REASON_PRECEDENCE } from '@aegis/types';

type ReasonCopy = { http: number; meaning: string; retryable: boolean };

const REASON_COPY: Record<string, ReasonCopy> = {
  PLAN_LIMIT_EXCEEDED: {
    http: 402,
    meaning: 'Billing pre-gate — principal must upgrade plan.',
    retryable: false,
  },
  AGENT_NOT_FOUND: {
    http: 404,
    meaning: 'Token references an agent the principal has not registered.',
    retryable: false,
  },
  AGENT_REVOKED: {
    http: 403,
    meaning: 'Agent identity revoked. No future verifies will succeed.',
    retryable: false,
  },
  INVALID_SIGNATURE: {
    http: 401,
    meaning: 'JWT signature failed Ed25519 verification.',
    retryable: false,
  },
  POLICY_REVOKED: {
    http: 403,
    meaning: 'Policy revoked by principal. Issue a new one to resume.',
    retryable: false,
  },
  POLICY_EXPIRED: {
    http: 403,
    meaning: 'Policy past its `exp` claim. Issue a fresh policy.',
    retryable: false,
  },
  SCOPE_NOT_GRANTED: {
    http: 403,
    meaning: 'Requested action falls outside the policy scope.',
    retryable: false,
  },
  TRIAL_EXHAUSTED: {
    http: 402,
    meaning: 'Free-trial verify cap reached. Principal must upgrade.',
    retryable: false,
  },
  SPEND_LIMIT_EXCEEDED: {
    http: 429,
    meaning: 'Per-policy spend cap reached for the current window.',
    retryable: true,
  },
  TRUST_SCORE_TOO_LOW: {
    http: 403,
    meaning: 'Agent BATE score below the policy minimum.',
    retryable: true,
  },
  ANOMALY_FLAGGED: {
    http: 403,
    meaning: 'Real-time anomaly detector vetoed the request.',
    retryable: false,
  },
};

export function DenialPrecedence() {
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-[var(--aegis-mist)] bg-[var(--aegis-ink)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--aegis-steel)] text-xs uppercase tracking-wider text-[var(--aegis-fog)]">
          <tr>
            <th className="px-4 py-3 text-left">#</th>
            <th className="px-4 py-3 text-left">Reason</th>
            <th className="px-4 py-3 text-left">HTTP</th>
            <th className="px-4 py-3 text-left">Meaning</th>
            <th className="px-4 py-3 text-left">Retry?</th>
          </tr>
        </thead>
        <tbody>
          {DENIAL_REASON_PRECEDENCE.map((reason, idx) => {
            const meta = REASON_COPY[reason];
            return (
              <tr key={reason} className="border-t border-[var(--aegis-mist)]">
                <td className="px-4 py-3 font-mono text-[var(--aegis-shadow)]">{idx + 1}</td>
                <td className="px-4 py-3 font-mono text-[var(--aegis-cyan)]">{reason}</td>
                <td className="px-4 py-3 font-mono">{meta?.http ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--aegis-fog)]">{meta?.meaning ?? 'See SECURITY.md'}</td>
                <td className="px-4 py-3">
                  {meta?.retryable ? (
                    <span className="text-[var(--aegis-pending)]">backoff</span>
                  ) : (
                    <span className="text-[var(--aegis-denied)]">no</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-[var(--aegis-mist)] bg-[var(--aegis-graphite)] px-4 py-2 text-xs text-[var(--aegis-shadow)]">
        Live source: <code className="font-mono">packages/types/src/constants.ts → DENIAL_REASON_PRECEDENCE</code>
      </div>
    </div>
  );
}
