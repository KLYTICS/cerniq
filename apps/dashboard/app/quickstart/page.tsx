// First-run workflow page. Guides a fresh principal through the canonical
// CERNIQ flow: keypair → register → handshake → policy → first verify →
// observe in audit. Every snippet is a CopyButton; the operator should
// reach a working `cerniq.verify(...)` call from a cold install in under
// 90 seconds.

import type { Metadata } from 'next';

import { CopyButton } from '../../components/CopyButton';

export const metadata: Metadata = {
  title: 'Quickstart · CERNIQ',
};

export default function QuickstartPage() {
  const apiBaseUrl = process.env.CERNIQ_API_BASE_URL ?? 'http://localhost:4000';

  return (
    <section className="cerniq-page">
      <header className="cerniq-page-header">
        <h1>Quickstart</h1>
        <p className="muted">
          Cold install → first cryptographically-verified <code>cerniq.verify()</code> in under 90
          seconds. Six steps, every code block one click to copy.
        </p>
      </header>

      <Step
        n={1}
        title="Install the SDK"
        body="The TS SDK ships as @cerniq/sdk. Browser-safe (no node:crypto), works in Edge runtimes."
        snippet={`pnpm add @cerniq/sdk`}
      />

      <Step
        n={2}
        title="Generate a keypair locally"
        body="Private key never leaves your machine. CERNIQ only ever sees the public half."
        snippet={[
          `import { generateKeypair } from '@cerniq/sdk';`,
          ``,
          `const { privateKey, publicKey } = await generateKeypair();`,
          `// Persist privateKey in OS keyring / KMS / Vault — your call.`,
        ].join('\n')}
      />

      <Step
        n={3}
        title="Register the agent"
        body="Bind the public key to your principal. The returned agentId is the CERNIQ identifier you'll sign verify-tokens against."
        snippet={[
          `import { Cerniq } from '@cerniq/sdk';`,
          ``,
          `const cerniq = new Cerniq({`,
          `  apiKey: process.env.CERNIQ_API_KEY,`,
          `  baseUrl: '${apiBaseUrl}',`,
          `});`,
          ``,
          `const agent = await cerniq.agents.register({`,
          `  publicKey,`,
          `  runtime: 'ANTHROPIC',`,
          `  label: 'shopper for alice@example.com',`,
          `});`,
          `console.log(agent.agentId);  // agt_xxxxxxx`,
        ].join('\n')}
      />

      <Step
        n={4}
        title="Run the handshake"
        body="Prove possession of the private key. Lifts the agent's trust score to ≥600 (the cold-start acceptance threshold) and writes a 30-day proof-of-possession record. One call; the SDK does challenge → sign → verify under the hood."
        snippet={[
          `const result = await cerniq.handshake(agent.agentId, privateKey);`,
          `console.log(result.verifiedAt, result.trustScore);`,
          `// 2026-05-04T19:21:55Z 600`,
        ].join('\n')}
      />

      <Step
        n={5}
        title="Issue a scoped policy"
        body="Time-bounded, action-scoped permission. The signed token is what you'll sign verify-requests against."
        snippet={[
          `const policy = await cerniq.policies.create(agent.agentId, {`,
          `  scopes: [{`,
          `    action: 'commerce.purchase',`,
          `    spendLimit: { amount: 200, currency: 'USD', period: 'PER_TRANSACTION' },`,
          `    merchantDomains: ['delta.com'],`,
          `  }],`,
          `  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),`,
          `  label: 'demo-policy-1',`,
          `});`,
          `console.log(policy.policyId);  // pol_xxxxxxx`,
        ].join('\n')}
      />

      <Step
        n={6}
        title="Sign a verify-token and call /v1/verify"
        body="The verify hot path is the relying-party gate. Returns approve / deny / flag with denial reason in the canonical precedence order."
        snippet={[
          `const token = await cerniq.sign(privateKey, agent.agentId, policy.policyId, {`,
          `  action: 'commerce.purchase',`,
          `  amount: 199,`,
          `  currency: 'USD',`,
          `  merchantDomain: 'delta.com',`,
          `});`,
          ``,
          `const decision = await cerniq.verify(token, {`,
          `  action: 'commerce.purchase',`,
          `  amount: 199,`,
          `  currency: 'USD',`,
          `  merchantDomain: 'delta.com',`,
          `});`,
          `console.log(decision.outcome, decision.deniedReason);`,
          `// 'approved' undefined`,
        ].join('\n')}
      />

      <h2>Next steps</h2>
      <ul>
        <li>
          <a href="/agents">Agents</a> — see your fresh registration with the live status dot.
        </li>
        <li>
          <a href="/audit">Audit</a> — every verify decision is hash-chained and
          signature-verifiable via <code>/.well-known/audit-signing-key</code>.
        </li>
        <li>
          <a href="/webhooks">Webhooks</a> — subscribe to <code>verify.denied</code>,{' '}
          <code>trust_score_changed</code>, <code>agent.revoked</code>.
        </li>
        <li>
          <a href="/policies">Policies</a> — issue more scoped tokens; revoke propagates to the
          verify hot-path within seconds.
        </li>
      </ul>

      <h2>One-shot bootstrap</h2>
      <p className="muted">
        For demos and CI, the entire flow above collapses into a single script. Drop into a
        TypeScript file, set <code>CERNIQ_API_KEY</code>, and run.
      </p>
      <BootstrapBlock apiBaseUrl={apiBaseUrl} />
    </section>
  );
}

function Step({
  n,
  title,
  body,
  snippet,
}: {
  n: number;
  title: string;
  body: string;
  snippet: string;
}) {
  return (
    <article className="quickstart-step">
      <div className="quickstart-step-num" aria-hidden="true">
        {n}
      </div>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="handshake-path">
          <div className="handshake-path-head">
            <span className="handshake-path-label">code</span>
            <CopyButton value={snippet} label={`step ${n}`} />
          </div>
          <pre className="codeblock handshake-snippet">{snippet}</pre>
        </div>
      </div>
    </article>
  );
}

function BootstrapBlock({ apiBaseUrl }: { apiBaseUrl: string }) {
  const snippet = [
    `// quickstart.ts — full first-run flow. ~30 lines.`,
    `import { Cerniq, generateKeypair } from '@cerniq/sdk';`,
    ``,
    `const cerniq = new Cerniq({`,
    `  apiKey: process.env.CERNIQ_API_KEY!,`,
    `  baseUrl: '${apiBaseUrl}',`,
    `});`,
    ``,
    `const { privateKey, publicKey } = await generateKeypair();`,
    `const agent = await cerniq.agents.register({ publicKey, runtime: 'ANTHROPIC' });`,
    `const verified = await cerniq.handshake(agent.agentId, privateKey);`,
    `console.log('handshake @ ' + verified.verifiedAt + ', trust ' + verified.trustScore);`,
    ``,
    `const policy = await cerniq.policies.create(agent.agentId, {`,
    `  scopes: [{`,
    `    action: 'commerce.purchase',`,
    `    spendLimit: { amount: 200, currency: 'USD', period: 'PER_TRANSACTION' },`,
    `    merchantDomains: ['delta.com'],`,
    `  }],`,
    `  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),`,
    `});`,
    ``,
    `const token = await cerniq.sign(privateKey, agent.agentId, policy.policyId, {`,
    `  action: 'commerce.purchase', amount: 199, currency: 'USD', merchantDomain: 'delta.com',`,
    `});`,
    `const decision = await cerniq.verify(token, {`,
    `  action: 'commerce.purchase', amount: 199, currency: 'USD', merchantDomain: 'delta.com',`,
    `});`,
    `console.log(decision.outcome);  // 'approved'`,
  ].join('\n');
  return (
    <div className="handshake-path">
      <div className="handshake-path-head">
        <span className="handshake-path-label">quickstart.ts · 30 lines</span>
        <CopyButton value={snippet} label="full quickstart" />
      </div>
      <pre className="codeblock handshake-snippet">{snippet}</pre>
    </div>
  );
}
