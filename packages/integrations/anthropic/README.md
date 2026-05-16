# @aegis/anthropic — AEGIS verification middleware for Anthropic Claude

**Pattern:** A — Tool-call middleware
**Status:** Stub
**Claim hook:** `aegis:int-anthropic`
**Target npm name:** `@aegis/anthropic`

## What it does

Wraps the Anthropic Messages API and Claude Agent SDK so every `tool_use` content block passes through `aegis.verify()` before the caller dispatches the tool. Returns a typed `tool_result` with denial reason if AEGIS denies.

## Surface

```ts
import Anthropic from '@anthropic-ai/sdk';
import { Aegis } from '@aegis/sdk';
import { withAegisVerification } from '@aegis/anthropic';

const anthropic = withAegisVerification(new Anthropic(), {
  aegis: new Aegis({ apiKey: process.env.AEGIS_KEY }),
  actionPrefix: 'claude.',
  minTrustBand: 'VERIFIED',
  agentTokenResolver: (req) => req.metadata?.aegis_token,
});

// Stream-aware: tool_use events pass through AEGIS verify before
// being yielded to the consumer.
const stream = await anthropic.messages.stream({
  model: 'claude-opus-4-7',
  tools: [{ name: 'orders.create', ... }],
  messages: [...],
  metadata: { aegis_token: agentToken },
});
```

Also exports a Claude Agent SDK adapter:

```ts
import { query, ToolUseBlock } from '@anthropic-ai/claude-agent-sdk';
import { aegisToolMiddleware } from '@aegis/anthropic';

const middleware = aegisToolMiddleware({ aegis, actionPrefix: 'claude.' });
for await (const message of query({ prompt, options: { middleware: [middleware] } })) {
  // tool_use blocks are verified before being emitted
}
```

## Why this matters

Claude's Messages API and Agent SDK are the canonical Anthropic agent surfaces. This integration ships paired with the OpenAI wrapper so customers on either model get identical AEGIS semantics.

## Implementation notes

- Proxies `messages.create`, `messages.stream`, and the Agent SDK's `query()` generator.
- For each `tool_use` block emitted by Claude, the wrapper verifies *before* yielding the block to the consumer.
- Denial: replaces the `tool_use` block with a `tool_result` that has `is_error: true` and `content: { type: 'text', text: 'AEGIS denied: ' + reason }`.
- The model continues the conversation aware of the denial — its retry behavior is its own.

## TODO

- [ ] Proxy implementation for Messages API (non-streaming)
- [ ] Stream-aware tool_use interception
- [ ] Agent SDK middleware adapter
- [ ] Denial → `tool_result` injection
- [ ] Paired tests
- [ ] Example app
