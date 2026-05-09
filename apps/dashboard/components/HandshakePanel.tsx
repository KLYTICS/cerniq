// Handshake panel for the agent detail page. Server-rendered, read-only,
// instructional. The dashboard intentionally cannot trigger the handshake
// itself — CLAUDE.md invariant 1 forbids private keys from entering AEGIS,
// and the dashboard is part of AEGIS. The operator runs the handshake from
// the SDK / CLI and the panel reflects state via Redis-backed status.

import { CopyButton } from './CopyButton';
import { StatusDot } from './StatusDot';
import { relativeTime } from '../lib/format';
import type { HandshakeStatus } from '../lib/api-client';

interface Props {
  agentId: string;
  status: HandshakeStatus | null;
  apiBaseUrl: string;
}

export function HandshakePanel({ agentId, status, apiBaseUrl }: Props) {
  const verified = status?.verified === true;
  const verifiedAt = status?.verifiedAt;

  return (
    <section className="aegis-panel handshake-panel" aria-labelledby={`handshake-${agentId}`}>
      <header className="handshake-panel-head">
        <h2 id={`handshake-${agentId}`} className="aegis-panel-title">
          Key verification
        </h2>
        <StatusDot
          status={verified ? 'ACTIVE' : 'PENDING_VERIFICATION'}
          pulse={!verified}
          label={
            verified ? (
              <span className="badge badge-ok">verified</span>
            ) : (
              <span className="badge badge-warn">unverified</span>
            )
          }
        />
      </header>

      {verified ? (
        <p className="muted">
          Proof-of-possession recorded {relativeTime(verifiedAt)} via protocol{' '}
          <code>{status?.protocolVersion}</code>. Trust score is at the post-handshake floor (≥600);
          re-running the handshake mints a fresh nonce but won't lower the score.
        </p>
      ) : (
        <p className="muted">
          AEGIS holds only this agent's <em>public</em> key. To prove the matching private key is
          actually held by you, run a handshake from a machine that has it. Three equivalent paths
          below.
        </p>
      )}

      <div className="handshake-paths">
        <HandshakePath
          label="SDK · TypeScript"
          snippet={[
            `import { Aegis, generateKeypair } from '@aegis/sdk';`,
            ``,
            `const aegis = new Aegis({ apiKey: process.env.AEGIS_API_KEY });`,
            `// privateKeyB64u was generated client-side at register time.`,
            `const result = await aegis.handshake('${agentId}', privateKeyB64u);`,
            `console.log(result.verifiedAt, result.trustScore); // ≥600`,
          ].join('\n')}
        />
        <HandshakePath
          label="curl · two-step"
          snippet={[
            `# 1) issue challenge`,
            `curl -X POST ${apiBaseUrl}/v1/agents/${agentId}/challenge \\`,
            `  -H "X-AEGIS-API-Key: $AEGIS_API_KEY" | tee /tmp/challenge.json`,
            ``,
            `# 2) sign the .message field with your Ed25519 private key (your tooling)`,
            `SIG=$(...your-signer... < /tmp/challenge.json)`,
            ``,
            `# 3) verify`,
            `curl -X POST ${apiBaseUrl}/v1/agents/${agentId}/verify-handshake \\`,
            `  -H "X-AEGIS-API-Key: $AEGIS_API_KEY" \\`,
            `  -H 'content-type: application/json' \\`,
            `  -d "{\\"signature\\":\\"$SIG\\"}"`,
          ].join('\n')}
        />
        <HandshakePath
          label="aegis CLI"
          snippet={[
            `# requires aegis CLI logged in`,
            `aegis agents handshake ${agentId} \\`,
            `  --private-key ~/.config/aegis/keys/${agentId}.key`,
          ].join('\n')}
        />
      </div>

      <p className="muted handshake-note">
        Why this matters — registration alone proves nothing about who holds the private key. The
        handshake is the cryptographic act that binds this agent ID to a key the operator
        demonstrably possesses. Domain-separated under <code>aegis-handshake-v1::</code>; the
        signature isn't replayable against any other AEGIS sub-protocol.
      </p>
    </section>
  );
}

function HandshakePath({ label, snippet }: { label: string; snippet: string }) {
  return (
    <div className="handshake-path">
      <div className="handshake-path-head">
        <span className="handshake-path-label">{label}</span>
        <CopyButton value={snippet} label={`${label} snippet`} />
      </div>
      <pre className="codeblock handshake-snippet">{snippet}</pre>
    </div>
  );
}
