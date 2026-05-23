# @aegis/openai — AEGIS verification middleware for OpenAI

**Pattern:** A — Tool-call middleware
**Status:** Stub
**Claim hook:** `aegis:int-openai`
**Target npm name:** `@aegis/openai`

## What it does

Wraps the OpenAI client so every tool call (Responses API, Assistants API, Agents SDK) passes through `aegis.verify()` before execution. On denial, the tool call is rejected with a typed `BridgeDenialError` whose `reason` field carries the AEGIS denial code (`AGENT_NOT_FOUND`, `POLICY_REVOKED`, `SCOPE_NOT_GRANTED`, `TRUST_SCORE_TOO_LOW`, etc.).

## Surface

```ts
import OpenAI from 'openai';
import { Aegis } from '@aegis/sdk';
import { withAegisVerification } from '@aegis/openai';

const openai = withAegisVerification(new OpenAI(), {
  aegis: new Aegis({ apiKey: process.env.AEGIS_KEY }),
  actionPrefix: 'openai.',
  minTrustBand: 'VERIFIED',
  agentTokenResolver: (req) => req.metadata?.aegis_token,
});

// Every tool call inside openai.responses.create() and
// openai.beta.threads.runs.create() now passes through AEGIS verify.
const result = await openai.responses.create({
  model: 'gpt-5',
  tools: [{ type: 'function', name: 'orders.create', ... }],
  input: '...',
  metadata: { aegis_token: agentToken },
});
```

## Why this matters

OpenAI's Responses API and Assistants API are the most common agent-tool-call surfaces on the planet. A drop-in wrapper that requires zero config beyond an AEGIS key is the lowest-friction integration possible. This is Tier-A Phase-1: ships first.

## Implementation notes

- The wrapper proxies the OpenAI client and intercepts `responses.create`, `beta.threads.runs.create`, and `beta.threads.runs.stream`.
- The agent token is extracted via `agentTokenResolver` (default: read `metadata.aegis_token`).
- For each function-call output that the model emits, the wrapper verifies *before* allowing the caller to dispatch the tool.
- Streaming surface: emit a typed `aegis.denied` chunk into the stream so consumers can react.

## TODO

- [ ] Proxy implementation
- [ ] Tool-call interception in non-streaming path
- [ ] Tool-call interception in streaming path
- [ ] `agentTokenResolver` contract + tests
- [ ] Denial reason → user-facing error mapping
- [ ] Paired tests against the OpenAI API mock
- [ ] Edge-runtime compatibility check (no Node-only deps)
- [ ] Example app in `examples/openai-aegis/`
