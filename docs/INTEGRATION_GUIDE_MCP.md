# AEGIS — MCP Integration Guide
## Claude Desktop, Cursor, Cline, and Any MCP Server

> **The wedge.** Every MCP server in the wild is a potential AEGIS relying party. One `wrap()` call is all it takes.  
> **Updated:** 2026-05-04  
> **Packages:** `@aegis/mcp-bridge`, `@aegis/mcp-server`

---

## 1. Why MCP + AEGIS

The Model Context Protocol (MCP) connects AI agents (Claude, GPT, Gemini) to tools and services. But MCP has no built-in answer to: "which AI agent made this call, and should I trust it?"

AEGIS answers that question. Every `wrap()` call:
- Requires the calling agent to present a signed JWT (proof of identity)
- Enforces your policy (spend limits, scope gates, trust thresholds)
- Appends a signed audit event (cryptographic proof of what happened)
- Can reject the call before it reaches your tool server (before any side effects)

**Result:** Your MCP server becomes a compliant, auditable surface that AI agents can call safely.

---

## 2. Quickstart — Wrap Any MCP Server

### 2.1 Install

```bash
npm install @aegis/mcp-bridge @aegis/sdk
# or
pnpm add @aegis/mcp-bridge @aegis/sdk
```

### 2.2 Wrap Your MCP Server

Before (unprotected):
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({ name: 'my-tool-server', version: '1.0.0' });
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  // ⚠️ No identity check — any agent can call any tool
  return await myTool.execute(req.params);
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

After (AEGIS-protected, 3 lines changed):
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { wrap } from '@aegis/mcp-bridge';

const server = new Server({ name: 'my-tool-server', version: '1.0.0' });
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  return await myTool.execute(req.params);
});

// ✅ One call adds identity, policy, spend, and audit
const protectedServer = wrap(server, {
  apiKey: process.env.AEGIS_API_KEY,
  // Optional: override defaults
  // requiredScopes: ['tool:execute'],
  // trustBandMinimum: 'VERIFIED',
  // spendLimit: { amount: 1000, currency: 'USD', window: 'day' },
});

const transport = new StdioServerTransport();
await protectedServer.connect(transport);
```

### 2.3 What `wrap()` Does

For every incoming tool call:

1. **Extracts** the AEGIS JWT from `params._aegisToken` (or `headers['x-aegis-token']`)
2. **Verifies** Ed25519 signature, expiry, scopes — offline, no network call needed
3. **Checks** policy: spend limit, scope gates, trust band
4. **If denied**: returns MCP error response with `denialReason`, never calls your handler
5. **If approved**: calls your handler, then appends signed audit event
6. **Injects** `ctx.agentId`, `ctx.trustBand`, `ctx.trustScore` into your handler context

---

## 3. Claude Desktop Integration

### 3.1 How Claude Sends AEGIS Tokens

Claude Desktop's AEGIS integration (when configured) automatically:
1. Loads the agent's Ed25519 key from the local keychain
2. Signs a JWT for each tool call with 30-second TTL
3. Includes the token in `params._aegisToken`

This is transparent to the agent — no special prompting required.

### 3.2 Configure Claude Desktop

In Claude Desktop settings → Developer → MCP Servers, add:

```json
{
  "mcpServers": {
    "my-protected-server": {
      "command": "node",
      "args": ["/path/to/your/mcp-server/dist/index.js"],
      "env": {
        "AEGIS_API_KEY": "ak_live_xxxx",
        "AEGIS_AGENT_PRIVATE_KEY": "${AEGIS_PRIVATE_KEY}"
      }
    }
  }
}
```

### 3.3 Register the Claude Agent

Before Claude can make AEGIS-verified calls, register it as an agent:

```bash
# Register the Claude Desktop agent
aegis agents register \
  --name "claude-desktop-main" \
  --public-key "$(cat ~/.aegis/agent.pub)" \
  --description "Claude Desktop — primary work agent"

# Attach a policy (what is this agent allowed to do?)
aegis policy apply \
  --agent claude-desktop-main \
  --scope "tool:execute" \
  --scope "file:read" \
  --spend-limit 500 \
  --spend-currency USD \
  --spend-window day
```

### 3.4 Testing the Integration

```bash
# Verify Claude can make an authenticated call
aegis verify \
  --agent claude-desktop-main \
  --scope tool:execute \
  --amount 10

# Expected output:
# ✅ Verification: APPROVED
# Agent: claude-desktop-main
# Trust band: VERIFIED (score: 823)
# Scope: tool:execute ✓
# Spend: $10.00 / $500.00 daily limit
```

---

## 4. Cursor Integration

Cursor uses MCP servers for context retrieval and tool execution. Wire AEGIS the same way:

```typescript
// cursor-mcp-server/src/index.ts
import { wrap } from '@aegis/mcp-bridge';
import { createCursorToolServer } from './tools';

const server = createCursorToolServer();

// Protect with AEGIS — developers and their agents get identity + audit
const protected = wrap(server, {
  apiKey: process.env.AEGIS_API_KEY,
  relyingPartyId: process.env.AEGIS_RELYING_PARTY_ID,
  onDenied: (result) => {
    console.error(`[AEGIS] Denied: ${result.denialReason} for agent ${result.agentId}`);
  },
  onApproved: (result) => {
    // Optional: metrics, logging
  },
});
```

**Cursor-specific pattern:** Register each developer's Cursor instance as a separate agent for per-developer audit trails:

```bash
aegis agents register --name "cursor-alice@company.com" --public-key ...
aegis agents register --name "cursor-bob@company.com" --public-key ...
```

Now every code action in Cursor is attributed to the right developer's agent.

---

## 5. Cline Integration

Cline (VS Code extension for AI-assisted coding) works identically:

```typescript
// cline-mcp-bridge/src/aegis-wrapper.ts
import { wrap, type WrapOptions } from '@aegis/mcp-bridge';

export function wrapForCline(server: MCPServer): MCPServer {
  const options: WrapOptions = {
    apiKey: process.env.AEGIS_API_KEY,
    // Cline-specific: allow filesystem + terminal tools
    requiredScopes: ['fs:read', 'fs:write', 'shell:execute'],
    // Cline agents should be VERIFIED or better
    trustBandMinimum: 'VERIFIED',
    // Limit filesystem spend to prevent runaway operations
    spendLimit: {
      amount: 10000,  // 10K file operations per day
      currency: 'OPS',
      window: 'day',
    },
  };
  return wrap(server, options);
}
```

---

## 6. Building a Protected MCP Server from Scratch

For teams building new MCP servers that should be AEGIS-native:

```typescript
// src/index.ts — Full example: protected file system MCP server

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { wrap, type AegisMcpContext } from '@aegis/mcp-bridge';
import * as fs from 'node:fs/promises';

const server = new Server(
  { name: 'aegis-fs-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Declare tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from the filesystem',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file', 
      description: 'Write content to a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  ],
}));

// Implement tools — context is injected by AEGIS wrapper
server.setRequestHandler(CallToolRequestSchema, async (req, context: AegisMcpContext) => {
  const { name, arguments: args } = req.params;
  
  // context.agentId, context.trustBand, context.trustScore are available
  console.log(`Tool call from agent ${context.agentId} (${context.trustBand})`);

  if (name === 'read_file') {
    const content = await fs.readFile(args.path as string, 'utf-8');
    return { content: [{ type: 'text', text: content }] };
  }
  
  if (name === 'write_file') {
    // Example: require PLATINUM band for file writes
    if (context.trustBand === 'WATCH' || context.trustBand === 'FLAGGED') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Insufficient trust band for write operations' }],
      };
    }
    await fs.writeFile(args.path as string, args.content as string);
    return { content: [{ type: 'text', text: 'Written successfully' }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Wrap with AEGIS
const protectedServer = wrap(server, {
  apiKey: process.env.AEGIS_API_KEY!,
  relyingPartyId: process.env.AEGIS_RELYING_PARTY_ID,
  // Per-tool scope requirements
  toolScopeMap: {
    read_file: ['fs:read'],
    write_file: ['fs:write'],
  },
});

const transport = new StdioServerTransport();
await protectedServer.connect(transport);
```

---

## 7. AEGIS MCP Server (Manage AEGIS via MCP)

AEGIS itself exposes a management API as an MCP server. This lets Claude/Cursor manage AEGIS configuration conversationally.

### 7.1 Install the AEGIS MCP Server

```bash
npx @aegis/mcp-server
```

### 7.2 Add to Claude Desktop

```json
{
  "mcpServers": {
    "aegis": {
      "command": "npx",
      "args": ["@aegis/mcp-server"],
      "env": {
        "AEGIS_API_KEY": "ak_live_xxxx"
      }
    }
  }
}
```

### 7.3 Available Tools

The AEGIS MCP server exposes these tools in the `aegis.*` namespace:

```
aegis.registerAgent(name, publicKey)      → AgentIdentity
aegis.getAgent(id)                        → AgentIdentity + trust state
aegis.revokeAgent(id, reason)             → void
aegis.listAgents()                        → AgentIdentity[]
aegis.applyPolicy(agentId, policy)        → AgentPolicy
aegis.listPolicies(agentId)               → AgentPolicy[]
aegis.getAuditLog(agentId, limit)         → AuditEvent[]
aegis.verifyChainIntegrity(limit)         → { breaks: number, ok: boolean }
aegis.getTrustScore(agentId)              → { score: number, band: TrustBand, explanation: ... }
aegis.getOnboardingStatus()               → PrincipalOnboarding
```

Example: "Claude, register my new agent and give it permission to make payments up to $100"

Claude will:
1. Call `aegis.registerAgent(...)` to create the agent
2. Call `aegis.applyPolicy(...)` to set the spend limit
3. Return the agent ID and a summary of what was configured

---

## 8. Multi-Agent Delegation (Phase 2)

When an orchestrator agent delegates to sub-agents:

```typescript
// Orchestrator creates a delegation token
const delegation = await aegis.agents.delegate({
  from: 'orchestrator-agent-id',
  to: 'subagent-id',
  scopes: ['payment:read'], // subset of orchestrator's scopes
  maxDepth: 2,              // prevent infinite delegation chains
  ttlSeconds: 300,          // delegation expires in 5 minutes
});

// Sub-agent includes the delegation chain in its verify token
const token = await signToken({
  sub: 'subagent-id',
  act: delegation.chain,    // attestation chain
  scopes: ['payment:read'],
});

// AEGIS verify validates the full delegation chain
// AgentDelegation table: max depth is enforced (CLAUDE.md Invariant)
```

---

## 9. Revocation Propagation

When an agent is revoked, MCP servers should stop accepting its tokens within 30 seconds.

### 9.1 Webhook-Based Revocation

```typescript
// In your MCP server (or its host process)
import { AegisVerifier } from '@aegis/verifier-rp';

const verifier = new AegisVerifier({
  aegisUrl: 'https://api.aegislabs.io',
  apiKey: process.env.AEGIS_API_KEY,
});

// Webhook handler — wire to your Express/Fastify/Hono server
app.post('/webhooks/aegis', async (req, res) => {
  // HMAC verification (required)
  const sig = req.headers['x-aegis-signature'];
  const expected = createHmac('sha256', process.env.AEGIS_WEBHOOK_SECRET!)
    .update((req as any).rawBody)
    .digest('hex');
  if (sig !== expected) return res.status(401).send('Invalid signature');
  
  const event = req.body;
  
  if (event.type === 'agent.revoked') {
    // Bust the verifier's local cache for this agent
    await verifier.invalidateAgent(event.data.agentId);
    console.log(`Agent ${event.data.agentId} revoked — cache busted`);
  }
  
  res.json({ received: true });
});
```

### 9.2 Polling Fallback

If webhooks aren't configured, verifier-rp polls revocation status:

```typescript
const verifier = new AegisVerifier({
  aegisUrl: 'https://api.aegislabs.io',
  apiKey: process.env.AEGIS_API_KEY,
  revocationPollInterval: 30_000, // 30 seconds (default)
  // Revoked agents are cached for max 5 minutes
});
```

---

## 10. Troubleshooting

### "Token not found in request"

`@aegis/mcp-bridge` looks for the token in:
1. `params._aegisToken` (preferred for MCP tool calls)
2. `headers['x-aegis-token']` (for HTTP transports)
3. `params.aegisToken` (legacy format)

If your MCP client doesn't inject the token automatically, inject it in your MCP server SDK call:

```typescript
// In your agent code, when making MCP calls:
const result = await mcpClient.callTool({
  name: 'my_tool',
  arguments: {
    // Your normal args
    input: 'hello',
    // AEGIS token
    _aegisToken: await aegis.agents.sign({ scopes: ['tool:execute'], ttlSeconds: 30 }),
  },
});
```

### "SCOPE_NOT_GRANTED"

The agent's policy doesn't include the scope required by the tool.

```bash
# Check what scopes the agent has
aegis policy get --agent [AGENT_ID]

# Add the missing scope
aegis policy apply --agent [AGENT_ID] --scope tool:execute
```

### "TRUST_SCORE_TOO_LOW"

Your MCP server requires `trustBandMinimum: 'VERIFIED'` but the agent is `WATCH` or `FLAGGED`.

```bash
# Check agent's current trust state
aegis agents get --id [AGENT_ID] --show-trust-breakdown

# The score will increase naturally as the agent builds behavioral history
# See DEVELOPER_QUICKSTART.md §Trust Bands
```

---

*MCP integration guide version: 1.0 | AEGIS Phase 1*
