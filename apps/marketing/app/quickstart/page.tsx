// /quickstart — 10-minute interactive onboarding guide. Each step has a
// copyable code block and a "what just happened" explainer. Closes the
// broken /quickstart link on the home page and the Docs nav.
//
// The "try it now" section uses the live RAR evaluator endpoint (peer
// bf9d6030 promoted RFC-9396 to standards_implemented this session) so
// a prospect can hit production AEGIS from the page itself.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quickstart — AEGIS',
  description:
    'Ten minutes from zero to a working AEGIS verify call. Install SDK, generate keypair, sign an action, verify, and confirm the audit chain.',
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.aegis.dev';
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/klytics/aegis';

interface Step {
  n: string;
  title: string;
  description: string;
  language: 'sh' | 'ts' | 'py' | 'go' | 'json';
  code: string;
  detail?: string;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Install the SDK',
    description: 'Choose your runtime — TypeScript, Python, or Go. The SDK has zero runtime dependencies beyond a crypto provider.',
    language: 'sh',
    code: `# TypeScript / Node.js / Bun / Edge runtime
npm install @aegis/sdk

# Python (3.9+)
pip install aegis

# Go (1.21+)
go get github.com/klytics/aegis/sdk-go`,
    detail: 'All three SDKs implement the same contract. NUL-byte cache-key rejection is paired across TS + Py (security parity, not just feature parity).',
  },
  {
    n: '02',
    title: 'Generate an agent keypair (locally)',
    description: 'Private keys never leave your environment. AEGIS stores only the public half. This invariant is non-negotiable — CLAUDE.md §invariant-1.',
    language: 'ts',
    code: `import { generateKeypair } from '@aegis/sdk';

const { privateKey, publicKey } = await generateKeypair();

// Store privateKey in your secret manager — AWS Secrets Manager,
// HashiCorp Vault, GCP Secret Manager, or your environment.
// Register publicKey with AEGIS via the dashboard or API.`,
    detail: 'Ed25519 (RFC 8032). One curve, one library — see /security for the full standards posture.',
  },
  {
    n: '03',
    title: 'Sign an action and verify it',
    description: 'The agent signs the action it wants to take. AEGIS verifies the signature, applies your policy, returns a trust score, and writes a signed audit row.',
    language: 'ts',
    code: `import { Aegis, signAgentToken } from '@aegis/sdk';

const aegis = new Aegis({ apiKey: process.env.AEGIS_KEY });

// 0. One-time setup per agent — returns the agent.agentId + policy.policyId
//    you'll cache for that agent's lifetime:
//      const agent  = await aegis.agents.register({
//        publicKey, runtime: 'CUSTOM', label: 'My Agent',
//      });
//      const policy = await aegis.policies.create(agent.agentId, {
//        scopes: [{ category: 'commerce',
//                   spendLimit: { currency: 'USD', maxPerTransaction: 100 } }],
//        expiresAt: new Date(Date.now() + 86_400_000),
//      });

// 1. Agent signs the intent (private key never leaves the agent's runtime).
//    Replace the agent_/policy_ placeholders with the IDs from step 0.
const token = await signAgentToken(privateKey, 'agt_b7c2f', 'pol_4d9a1', {
  action: 'orders.create',
  amount: 99.00,
  ttlSeconds: 60,
});

// 2. Relying party (your service) calls AEGIS to verify
const result = await aegis.verify(token, {
  action: 'orders.create',
  amount: 99.00,
});

if (!result.valid) {
  throw new Error(\`AEGIS denied: \${result.denialReason}\`);
}

console.log(\`Trust score: \${result.trustScore} (band: \${result.trustBand})\`);`,
    detail: 'The Aha moment: in production, <80ms p99 globally on Cloudflare Workers (Phase 3); <200ms p99 on Phase 1 origin-only.',
  },
  {
    n: '04',
    title: 'Try it live — RFC 9396 RAR evaluator',
    description: 'AEGIS implements OAuth 2.0 Rich Authorization Requests. Express agent permissions as authorization_details — per-order caps, per-day caps, trading-hours constraints. Try it against production right now:',
    language: 'sh',
    code: `curl -X POST ${API_BASE}/v1/verify/rar/evaluate \\
  -H 'Content-Type: application/json' \\
  -d '{
    "authorization_details": [{
      "type": "trading_order",
      "actions": ["buy"],
      "limits": { "per_order_usd": 50000 }
    }],
    "candidate": {
      "type": "trading_order",
      "action": "buy",
      "amount_usd": 49750
    }
  }'

# Returns:
# {
#   "ok": true,
#   "matched_detail_type": "trading_order",
#   "evaluated_at": "2026-05-15T...",
#   "binding_version": "aegis-rar-1.0"
# }`,
    detail: 'Stateless evaluator. 4 detail types registered: trading_order, payment_initiation, data_access, agent_action. Live endpoint, no authentication required for evaluator-only calls.',
  },
  {
    n: '05',
    title: 'Wire to your agent framework',
    description: 'Drop AEGIS into the framework you use. The pattern is the same: wrap the tool call, verify before execute, deny with a typed reason.',
    language: 'ts',
    code: `// OpenAI Responses API
import { withAegisVerification } from '@aegis/openai';
const openai = withAegisVerification(new OpenAI(), { aegis, actionPrefix: 'openai.' });

// Anthropic Claude Agent SDK
import { aegisToolMiddleware } from '@aegis/anthropic';
for await (const msg of query({ prompt, options: { middleware: [aegisToolMiddleware({ aegis })] } })) {}

// Vercel AI SDK
import { aegisTool } from '@aegis/vercel-ai-sdk';
const verifiedTool = aegisTool({ aegis, actionPrefix: 'vercel.' })(myTool);

// LangChain (JS or Python)
import { AegisTool } from '@aegis/langchain';
const verifiedSearch = new AegisTool({ aegis, tool: searchTool, actionPrefix: 'langchain.' });`,
    detail: 'See /integrations for the full ecosystem — 80+ surfaces across LLM providers, agent frameworks, workflow tools, and clouds.',
  },
  {
    n: '06',
    title: 'Verify the audit chain offline',
    description: 'The audit log is hash-chained and Ed25519-signed per row. A relying party can verify the chain offline, against the public JWKS — no AEGIS uptime dependency.',
    language: 'sh',
    code: `# Export the chain segment you care about
curl ${API_BASE}/v1/audit/export?agentId=agt_b7c2f > export.ndjson

# Verify offline with the standalone CLI
npx @aegis/audit-verifier verify ./export.ndjson \\
  --jwks ${API_BASE}/.well-known/audit-signing-key

# Or verify a compressed manifest corpus (ADR-0015 Phase 0)
npx @aegis/audit-verifier verify-manifests ./audit-corpus/ \\
  --jwks-file ./aegis-audit-jwks.json --json > report.json`,
    detail: '95 tests guard manifest integrity. Independent verifier ships in the SDK — auditors verify AEGIS without trusting AEGIS at verification time.',
  },
];

const NEXT_STEPS = [
  { title: 'Browse 80+ integrations',   href: '/integrations', description: 'Pre-built middleware for every major LLM, framework, workflow, and cloud.' },
  { title: 'Read the security posture', href: '/security',     description: '5 standards implemented (RFC 8032/7517/9116/9396 + OpenID), 7 aligned + SOC 2 in flight.' },
  { title: 'See real use cases',        href: '/use-cases',    description: '10 verticals shipping today — fintech, banking, treasury, SaaS, AI platforms.' },
  { title: 'View the source',           href: REPO_URL,        description: 'KLYTICS/aegis on GitHub. Open issues, send PRs, claim a peer-claimable integration.' },
];

export default function QuickstartPage() {
  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">10-Minute Quickstart</span>
          <h1>From <code style={{ background: 'var(--bg-elev)', padding: '4px 12px', borderRadius: 4, fontSize: 'inherit' }}>npm install</code> to{' '}
            <span className="accent">verified agent action.</span></h1>
          <p>
            Six steps. Every step has copyable code and a "what just happened" explainer. Step 4 hits
            production AEGIS directly — try the RFC-9396 RAR evaluator without an account.
          </p>
          <div className="hero-proof" style={{ marginTop: 24 }}>
            <span>6 steps · ~10 min</span>
            <span>TS · Py · Go SDKs</span>
            <span>Live API in step 4</span>
            <span>Offline verifier in step 6</span>
          </div>
        </div>
      </section>

      {/* ─── Steps ───────────────────────────────────────────────── */}
      {STEPS.map((s) => (
        <section key={s.n} className="reveal" id={`step-${s.n}`}>
          <div className="container">
            <div className="split">
              <div className="split-copy">
                <div className="step"><span className="step-n">{s.n}</span><span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 16 }}>{s.title}</span></div>
                <p style={{ marginTop: 16, fontSize: 14 }}>{s.description}</p>
                {s.detail && (
                  <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-mute)', borderLeft: '2px solid var(--accent)', paddingLeft: 12 }}>
                    {s.detail}
                  </p>
                )}
              </div>
              <pre className="code-block">
                <code>{s.code}</code>
              </pre>
            </div>
          </div>
        </section>
      ))}

      {/* ─── Next steps ──────────────────────────────────────────── */}
      <section className="reveal" id="next">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Next</span>
            <h2>You&rsquo;ve verified an agent. What else?</h2>
            <p>Wire AEGIS into your framework, prove your security posture, see what other teams are shipping.</p>
          </div>
          <div className="layers">
            {NEXT_STEPS.map((n) => (
              <article key={n.href} className="layer">
                <span className="layer-tag">Up next</span>
                <h3>{n.title}</h3>
                <p style={{ fontSize: 13 }}>{n.description}</p>
                <div style={{ marginTop: 'auto' }}>
                  <a href={n.href} className="mono" style={{ fontSize: 12 }}>
                    {n.href.startsWith('http') ? 'View on GitHub →' : `Go to ${n.href} →`}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ────────────────────────────────────────────────── */}
      <section className="reveal">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Ready for production?</h2>
              <p>Start with the free Developer tier — 50,000 verifies per month, no card required to begin.</p>
            </div>
            <div className="cta-band-actions">
              <a href="/#pricing" className="btn btn-primary">Get your AEGIS key →</a>
              <a href="/integrations" className="btn btn-ghost">Browse integrations</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
