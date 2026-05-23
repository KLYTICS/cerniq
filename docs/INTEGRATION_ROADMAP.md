# AEGIS — Integration Ecosystem Roadmap

> **Vision.** AEGIS is the verification layer for the agent economy. Every LLM, every agent framework, every workflow tool, every cloud — agents talk to all of them, and every interaction needs a cryptographic answer to *who is acting, what they're allowed to do, and whether the trace is auditable*. This roadmap maps the full surface and surfaces parallel-claimable work for the Claude peer fleet.
>
> **Living document.** Drafted 2026-05-15. Each surface has a `Status` field (Available · Beta · Coming Soon · Planned · Researching). Claim hooks point at `packages/integrations/<slug>/` stub directories where the work begins.

---

## Architectural pattern — how AEGIS attaches

Every integration follows one of four patterns, depending on where the agent action originates:

| Pattern | When | Code surface |
|---|---|---|
| **A. Tool-call middleware** | Agent runs in an LLM framework that invokes tools (OpenAI Responses, Claude Agent SDK, Vercel AI SDK tools) | Wrap the tool execution: verify token + action *before* tool runs; deny with typed reason on failure |
| **B. Workflow node** | Agent action is a step in a no-code/low-code workflow (n8n, Zapier, Make, Pipedream) | Native node/app that wraps `POST /v1/verify` and returns a gate decision |
| **C. Cloud function adapter** | Agent action runs in a serverless function or cloud orchestration (AWS Lambda, Azure Functions, GCP Cloud Functions, Step Functions, Logic Apps) | Provider-shaped middleware: read identity from request → verify → continue or deny |
| **D. Audit sink** | AEGIS audit events flow into an external SIEM/observability system (Datadog, Splunk, CloudWatch, Sentinel) | NDJSON / Parquet exporter + signed manifest verifier; pluggable destination |

These four patterns cover every integration in this roadmap. New surfaces typically pick A or C.

---

## Tier-A: Phase-1 priority surfaces (ship before $5K MRR)

These power the largest reach in the agent ecosystem. Each has a stub at `packages/integrations/<slug>/` ready for peer-claim.

| Integration | Pattern | Slug | Claim hook | Status |
|---|---|---|---|---|
| **OpenAI Assistants + Responses API** | A | `openai` | `aegis:int-openai` | Stub |
| **Anthropic Claude Agent SDK** | A | `anthropic` | `aegis:int-anthropic` | Stub |
| **Vercel AI SDK** | A | `vercel-ai-sdk` | `aegis:int-vercel-ai-sdk` | Stub |
| **LangChain / LangGraph** | A | `langchain` | `aegis:int-langchain` | Stub |
| **n8n** | B | `n8n` | `aegis:int-n8n` | Stub |
| **Zapier** | B | `zapier` | `aegis:int-zapier` | Stub |
| **AWS** (Lambda + EventBridge + Bedrock) | C | `aws` | `aegis:int-aws` | Stub |
| **Azure** (Functions + OpenAI Service) | C | `azure` | `aegis:int-azure` | Stub |

**How a peer claims one:**

```sh
~/.claude/peers/bin/claude-peers claim aegis:int-<slug>
# read packages/integrations/<slug>/README.md
# implement the TODO bodies
# write paired tests
# `pnpm test:parity` must remain green
# release on completion
```

---

## Tier-B: Q3-2026 surfaces (ship before $50K MRR)

Significant reach but lower priority than Tier A. Stubs created on demand when a peer claims them.

### LLM providers (extended)

| Provider | Pattern | Notes |
|---|---|---|
| Google Gemini / Vertex AI | A | Wrap Function Calling API |
| Mistral | A | Wrap function-calling |
| Cohere | A | Wrap tool use |
| Meta (Llama) | A | Open-weights; wrap via Together/Replicate or direct |
| xAI (Grok) | A | Function-calling shape similar to OpenAI |
| AWS Bedrock | A+C | Multi-model + Bedrock Agents pattern |
| Replicate / Together / Groq / Perplexity / DeepSeek | A | Each wraps similar surface |

### Agent frameworks (extended)

| Framework | Pattern | Notes |
|---|---|---|
| LlamaIndex | A | Engine middleware |
| CrewAI | A | Agent decorator |
| AutoGen (Microsoft) | A | Conversable agent middleware |
| Semantic Kernel | A | Function filter |
| Mastra | A | Workflow step middleware |
| Pydantic AI | A | Agent.tool middleware |
| Inngest Agent Kit | A+C | Step middleware (Inngest is also C-pattern host) |
| Claude Code SDK / OpenAI Agents SDK / Google ADK | A | First-party agent SDKs |

### Workflow orchestration (engineering)

| Tool | Pattern | Notes |
|---|---|---|
| Temporal | C | Activity middleware |
| Inngest | C | Function middleware |
| Trigger.dev | C | Task middleware |
| Hatchet | C | Step middleware |
| Restate | C | Service middleware |
| Vercel Workflow | C | Step middleware |
| Apache Airflow / Prefect / Dagster | C | Task/Operator wrappers |

### No-code / low-code (extended)

| Tool | Pattern | Notes |
|---|---|---|
| Make (Integromat) | B | Custom module |
| Pipedream | B | Component |
| Bardeen | B | App |
| Tray.io / Workato | B | Connector |
| Microsoft Power Automate | B+C | Connector + Azure-side |

---

## Tier-C: Q4-2026+ surfaces (ship before $500K MRR)

Long-tail. Add only when a Tier-A or Tier-B customer pulls them.

### Cloud platforms (extended)

| Cloud | Surfaces | Pattern |
|---|---|---|
| GCP | Cloud Functions, Vertex AI, Cloud KMS, Cloud Logging, Workflows | C + D |
| Cloudflare | Workers, Workers AI, KV, R2, Access | C |
| Vercel | Functions, AI Gateway, Workflow | C |
| Supabase | Edge Functions, Auth (principal binding), DB | C |
| Fly.io | Machines, Functions | C |

### MCP server ecosystem (for AEGIS-verified MCP)

| Server | Pattern | Notes |
|---|---|---|
| Filesystem MCP | A (via bridge) | Already covered by `@aegis/mcp-bridge` |
| GitHub MCP | A | Same |
| Slack MCP | A | Same |
| Postgres / SQLite / Notion / Linear / Asana / Brave Search / Puppeteer / Memory MCPs | A | All covered generically by bridge |
| **AEGIS-verified MCP registry** | Meta | Curated list with AEGIS-verification metadata |

The MCP bridge package (`packages/mcp-bridge`) already provides per-tool verification (just hardened to `actionPrefix + toolName` per peer 2b178d04's review-findings work). No new code needed per MCP server — but **a curated registry** (Tier-B) lets customers discover which MCP servers are AEGIS-verified out of the box.

### Identity providers (for principal binding — L1 identity layer)

| IdP | Pattern | Notes |
|---|---|---|
| Auth0 | A | Already in code per ADR-0009; operator-decision #5 blocks live wiring |
| Clerk | A | Adapter landed Round 7 |
| WorkOS / Microsoft Entra ID / Okta | A | Future enterprise SSO |
| Google Workspace / AWS IAM Identity Center / Cognito | A | Cloud-native principal sources |
| Supabase Auth | A | Already-wired in ComplyKit; cross-product story |

### Observability / SIEM (audit sinks — L4 audit layer, Pattern D)

| Sink | Pattern | Notes |
|---|---|---|
| Datadog | D | NDJSON export → Datadog Logs |
| Splunk | D | HEC endpoint |
| Sumo Logic | D | HTTP source |
| Elastic Security | D | Beats/Logstash |
| New Relic / Honeycomb / Grafana Loki | D | OTel-friendly |
| Sentry | D | Already wired; audit-event SDK |
| AWS CloudWatch / GuardDuty | D | Native AWS integration |
| Azure Sentinel / Monitor | D | KQL queries on AEGIS event shape |
| GCP Chronicle / Security Command Center | D | UDM event mapping |

### Compliance / GRC

| Tool | Pattern | Notes |
|---|---|---|
| Drata | Custom | Evidence collection from AEGIS audit chain |
| Vanta | Custom | Same |
| Thoropass / SecureFrame / AuditBoard | Custom | Same |

---

## How parallel peers claim integration work

The `packages/integrations/<slug>/` stubs are **not workspace packages yet** — they're scaffolded directories ready for promotion. When a peer claims one:

1. Run `claude-peers claim aegis:int-<slug>`
2. Read `packages/integrations/<slug>/README.md` for the integration contract
3. Move from `packages/integrations/<slug>/` to a workspace package directory:
   - Either rename to `packages/aegis-<slug>/` (flat workspace) — RECOMMENDED for npm naming
   - Or update `pnpm-workspace.yaml` to add `packages/integrations/*` glob and keep nested
4. Fill in `src/index.ts` per the integration's pattern (A / B / C / D)
5. Add paired tests under `tests/integrations/<slug>/` or co-located
6. Update this roadmap's status table from `Stub` → `Beta` → `Available`
7. Add a SESSION_HANDOFF entry
8. Release the claim

Per `feedback_shared_tree_git_coordination`: use explicit-path staging (`git add packages/aegis-<slug>/`), not `git add -A`. Run `~/.claude/peers/bin/claude-peers status` before staging to verify no conflicts.

---

## Phase ladder — when each tier lands

| Phase | MRR gate | What lands | Why |
|---|---|---|---|
| Phase 1 | $0 → $5K | Marketing + Stripe + Tier-A scaffolds | Distribution + revenue loop |
| Phase 2 | $5K → $50K | Tier-A full implementations + Tier-B scaffolds | Reach into the agent ecosystem |
| Phase 3 | $50K → $500K | Tier-B full + Tier-C cloud + SIEM | Enterprise procurement readiness |
| Phase 4 | $500K+ | MCP-verified registry + compliance integrations + on-prem | Regulated industry expansion |

This ladder is intentionally coupled to MRR not calendar. The Testament's Book II (Exodus, staged climb) makes this explicit: capability comes online when revenue justifies the maintenance cost, not before. Building Tier-B before Tier-A is generating revenue is the exact "infrastructure-over-built-for-distribution" trap that LAUNCH_RUNBOOK.md is correcting for.

---

## Anti-goals — what AEGIS will **not** integrate with

To prevent scope creep, the following are explicitly out of scope:

- **LLM hosting / inference** — AEGIS is not a model gateway. Use AI Gateway, OpenRouter, or LiteLLM.
- **Agent orchestration** — AEGIS is not a framework. We attach to frameworks; we don't replace them.
- **Prompt management** — AEGIS verifies identity and action, not prompts.
- **Output filtering** — AEGIS verifies *before* the action; content moderation is downstream.
- **Vector databases** — knowledge stores are not in the verification path.

These exclusions matter for procurement: a customer needs to know what AEGIS *is* and *is not*. The neutral-positioning claim (Testament Book I) collapses if the surface keeps expanding.

---

## Reference docs

- `docs/THE_AEGIS_TESTAMENT.md` — vision and doctrinal frame (peer 115e12ee bundling)
- `docs/LAUNCH_RUNBOOK.md` — ship-to-revenue sequence
- `docs/decisions/0008-mcp-as-control-plane.md` — why MCP is first-class
- `packages/mcp-bridge/README.md` — generic MCP verification middleware (Pattern A)
- `packages/mcp-server/README.md` — AEGIS MCP server (exposes verify/attest/audit-query as MCP tools)
- `OPERATOR_DECISIONS.md` — open ODs gating specific integrations (e.g. OD-015 default IdP)
