// Cross-package parity — quickstart code samples ↔ @aegis/sdk + @aegis/types.
//
// CLOSES THE DRIFT CLASS from commits 82ebe2f / 0b59ead / 3025291:
// the quickstart pages on apps/marketing/ and apps/dashboard/ rendered
// code samples as template-literal strings, and the strings were never
// typechecked against the real SDK. Three rounds of doc-vs-types drift
// shipped to /quickstart without anyone noticing:
//
//   Round 1 (pre-82ebe2f)  generateKeyPair / signAction      — nonexistent exports
//   Round 2 (pre-0b59ead)  Step-0 `agent`/`policy` in comments,
//                          Step-1 referenced them as bindings — ghost variables
//   Round 3 (pre-3025291)  scopes[].action vs PolicyScope.category,
//                          SpendLimit shape, allowedDomains vs merchantDomains,
//                          decision.outcome vs VerifyResult.valid
//
// apps/dashboard/CLAUDE.md explicitly forbids the underlying anti-pattern:
//   "Dashboard assumptions must come from @aegis/types, API discovery
//    endpoints, or colocated typed adapters. Do not hand-copy enums
//    without a parity test."
//
// This is that parity test.
//
// HOW IT WORKS:
//
// Each `_typeCheckedSnippet_*` function below MIRRORS a code block
// rendered by a /quickstart page, expressed as real TypeScript that
// MUST compile against the live SDK types. The functions never run
// (they reference fake bindings, are never called), but they have to
// typecheck. `pnpm --filter @aegis/e2e typecheck` is the gate; any
// drift between a quickstart page's rendered code and the SDK's actual
// surface will surface here as a tsc error.
//
// WHEN YOU EDIT A QUICKSTART CODE BLOCK:
//
// Update the corresponding `_typeCheckedSnippet_*` function below to
// match, or this spec will hold the stale shape and miss the new
// drift. The vitest assertion at the bottom is decorative; the real
// signal is `tsc --noEmit`.
//
// KNOWN GAP:
//
// This spec mirrors snippets manually rather than extracting them from
// the .tsx files programmatically. Drift in the OTHER direction —
// quickstart updated, this spec not — slips through. Closing that gap
// requires either (a) a TS-AST walker that pulls `language: 'ts'` blocks
// from the STEPS array literals, or (b) moving the snippets into a typed
// shared module that both quickstart and tests import. Both are larger
// commits; the manual-mirror version closes the failure mode where
// EITHER side is updated and the GATE catches it. Real coverage is
// drift-on-this-side; partial coverage is drift-on-the-quickstart-side.

import { describe, it, expect } from 'vitest';

import {
  Aegis,
  generateKeypair,
  signAgentToken,
  type AgentRecord,
  type PolicyRecord,
  type VerifyResult,
  type SignContext,
  type CreatePolicyInput,
  type RegisterAgentInput,
  type AgentRuntime,
  type PolicyScope,
  type ScopeCategory,
  type SpendLimit,
} from '@aegis/sdk';

/* ──────────────────────────────────────────────────────────────────
 *  apps/marketing/app/quickstart/page.tsx — Step 02
 * ────────────────────────────────────────────────────────────────── */

async function _typeCheckedSnippet_marketing_step02(): Promise<void> {
  // Snippet (Step 02 — "Generate an agent keypair (locally)"):
  const { privateKey, publicKey } = await generateKeypair();
  void privateKey;
  void publicKey;
}

/* ──────────────────────────────────────────────────────────────────
 *  apps/marketing/app/quickstart/page.tsx — Step 03
 *  Step 0 comment block + Step 1/2/3 executable code in the snippet.
 * ────────────────────────────────────────────────────────────────── */

async function _typeCheckedSnippet_marketing_step03_setup(
  publicKey: string,
): Promise<{ agent: AgentRecord; policy: PolicyRecord }> {
  // "Step 0" comment block from the snippet — typechecks the
  // aspirational setup the comment shows so it can't drift either:
  const aegis = new Aegis({ apiKey: 'sk_placeholder' });

  const registerInput: RegisterAgentInput = {
    publicKey,
    runtime: 'CUSTOM' satisfies AgentRuntime,
    label: 'My Agent',
  };
  const agent = await aegis.agents.register(registerInput);

  const policyInput: CreatePolicyInput = {
    scopes: [
      {
        category: 'commerce' satisfies ScopeCategory,
        spendLimit: {
          currency: 'USD',
          maxPerTransaction: 100,
        } satisfies SpendLimit,
      } satisfies PolicyScope,
    ],
    expiresAt: new Date(Date.now() + 86_400_000),
  };
  const policy = await aegis.policies.create(agent.agentId, policyInput);

  return { agent, policy };
}

async function _typeCheckedSnippet_marketing_step03(privateKey: string): Promise<void> {
  // Snippet (Step 03 — "Sign an action and verify it"):
  const aegis = new Aegis({ apiKey: 'sk_placeholder' });

  // Step 1: agent signs the intent.
  const token = await signAgentToken(privateKey, 'agt_b7c2f', 'pol_4d9a1', {
    action: 'orders.create',
    amount: 99.0,
    ttlSeconds: 60,
  } satisfies SignContext);

  // Step 2: relying party verifies.
  const result: VerifyResult = await aegis.verify(token, {
    action: 'orders.create',
    amount: 99.0,
  });

  if (!result.valid) {
    throw new Error(`AEGIS denied: ${String(result.denialReason)}`);
  }

  // Field reads must match VerifyResult (types.ts:83):
  void result.trustScore;
  void result.trustBand;
}

/* ──────────────────────────────────────────────────────────────────
 *  apps/dashboard/app/quickstart/page.tsx — BootstrapBlock
 *  ~30-line full first-run flow.
 * ────────────────────────────────────────────────────────────────── */

async function _typeCheckedSnippet_dashboard_bootstrap(): Promise<void> {
  const aegis = new Aegis({
    apiKey: 'sk_placeholder',
    baseUrl: 'https://api.aegislabs.io',
  });

  const { privateKey, publicKey } = await generateKeypair();

  const agent = await aegis.agents.register({
    publicKey,
    runtime: 'ANTHROPIC' satisfies AgentRuntime,
  });

  const verified = await aegis.handshake(agent.agentId, privateKey);
  // Snippet logs verified.verifiedAt + verified.trustScore; both must exist
  // on HandshakeVerified (agent.ts:14):
  void verified.verifiedAt;
  void verified.trustScore;

  const policy = await aegis.policies.create(agent.agentId, {
    scopes: [
      {
        category: 'commerce' satisfies ScopeCategory,
        spendLimit: {
          currency: 'USD',
          maxPerTransaction: 200,
        } satisfies SpendLimit,
        allowedDomains: ['delta.com'],
      } satisfies PolicyScope,
    ],
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  } satisfies CreatePolicyInput);

  const token = await aegis.sign(privateKey, agent.agentId, policy.policyId, {
    action: 'commerce.purchase',
    amount: 199,
    currency: 'USD',
    merchantDomain: 'delta.com',
  } satisfies SignContext);

  const decision: VerifyResult = await aegis.verify(token, {
    action: 'commerce.purchase',
    amount: 199,
    currency: 'USD',
    merchantDomain: 'delta.com',
  });

  // Snippet logs decision.valid + decision.denialReason; both must exist
  // on VerifyResult:
  void decision.valid;
  void decision.denialReason;
}

/* ──────────────────────────────────────────────────────────────────
 *  Suppress "unused" lint for the type-only verification scaffolds.
 *  The constants below are declared `void`'d so a future strict-lint
 *  pass doesn't garbage-collect the functions.
 * ────────────────────────────────────────────────────────────────── */

void _typeCheckedSnippet_marketing_step02;
void _typeCheckedSnippet_marketing_step03_setup;
void _typeCheckedSnippet_marketing_step03;
void _typeCheckedSnippet_dashboard_bootstrap;

describe('quickstart-snippets parity — marketing + dashboard ↔ @aegis/sdk', () => {
  it('is asserted at compile time via the _typeCheckedSnippet_* functions in this file', () => {
    // The real check is tsc — if a quickstart drifts from the SDK
    // contracts, one of the functions above fails to typecheck and
    // `pnpm --filter @aegis/e2e typecheck` reds. This runtime test
    // exists so vitest picks the file up and a future contributor
    // doesn't garbage-collect it as "unused".
    expect(true).toBe(true);
  });
});
