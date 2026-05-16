# @aegis/vercel-ai-sdk — AEGIS verification for Vercel AI SDK

**Pattern:** A — Tool-call middleware
**Status:** Stub
**Claim hook:** `aegis:int-vercel-ai-sdk`
**Target npm name:** `@aegis/vercel-ai-sdk`

## What it does

The Vercel AI SDK's `streamText` and `generateText` accept a `tools` map. This package exports `aegisTool()` — a wrapper that takes a normal tool definition and returns one that runs `aegis.verify()` before its `execute()` body.

## Surface

```ts
import { streamText, tool } from 'ai';
import { Aegis } from '@aegis/sdk';
import { aegisTool } from '@aegis/vercel-ai-sdk';

const aegis = new Aegis({ apiKey: process.env.AEGIS_KEY });

const createOrder = aegisTool({
  aegis,
  actionPrefix: 'vercel.',
  agentTokenResolver: ({ messages }) => messages.at(-1)?.metadata?.aegis_token,
})(tool({
  description: 'Create a customer order',
  inputSchema: z.object({ items: z.array(z.string()), total: z.number() }),
  execute: async ({ items, total }) => {
    return await api.orders.create({ items, total });
  },
}));

await streamText({
  model: openai('gpt-5'),
  tools: { createOrder },
  prompt: '...',
});
```

## Why this matters

Vercel AI SDK is the dominant TypeScript agent framework — Edge-runtime safe, provider-agnostic, ships as part of Vercel's AI stack. AEGIS-wrapping its tools is a one-line snap-in for any Next.js / Edge app.

## Implementation notes

- Edge-runtime safe — no Node-only deps.
- Preserves the tool's TypeScript types via generics over the input schema.
- Denial: throws a typed `VercelToolVerificationDenial` that the SDK surfaces as a tool error in the stream.

## TODO

- [ ] `aegisTool()` factory implementation
- [ ] Generic type preservation
- [ ] Denial surfacing in streaming context
- [ ] Tests against the AI SDK test harness
- [ ] Example in a Next.js app
