# AEGIS — LangChain / CrewAI / AutoGen Integration Guide
## Wrapping AI Agent Frameworks with Identity, Policy, and Audit

> **Updated:** 2026-05-04  
> **Packages:** `@aegis/sdk` (TypeScript), `aegis` (Python)  
> **Frameworks:** LangChain JS/Python, CrewAI, AutoGen, LlamaIndex

---

## 1. The Core Problem

LangChain agents are powerful but anonymous. When a LangChain agent makes a tool call or takes an action, the downstream service can't answer:
- Which agent made this call?
- Was this agent authorized to do this?
- How much has it spent today?
- What did it do, provably?

AEGIS answers all four questions with a single integration point: the `AegisCallbackHandler`.

---

## 2. LangChain TypeScript

### 2.1 Install

```bash
npm install @aegis/sdk @langchain/core
# or
pnpm add @aegis/sdk @langchain/core
```

### 2.2 Basic Integration

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { AegisCallbackHandler, AegisClient } from '@aegis/sdk';

// Initialize AEGIS client
const aegis = new AegisClient({
  apiKey: process.env.AEGIS_API_KEY!,
  agentId: process.env.AEGIS_AGENT_ID!,
  privateKey: process.env.AEGIS_PRIVATE_KEY!, // Ed25519 private key
});

// Create the AEGIS callback handler
// This intercepts every tool call and wraps it with AEGIS verification
const aegisHandler = new AegisCallbackHandler({
  client: aegis,
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
const tools = [/* your tools */];
const agent = createToolCallingAgent({ llm: model, tools, prompt });

const executor = new AgentExecutor({
  agent,
  tools,
  callbacks: [aegisHandler], // ← wire it here
});

// Run
const result = await executor.invoke({
  input: 'Transfer $50 to Alice',
});

// Every tool call during this run:
// 1. Presents a signed AEGIS JWT
// 2. Is checked against policy (spend limit, scope)
// 3. Gets an audit event written (signed, in the hash chain)
// 4. Respects revocation (if agent is revoked mid-run, calls start failing)
```

### 2.3 Tool-Level Scope Control

Different tools can require different scopes:

```typescript
const aegisHandler = new AegisCallbackHandler({
  client: aegis,
  // Per-tool scope requirements
  toolScopeMap: {
    'transfer_funds': ['payment:write'],
    'read_account_balance': ['payment:read'],
    'send_email': ['email:send'],
    'web_search': ['web:read'],
    // Default for unmapped tools:
    _default: ['tool:execute'],
  },
  // Reject calls if trust band is FLAGGED
  trustBandMinimum: 'WATCH',
});
```

### 2.4 Handling Denials Gracefully

When AEGIS denies a tool call, the handler raises a structured error:

```typescript
import { AegisDenialError } from '@aegis/sdk';

try {
  await executor.invoke({ input: 'Transfer $10,000' });
} catch (err) {
  if (err instanceof AegisDenialError) {
    console.error(`AEGIS blocked this action: ${err.denialReason}`);
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

### 2.5 Streaming with AEGIS

AEGIS verification is synchronous and fast (~50ms). It doesn't interfere with LangChain streaming:

```typescript
const stream = await executor.stream({ input: 'Process my order' });

for await (const chunk of stream) {
  if (chunk.output) {
    process.stdout.write(chunk.output);
  }
}

// Tool calls within the stream are verified synchronously
// If a denial occurs mid-stream: stream terminates with AegisDenialError
```

---

## 3. LangChain Python

### 3.1 Install

```bash
pip install aegis-sdk langchain langchain-openai
# or
uv add aegis-sdk langchain langchain-openai
```

### 3.2 Basic Integration

```python
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain import hub
from aegis import AsyncAegis, AegisCallbackHandler

import asyncio, os

async def main():
    # Initialize AEGIS
    aegis = AsyncAegis(
        api_key=os.environ["AEGIS_API_KEY"],
        agent_id=os.environ["AEGIS_AGENT_ID"],
        private_key=os.environ["AEGIS_PRIVATE_KEY"],
    )
    
    # AEGIS callback handler for LangChain
    aegis_handler = AegisCallbackHandler(
        client=aegis,
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
        callbacks=[aegis_handler],  # wire here
    )
    
    result = await executor.ainvoke({"input": "What's my account balance?"})
    print(result["output"])

asyncio.run(main())
```

### 3.3 LangGraph Integration

For stateful multi-step agent graphs:

```python
from langgraph.graph import StateGraph, END
from aegis import AsyncAegis, verify_tool_call

aegis = AsyncAegis(api_key=..., agent_id=..., private_key=...)

# Decorator approach: protect individual tool functions
@verify_tool_call(client=aegis, scopes=["data:read"], spend=None)
async def query_database(query: str) -> dict:
    """Runs a database query. Protected by AEGIS."""
    return await db.execute(query)

@verify_tool_call(client=aegis, scopes=["payment:write"], spend_field="amount")
async def process_payment(amount: float, recipient: str) -> dict:
    """Processes a payment. Protected by AEGIS with spend tracking."""
    return await payment_service.transfer(amount, recipient)

# These functions now require valid AEGIS tokens when called
# Use them in your LangGraph nodes as normal
```

---

## 4. CrewAI Integration

### 4.1 Wrapping CrewAI Tools

```python
from crewai import Agent, Task, Crew, Process
from crewai.tools import tool
from aegis import AsyncAegis, AegisTool

aegis = AsyncAegis(
    api_key=os.environ["AEGIS_API_KEY"],
    agent_id=os.environ["AEGIS_AGENT_ID"],
    private_key=os.environ["AEGIS_PRIVATE_KEY"],
)

# Method 1: Use AegisTool wrapper
class DatabaseTool(AegisTool):
    name: str = "query_database"
    description: str = "Execute a database query"
    aegis_scopes: list = ["data:read"]
    
    def _run(self, query: str) -> str:
        # AEGIS verifies identity before this method is called
        return database.query(query)

# Method 2: Decorator
@tool("transfer_funds")
@aegis.protect(scopes=["payment:write"], spend_field="amount_usd")
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

# AEGIS verification happens automatically when the agent uses the tool
crew = Crew(agents=[researcher], tasks=[...], process=Process.sequential)
result = crew.kickoff()
```

### 4.2 Per-Agent Policies in CrewAI

Map each CrewAI agent to a separate AEGIS agent for fine-grained policies:

```python
from aegis import AsyncAegis

# Orchestrator agent: higher trust, broader scopes
orchestrator_aegis = AsyncAegis(
    api_key=os.environ["AEGIS_API_KEY"],
    agent_id=os.environ["ORCHESTRATOR_AGENT_ID"],
    private_key=os.environ["ORCHESTRATOR_PRIVATE_KEY"],
)

# Subagent: limited scopes, lower spend limit
subagent_aegis = AsyncAegis(
    api_key=os.environ["AEGIS_API_KEY"],
    agent_id=os.environ["SUBAGENT_ID"],
    private_key=os.environ["SUBAGENT_PRIVATE_KEY"],
)

orchestrator = Agent(
    role="Orchestrator",
    tools=[AegisTool(client=orchestrator_aegis, scopes=["*"])],
)

subagent = Agent(
    role="Data Collector",
    tools=[AegisTool(client=subagent_aegis, scopes=["data:read"])],
)
```

---

## 5. AutoGen Integration

```python
import autogen
from aegis import AsyncAegis, AegisUserProxyAgent

aegis = AsyncAegis(
    api_key=os.environ["AEGIS_API_KEY"],
    agent_id=os.environ["AEGIS_AGENT_ID"],
    private_key=os.environ["AEGIS_PRIVATE_KEY"],
)

# AegisUserProxyAgent wraps autogen.UserProxyAgent
# Intercepts all function calls and verifies with AEGIS
user_proxy = AegisUserProxyAgent(
    name="UserProxy",
    aegis_client=aegis,
    default_scopes=["tool:execute", "code:execute"],
    human_input_mode="NEVER",
    code_execution_config={"work_dir": "coding"},
)

assistant = autogen.AssistantAgent(
    name="Assistant",
    llm_config={"model": "gpt-4o"},
)

# Run conversation — all function calls are AEGIS-verified
user_proxy.initiate_chat(
    assistant,
    message="Analyze this dataset and generate a report",
)
```

---

## 6. Pattern: Audit Trail for Compliance

For regulated industries, the full audit trail of every LangChain action is critical:

```python
from aegis import AsyncAegis

aegis = AsyncAegis(api_key=..., agent_id=..., private_key=...)

# After your agent run, export the audit trail
async def export_run_audit(run_id: str, agent_id: str):
    events = await aegis.audit.list(
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
from aegis import AsyncAegis, SpendExceededError

aegis = AsyncAegis(api_key=..., agent_id=..., private_key=...)

async def safe_agent_loop(tasks: list, daily_budget_usd: float):
    """Run agent tasks with a hard spend cap."""
    
    # Configure daily budget via policy
    await aegis.policies.apply(
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
# Full production example: research agent with AEGIS protection

import os
import asyncio
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.tools import tool
from langchain import hub
from aegis import AsyncAegis, AegisCallbackHandler

aegis = AsyncAegis(
    api_key=os.environ["AEGIS_API_KEY"],
    agent_id=os.environ["AEGIS_AGENT_ID"],
    private_key=os.environ["AEGIS_PRIVATE_KEY"],
)

@tool
def fetch_market_data(ticker: str) -> dict:
    """Fetch current market data for a stock ticker."""
    # aegis verifies: scope=data:read, no spend tracking needed
    return market_api.get(ticker)

@tool
def execute_trade(ticker: str, quantity: int, price: float) -> dict:
    """Execute a stock trade.
    
    Args:
        ticker: Stock symbol
        quantity: Number of shares  
        price: Target price
    """
    # aegis verifies: scope=trading:execute, spend=quantity*price USD
    return trading_api.order(ticker, quantity, price)

async def run():
    handler = AegisCallbackHandler(
        client=aegis,
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
AEGIS_API_KEY=ak_live_xxxx          # Your AEGIS API key
AEGIS_AGENT_ID=agent_xxxx           # Agent identifier
AEGIS_PRIVATE_KEY=base64_ed25519    # Agent's Ed25519 private key (keep secret!)

# Optional
AEGIS_BASE_URL=https://api.aegislabs.io   # Default
AEGIS_TOKEN_TTL=30                        # JWT TTL in seconds (default: 30)
AEGIS_AUDIT_ENABLED=true                  # Disable for local dev (default: true)
```

---

## 10. Troubleshooting

### "Agent verification fails intermittently"

**Cause:** Token TTL (30s) is too short for long-running operations.

```python
# Increase TTL for long operations (max 300s recommended)
aegis = AsyncAegis(
    ...,
    token_ttl=120,  # 2 minutes
)
# Or generate a fresh token per batch:
aegis.refresh_token()  # generates new token, resets TTL
```

### "SPEND_LIMIT_EXCEEDED after N calls"

Expected behavior if `spend_limit` is configured. To increase:

```bash
aegis policy apply --agent $AGENT_ID --spend-limit 10000 --currency USD --window day
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

*LangChain integration guide version: 1.0 | AEGIS Phase 1*
