# CERNIQ — LangChain / CrewAI / AutoGen Integration Guide

## Wrapping AI Agent Frameworks with Identity, Policy, and Audit

> **Updated:** 2026-05-04  
> **Packages:** `@cerniq/sdk` (TypeScript), `cerniq` (Python)  
> **Frameworks:** LangChain JS/Python, CrewAI, AutoGen, LlamaIndex

---

## 1. The Core Problem

LangChain agents are powerful but anonymous. When a LangChain agent makes a tool call or takes an action, the downstream service can't answer:

- Which agent made this call?
- Was this agent authorized to do this?
- How much has it spent today?
- What did it do, provably?

CERNIQ answers all four questions with a single integration point: the `CerniqCallbackHandler`.

---

## 2. LangChain TypeScript

### 2.1 Install

```bash
npm install @cerniq/sdk @langchain/core
# or
pnpm add @cerniq/sdk @langchain/core
```

### 2.2 Basic Integration

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { CerniqCallbackHandler, CerniqClient } from '@cerniq/sdk';

// Initialize CERNIQ client
const cerniq = new CerniqClient({
  apiKey: process.env.CERNIQ_API_KEY!,
  agentId: process.env.CERNIQ_AGENT_ID!,
  privateKey: process.env.CERNIQ_PRIVATE_KEY!, // Ed25519 private key
});

// Create the CERNIQ callback handler
// This intercepts every tool call and wraps it with CERNIQ verification
const cerniqHandler = new CerniqCallbackHandler({
  client: cerniq,
  // Scopes required for this agent's tool calls
  defaultScopes: ['tool:execute'],
  // Spend tracking: include amount + currency in tool metadata when possible
  spendExtractor: (toolName, input) => {
    // Example: extract spend from tool inputs
    if (toolName === 'transfer_funds' && input.amount) {
      return { amount: input.amount, currency: input.currency ?? 'USD' };
    }
    return null;
  },
});

// Build your LangChain agent as normal
const model = new ChatOpenAI({ model: 'gpt-4o', temperature: 0 });
const tools = [
  /* your tools */
];
const agent = createToolCallingAgent({ llm: model, tools, prompt });

const executor = new AgentExecutor({
  agent,
  tools,
  callbacks: [cerniqHandler], // ← wire it here
});

// Run
const result = await executor.invoke({
  input: 'Transfer $50 to Alice',
});

// Every tool call during this run:
// 1. Presents a signed CERNIQ JWT
// 2. Is checked against policy (spend limit, scope)
// 3. Gets an audit event written (signed, in the hash chain)
// 4. Respects revocation (if agent is revoked mid-run, calls start failing)
```

### 2.3 Tool-Level Scope Control

Different tools can require different scopes:

```typescript
const cerniqHandler = new CerniqCallbackHandler({
  client: cerniq,
  // Per-tool scope requirements
  toolScopeMap: {
    transfer_funds: ['payment:write'],
    read_account_balance: ['payment:read'],
    send_email: ['email:send'],
    web_search: ['web:read'],
    // Default for unmapped tools:
    _default: ['tool:execute'],
  },
  // Reject calls if trust band is FLAGGED
  trustBandMinimum: 'WATCH',
});
```

### 2.4 Handling Denials Gracefully

When CERNIQ denies a tool call, the handler raises a structured error:

```typescript
import { CerniqDenialError } from '@cerniq/sdk';

try {
  await executor.invoke({ input: 'Transfer $10,000' });
} catch (err) {
  if (err instanceof CerniqDenialError) {
    console.error(`CERNIQ blocked this action: ${err.denialReason}`);
    // err.denialReason: 'SPEND_LIMIT_EXCEEDED' | 'SCOPE_NOT_GRANTED' | ...
    // err.agentId: which agent was blocked
    // err.auditEventId: reference to the audit log entry

    // Don't retry — it will continue to fail
    // Instead: notify the user or escalate
    return {
      error: `Action blocked: ${err.message}. Contact support.`,
    };
  }
  throw err;
}
```

### 2.5 Streaming with CERNIQ

CERNIQ verification is synchronous and fast (~50ms). It doesn't interfere with LangChain streaming:

```typescript
const stream = await executor.stream({ input: 'Process my order' });

for await (const chunk of stream) {
  if (chunk.output) {
    process.stdout.write(chunk.output);
  }
}

// Tool calls within the stream are verified synchronously
// If a denial occurs mid-stream: stream terminates with CerniqDenialError
```

---

## 3. LangChain Python

### 3.1 Install

```bash
pip install cerniq-sdk langchain langchain-openai
# or
uv add cerniq-sdk langchain langchain-openai
```

### 3.2 Basic Integration

```python
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain import hub
from cerniq import AsyncCerniq, CerniqCallbackHandler

import asyncio, os

async def main():
    # Initialize CERNIQ
    cerniq = AsyncCerniq(
        api_key=os.environ["CERNIQ_API_KEY"],
        agent_id=os.environ["CERNIQ_AGENT_ID"],
        private_key=os.environ["CERNIQ_PRIVATE_KEY"],
    )

    # CERNIQ callback handler for LangChain
    cerniq_handler = CerniqCallbackHandler(
        client=cerniq,
        default_scopes=["tool:execute"],
    )

    # Build agent
    llm = ChatOpenAI(model="gpt-4o")
    tools = [...]  # your tools
    prompt = hub.pull("hwchase17/openai-tools-agent")
    agent = create_tool_calling_agent(llm, tools, prompt)

    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        callbacks=[cerniq_handler],  # wire here
    )

    result = await executor.ainvoke({"input": "What's my account balance?"})
    print(result["output"])

asyncio.run(main())
```

### 3.3 LangGraph Integration

For stateful multi-step agent graphs:

```python
from langgraph.graph import StateGraph, END
from cerniq import AsyncCerniq, verify_tool_call

cerniq = AsyncCerniq(api_key=..., agent_id=..., private_key=...)

# Decorator approach: protect individual tool functions
@verify_tool_call(client=cerniq, scopes=["data:read"], spend=None)
async def query_database(query: str) -> dict:
    """Runs a database query. Protected by CERNIQ."""
    return await db.execute(query)

@verify_tool_call(client=cerniq, scopes=["payment:write"], spend_field="amount")
async def process_payment(amount: float, recipient: str) -> dict:
    """Processes a payment. Protected by CERNIQ with spend tracking."""
    return await payment_service.transfer(amount, recipient)

# These functions now require valid CERNIQ tokens when called
# Use them in your LangGraph nodes as normal
```

---

## 4. CrewAI Integration

### 4.1 Wrapping CrewAI Tools

```python
from crewai import Agent, Task, Crew, Process
from crewai.tools import tool
from cerniq import AsyncCerniq, CerniqTool

cerniq = AsyncCerniq(
    api_key=os.environ["CERNIQ_API_KEY"],
    agent_id=os.environ["CERNIQ_AGENT_ID"],
    private_key=os.environ["CERNIQ_PRIVATE_KEY"],
)

# Method 1: Use CerniqTool wrapper
class DatabaseTool(CerniqTool):
    name: str = "query_database"
    description: str = "Execute a database query"
    cerniq_scopes: list = ["data:read"]

    def _run(self, query: str) -> str:
        # CERNIQ verifies identity before this method is called
        return database.query(query)

# Method 2: Decorator
@tool("transfer_funds")
@cerniq.protect(scopes=["payment:write"], spend_field="amount_usd")
def transfer_funds(amount_usd: float, recipient_id: str) -> str:
    """Transfer funds to a recipient. Requires payment:write scope."""
    return payment_service.transfer(amount_usd, recipient_id)

# Build crew as normal
researcher = Agent(
    role="Financial Analyst",
    goal="Analyze account data",
    tools=[DatabaseTool()],
    verbose=True,
)

# CERNIQ verification happens automatically when the agent uses the tool
crew = Crew(agents=[researcher], tasks=[...], process=Process.sequential)
result = crew.kickoff()
```

### 4.2 Per-Agent Policies in CrewAI

Map each CrewAI agent to a separate CERNIQ agent for fine-grained policies:

```python
from cerniq import AsyncCerniq

# Orchestrator agent: higher trust, broader scopes
orchestrator_cerniq = AsyncCerniq(
    api_key=os.environ["CERNIQ_API_KEY"],
    agent_id=os.environ["ORCHESTRATOR_AGENT_ID"],
    private_key=os.environ["ORCHESTRATOR_PRIVATE_KEY"],
)

# Subagent: limited scopes, lower spend limit
subagent_cerniq = AsyncCerniq(
    api_key=os.environ["CERNIQ_API_KEY"],
    agent_id=os.environ["SUBAGENT_ID"],
    private_key=os.environ["SUBAGENT_PRIVATE_KEY"],
)

orchestrator = Agent(
    role="Orchestrator",
    tools=[CerniqTool(client=orchestrator_cerniq, scopes=["*"])],
)

subagent = Agent(
    role="Data Collector",
    tools=[CerniqTool(client=subagent_cerniq, scopes=["data:read"])],
)
```

---

## 5. AutoGen Integration

```python
import autogen
from cerniq import AsyncCerniq, CerniqUserProxyAgent

cerniq = AsyncCerniq(
    api_key=os.environ["CERNIQ_API_KEY"],
    agent_id=os.environ["CERNIQ_AGENT_ID"],
    private_key=os.environ["CERNIQ_PRIVATE_KEY"],
)

# CerniqUserProxyAgent wraps autogen.UserProxyAgent
# Intercepts all function calls and verifies with CERNIQ
user_proxy = CerniqUserProxyAgent(
    name="UserProxy",
    cerniq_client=cerniq,
    default_scopes=["tool:execute", "code:execute"],
    human_input_mode="NEVER",
    code_execution_config={"work_dir": "coding"},
)

assistant = autogen.AssistantAgent(
    name="Assistant",
    llm_config={"model": "gpt-4o"},
)

# Run conversation — all function calls are CERNIQ-verified
user_proxy.initiate_chat(
    assistant,
    message="Analyze this dataset and generate a report",
)
```

---

## 6. Pattern: Audit Trail for Compliance

For regulated industries, the full audit trail of every LangChain action is critical:

```python
from cerniq import AsyncCerniq

cerniq = AsyncCerniq(api_key=..., agent_id=..., private_key=...)

# After your agent run, export the audit trail
async def export_run_audit(run_id: str, agent_id: str):
    events = await cerniq.audit.list(
        agent_id=agent_id,
        since_run_id=run_id,
        include_chain_proof=True,  # cryptographic proof of integrity
    )

    for event in events:
        print(f"""
        {event.created_at}: {event.action}
        Outcome: {event.outcome}
        Signed: {event.signature[:20]}...
        Chain verified: {event.chain_valid}
        """)

# Export proves: which agent, what action, when, what result, unmodified
```

---

## 7. Pattern: Spend-Aware Agent Loops

```python
from cerniq import AsyncCerniq, SpendExceededError

cerniq = AsyncCerniq(api_key=..., agent_id=..., private_key=...)

async def safe_agent_loop(tasks: list, daily_budget_usd: float):
    """Run agent tasks with a hard spend cap."""

    # Configure daily budget via policy
    await cerniq.policies.apply(
        scope="payment:write",
        spend_limit=daily_budget_usd,
        currency="USD",
        window="day",
    )

    results = []
    for task in tasks:
        try:
            result = await run_agent_task(task)
            results.append({"task": task, "result": result, "status": "ok"})
        except SpendExceededError as e:
            # Budget exhausted — stop loop, don't continue spending
            results.append({
                "task": task,
                "status": "blocked",
                "reason": "daily_budget_exhausted",
                "spent": e.total_spent,
                "limit": e.limit,
            })
            break  # Important: stop here

    return results
```

---

## 8. Complete Example: Financial Research Agent

```python
# Full production example: research agent with CERNIQ protection

import os
import asyncio
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.tools import tool
from langchain import hub
from cerniq import AsyncCerniq, CerniqCallbackHandler

cerniq = AsyncCerniq(
    api_key=os.environ["CERNIQ_API_KEY"],
    agent_id=os.environ["CERNIQ_AGENT_ID"],
    private_key=os.environ["CERNIQ_PRIVATE_KEY"],
)

@tool
def fetch_market_data(ticker: str) -> dict:
    """Fetch current market data for a stock ticker."""
    # cerniq verifies: scope=data:read, no spend tracking needed
    return market_api.get(ticker)

@tool
def execute_trade(ticker: str, quantity: int, price: float) -> dict:
    """Execute a stock trade.

    Args:
        ticker: Stock symbol
        quantity: Number of shares
        price: Target price
    """
    # cerniq verifies: scope=trading:execute, spend=quantity*price USD
    return trading_api.order(ticker, quantity, price)

async def run():
    handler = CerniqCallbackHandler(
        client=cerniq,
        toolScopeMap={
            "fetch_market_data": ["data:read"],
            "execute_trade": ["trading:execute"],
            _default: ["tool:execute"],
        },
        spendExtractor=lambda name, args: (
            {"amount": args.get("quantity", 0) * args.get("price", 0), "currency": "USD"}
            if name == "execute_trade" else None
        ),
    )

    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    tools = [fetch_market_data, execute_trade]
    prompt = hub.pull("hwchase17/openai-tools-agent")
    agent = create_tool_calling_agent(llm, tools, prompt)

    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        callbacks=[handler],
        verbose=True,
    )

    # This agent:
    # - Has identity (registered Ed25519 key)
    # - Has policy ($5,000/day trading limit, data:read + trading:execute scopes)
    # - Every action is in the audit log (signed, tamper-evident)
    # - Will be blocked if it tries to exceed $5,000
    result = await executor.ainvoke({
        "input": "Buy $1,000 worth of AAPL at market price"
    })
    print(result["output"])

asyncio.run(run())
```

---

## 9. Environment Variables Reference

```bash
# Required for all LangChain integrations
CERNIQ_API_KEY=ak_live_xxxx          # Your CERNIQ API key
CERNIQ_AGENT_ID=agent_xxxx           # Agent identifier
CERNIQ_PRIVATE_KEY=base64_ed25519    # Agent's Ed25519 private key (keep secret!)

# Optional
CERNIQ_BASE_URL=https://api.cerniq.io   # Default
CERNIQ_TOKEN_TTL=30                        # JWT TTL in seconds (default: 30)
CERNIQ_AUDIT_ENABLED=true                  # Disable for local dev (default: true)
```

---

## 10. Troubleshooting

### "Agent verification fails intermittently"

**Cause:** Token TTL (30s) is too short for long-running operations.

```python
# Increase TTL for long operations (max 300s recommended)
cerniq = AsyncCerniq(
    ...,
    token_ttl=120,  # 2 minutes
)
# Or generate a fresh token per batch:
cerniq.refresh_token()  # generates new token, resets TTL
```

### "SPEND_LIMIT_EXCEEDED after N calls"

Expected behavior if `spend_limit` is configured. To increase:

```bash
cerniq policy apply --agent $AGENT_ID --spend-limit 10000 --currency USD --window day
```

### "Callback handler not being called"

Ensure callbacks are passed at the correct level:

```python
# Wrong: passing to LLM (only gets LLM callbacks)
executor = AgentExecutor(agent=agent, tools=tools)
llm_with_callbacks = llm.with_config(callbacks=[handler])  # ← won't intercept tools

# Correct: passing to executor (intercepts all)
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    callbacks=[handler],  # ← correct level
)
```

---

_LangChain integration guide version: 1.0 | CERNIQ Phase 1_
