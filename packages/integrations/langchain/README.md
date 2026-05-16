# @aegis/langchain — AEGIS verification for LangChain & LangGraph

**Pattern:** A — Tool-call middleware
**Status:** Stub
**Claim hook:** `aegis:int-langchain`
**Target npm name:** `@aegis/langchain` (JS) and `aegis-langchain` (Python via packages/sdk-py/aegis-langchain)

## What it does

Wraps LangChain `BaseTool` (JS) and `langchain.tools.Tool` (Python) with AEGIS verification. The wrapper checks AEGIS before delegating to the tool's `_call` / `_run`, denying with a typed error on failure.

Also exports a LangGraph node factory: `aegisVerifyNode()` — a node you insert into a graph to gate transitions.

## Surface (JS)

```ts
import { DynamicTool } from '@langchain/core/tools';
import { AegisTool } from '@aegis/langchain';
import { Aegis } from '@aegis/sdk';

const aegis = new Aegis({ apiKey: process.env.AEGIS_KEY });

const verifiedSearch = new AegisTool({
  aegis,
  actionPrefix: 'langchain.',
  tool: new DynamicTool({
    name: 'search',
    description: 'Search the web',
    func: async (query) => { /* ... */ },
  }),
  agentTokenResolver: (input) => input.aegis_token,
});
```

## Surface (Python)

```py
from langchain.tools import Tool
from aegis_langchain import AegisTool
from aegis import Aegis

aegis = Aegis(api_key=os.environ['AEGIS_KEY'])

verified_search = AegisTool(
    aegis=aegis,
    action_prefix='langchain.',
    tool=Tool(name='search', func=search_fn, description='Search the web'),
    agent_token_resolver=lambda inp: inp['aegis_token'],
)
```

## LangGraph node

```ts
import { aegisVerifyNode } from '@aegis/langchain';

const graph = new StateGraph(state)
  .addNode('verify', aegisVerifyNode({ aegis, actionResolver: (state) => state.next_action }))
  .addEdge('plan', 'verify')
  .addConditionalEdges('verify', (state) => state.verify_result?.valid ? 'execute' : 'deny');
```

## TODO

- [ ] JS `AegisTool` class
- [ ] Python `AegisTool` class (packages/sdk-py/aegis-langchain/)
- [ ] LangGraph node factory
- [ ] Tests against LangChain mock harness
- [ ] Example chain + example graph
