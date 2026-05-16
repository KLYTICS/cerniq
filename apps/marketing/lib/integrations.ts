// Integration registry — drives both the provider marquee on the landing
// page and the full grid on /integrations. Mirrors docs/INTEGRATION_ROADMAP.md.
// When a peer promotes a stub to a real package, flip `status` here.

export type Category =
  | 'llm-providers'
  | 'agent-frameworks'
  | 'workflow-tools'
  | 'workflow-orchestration'
  | 'cloud'
  | 'observability'
  | 'identity'
  | 'mcp-servers'
  | 'compliance';

export type Tier = 'A' | 'B' | 'C';
export type Pattern = 'A' | 'B' | 'C' | 'D';
export type Status = 'available' | 'beta' | 'coming-soon' | 'planned';

export interface Integration {
  /** Display name. */
  name: string;
  /** URL-safe slug, matches packages/integrations/<slug>/ if scaffolded. */
  slug: string;
  category: Category;
  tier: Tier;
  pattern: Pattern;
  status: Status;
  /** 1-line value prop, ≤80 chars. */
  blurb: string;
  /** When set, links to the relevant /docs path on the dashboard or external site. */
  docsHref?: string;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  'llm-providers': 'LLM Providers',
  'agent-frameworks': 'Agent Frameworks',
  'workflow-tools': 'No-Code Workflows',
  'workflow-orchestration': 'Workflow Engines',
  cloud: 'Cloud Platforms',
  observability: 'Observability & SIEM',
  identity: 'Identity Providers',
  'mcp-servers': 'MCP Servers',
  compliance: 'Compliance & GRC',
};

export const CATEGORY_DESC: Record<Category, string> = {
  'llm-providers': 'Verify agent identity at every tool call, across every model.',
  'agent-frameworks': 'Drop-in middleware that wraps your agent framework of choice.',
  'workflow-tools': 'Native nodes that gate workflow steps on AEGIS verification.',
  'workflow-orchestration': 'Verify activities, steps, and tasks before they execute.',
  cloud: 'Cloud-shaped adapters: Lambda, Functions, Bedrock, Vertex AI, and more.',
  observability: 'Stream signed audit events into your SIEM of choice.',
  identity: 'Bind AEGIS agent principals to your existing identity provider.',
  'mcp-servers': 'Every MCP server, AEGIS-verified per tool — not per-method.',
  compliance: 'Auto-collect AEGIS audit evidence into your GRC platform.',
};

// ── LLM providers ────────────────────────────────────────────────────
const LLM_PROVIDERS: Integration[] = [
  { name: 'OpenAI',     slug: 'openai',     category: 'llm-providers', tier: 'A', pattern: 'A', status: 'beta',
    blurb: 'Assistants API + Responses API + Agents SDK tool-call middleware.' },
  { name: 'Anthropic',  slug: 'anthropic',  category: 'llm-providers', tier: 'A', pattern: 'A', status: 'beta',
    blurb: 'Claude Agent SDK + Messages API tool-use middleware.' },
  { name: 'Google',     slug: 'google',     category: 'llm-providers', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Gemini Function Calling + Vertex AI Agents.' },
  { name: 'AWS Bedrock', slug: 'aws-bedrock', category: 'llm-providers', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Bedrock Agents + multi-model action verification.' },
  { name: 'Azure OpenAI', slug: 'azure-openai', category: 'llm-providers', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Azure OpenAI Service tool-call wrapper with Entra ID principal binding.' },
  { name: 'Mistral',    slug: 'mistral',    category: 'llm-providers', tier: 'B', pattern: 'A', status: 'planned',
    blurb: 'Function-calling middleware.' },
  { name: 'Cohere',     slug: 'cohere',     category: 'llm-providers', tier: 'B', pattern: 'A', status: 'planned',
    blurb: 'Tool-use middleware.' },
  { name: 'xAI Grok',   slug: 'xai',        category: 'llm-providers', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Function-calling middleware (OpenAI-shaped).' },
  { name: 'Replicate',  slug: 'replicate',  category: 'llm-providers', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Open-weights tool-call middleware.' },
  { name: 'Together AI', slug: 'together',  category: 'llm-providers', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Hosted open-weights middleware.' },
  { name: 'Groq',       slug: 'groq',       category: 'llm-providers', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Fast-inference function-calling.' },
  { name: 'Perplexity', slug: 'perplexity', category: 'llm-providers', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Search-grounded agent verification.' },
  { name: 'DeepSeek',   slug: 'deepseek',   category: 'llm-providers', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Function-calling middleware.' },
];

// ── Agent frameworks ─────────────────────────────────────────────────
const AGENT_FRAMEWORKS: Integration[] = [
  { name: 'Vercel AI SDK',     slug: 'vercel-ai-sdk',     category: 'agent-frameworks', tier: 'A', pattern: 'A', status: 'beta',
    blurb: 'streamText + generateText tool middleware. Edge-runtime safe.' },
  { name: 'LangChain',         slug: 'langchain',         category: 'agent-frameworks', tier: 'A', pattern: 'A', status: 'beta',
    blurb: 'LangChain + LangGraph tool wrapping for JS and Python.' },
  { name: 'Claude Agent SDK',  slug: 'claude-agent-sdk',  category: 'agent-frameworks', tier: 'A', pattern: 'A', status: 'beta',
    blurb: 'Anthropic agent loop tool-call middleware.' },
  { name: 'OpenAI Agents SDK', slug: 'openai-agents-sdk', category: 'agent-frameworks', tier: 'A', pattern: 'A', status: 'beta',
    blurb: 'OpenAI Agents framework tool middleware.' },
  { name: 'LlamaIndex',        slug: 'llamaindex',        category: 'agent-frameworks', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Query engine + agent runner middleware.' },
  { name: 'CrewAI',            slug: 'crewai',            category: 'agent-frameworks', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Multi-agent crew action verification.' },
  { name: 'AutoGen',           slug: 'autogen',           category: 'agent-frameworks', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Conversable agent middleware (Microsoft).' },
  { name: 'Semantic Kernel',   slug: 'semantic-kernel',   category: 'agent-frameworks', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Function filter integration (Microsoft).' },
  { name: 'Mastra',            slug: 'mastra',            category: 'agent-frameworks', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Workflow step middleware.' },
  { name: 'Pydantic AI',       slug: 'pydantic-ai',       category: 'agent-frameworks', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Typed agent.tool middleware.' },
  { name: 'Google ADK',        slug: 'google-adk',        category: 'agent-frameworks', tier: 'B', pattern: 'A', status: 'planned',
    blurb: 'Agent Development Kit middleware.' },
  { name: 'Haystack',          slug: 'haystack',          category: 'agent-frameworks', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Pipeline component middleware.' },
];

// ── No-code / low-code workflow tools ────────────────────────────────
const WORKFLOW_TOOLS: Integration[] = [
  { name: 'n8n',          slug: 'n8n',          category: 'workflow-tools', tier: 'A', pattern: 'B', status: 'beta',
    blurb: 'Custom node — gate any workflow step on AEGIS verification.' },
  { name: 'Zapier',       slug: 'zapier',       category: 'workflow-tools', tier: 'A', pattern: 'B', status: 'beta',
    blurb: 'Zapier CLI app — verify before any Zap action.' },
  { name: 'Make',         slug: 'make',         category: 'workflow-tools', tier: 'B', pattern: 'B', status: 'coming-soon',
    blurb: 'Custom module for Make scenarios.' },
  { name: 'Pipedream',    slug: 'pipedream',    category: 'workflow-tools', tier: 'B', pattern: 'B', status: 'coming-soon',
    blurb: 'Component for Pipedream workflows.' },
  { name: 'Power Automate', slug: 'power-automate', category: 'workflow-tools', tier: 'B', pattern: 'B', status: 'coming-soon',
    blurb: 'Microsoft Power Automate connector.' },
  { name: 'Bardeen',      slug: 'bardeen',      category: 'workflow-tools', tier: 'C', pattern: 'B', status: 'planned',
    blurb: 'Browser automation step verification.' },
  { name: 'Tray.io',      slug: 'tray',         category: 'workflow-tools', tier: 'C', pattern: 'B', status: 'planned',
    blurb: 'Enterprise iPaaS connector.' },
  { name: 'Workato',      slug: 'workato',      category: 'workflow-tools', tier: 'C', pattern: 'B', status: 'planned',
    blurb: 'Enterprise iPaaS connector.' },
];

// ── Workflow orchestration engines ───────────────────────────────────
const WORKFLOW_ORCHESTRATION: Integration[] = [
  { name: 'Temporal',          slug: 'temporal',          category: 'workflow-orchestration', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'Activity middleware — verify before activity execution.' },
  { name: 'Inngest',           slug: 'inngest',           category: 'workflow-orchestration', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'Function middleware + Agent Kit verification.' },
  { name: 'Trigger.dev',       slug: 'trigger-dev',       category: 'workflow-orchestration', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'Task middleware.' },
  { name: 'Vercel Workflow',   slug: 'vercel-workflow',   category: 'workflow-orchestration', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'WDK step middleware — durable agent flows.' },
  { name: 'Hatchet',           slug: 'hatchet',           category: 'workflow-orchestration', tier: 'C', pattern: 'C', status: 'planned',
    blurb: 'Step middleware for distributed workflows.' },
  { name: 'Restate',           slug: 'restate',           category: 'workflow-orchestration', tier: 'C', pattern: 'C', status: 'planned',
    blurb: 'Service middleware.' },
  { name: 'Apache Airflow',    slug: 'airflow',           category: 'workflow-orchestration', tier: 'C', pattern: 'C', status: 'planned',
    blurb: 'Operator wrapper.' },
  { name: 'Prefect',           slug: 'prefect',           category: 'workflow-orchestration', tier: 'C', pattern: 'C', status: 'planned',
    blurb: 'Task wrapper.' },
  { name: 'Dagster',           slug: 'dagster',           category: 'workflow-orchestration', tier: 'C', pattern: 'C', status: 'planned',
    blurb: 'Op + Asset wrappers.' },
];

// ── Cloud platforms ──────────────────────────────────────────────────
const CLOUD: Integration[] = [
  { name: 'AWS',           slug: 'aws',           category: 'cloud', tier: 'A', pattern: 'C', status: 'beta',
    blurb: 'Lambda extension + EventBridge sink + Bedrock Agents middleware.' },
  { name: 'Azure',         slug: 'azure',         category: 'cloud', tier: 'A', pattern: 'C', status: 'beta',
    blurb: 'Functions binding + Logic Apps connector + OpenAI Service wrapper.' },
  { name: 'Google Cloud',  slug: 'gcp',           category: 'cloud', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'Cloud Functions + Vertex AI + Cloud KMS adapters.' },
  { name: 'Cloudflare',    slug: 'cloudflare',    category: 'cloud', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'Workers middleware + Workers AI + Access integration.' },
  { name: 'Vercel',        slug: 'vercel',        category: 'cloud', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'Edge Functions + AI Gateway + Workflow middleware.' },
  { name: 'Supabase',      slug: 'supabase',      category: 'cloud', tier: 'B', pattern: 'C', status: 'coming-soon',
    blurb: 'Edge Functions + Auth-bound principal + DB row-level guard.' },
  { name: 'Fly.io',        slug: 'flyio',         category: 'cloud', tier: 'C', pattern: 'C', status: 'planned',
    blurb: 'Machines + Functions middleware.' },
];

// ── Observability / SIEM ─────────────────────────────────────────────
const OBSERVABILITY: Integration[] = [
  { name: 'Datadog',           slug: 'datadog',           category: 'observability', tier: 'B', pattern: 'D', status: 'coming-soon',
    blurb: 'Stream signed audit events into Datadog Logs.' },
  { name: 'Splunk',            slug: 'splunk',            category: 'observability', tier: 'B', pattern: 'D', status: 'coming-soon',
    blurb: 'HEC endpoint exporter.' },
  { name: 'Sentry',            slug: 'sentry',            category: 'observability', tier: 'B', pattern: 'D', status: 'beta',
    blurb: 'Audit-event SDK already wired; security context.' },
  { name: 'Elastic Security',  slug: 'elastic',           category: 'observability', tier: 'B', pattern: 'D', status: 'coming-soon',
    blurb: 'Beats / Logstash forwarder.' },
  { name: 'AWS CloudWatch',    slug: 'cloudwatch',        category: 'observability', tier: 'B', pattern: 'D', status: 'coming-soon',
    blurb: 'Native AWS log group sink.' },
  { name: 'Azure Sentinel',    slug: 'azure-sentinel',    category: 'observability', tier: 'B', pattern: 'D', status: 'coming-soon',
    blurb: 'KQL-queryable AEGIS event mapping.' },
  { name: 'Sumo Logic',        slug: 'sumo-logic',        category: 'observability', tier: 'C', pattern: 'D', status: 'planned',
    blurb: 'HTTP source forwarder.' },
  { name: 'New Relic',         slug: 'new-relic',         category: 'observability', tier: 'C', pattern: 'D', status: 'planned',
    blurb: 'Logs / events sink.' },
  { name: 'Honeycomb',         slug: 'honeycomb',         category: 'observability', tier: 'C', pattern: 'D', status: 'planned',
    blurb: 'High-cardinality event exporter.' },
  { name: 'Grafana Loki',      slug: 'grafana-loki',      category: 'observability', tier: 'C', pattern: 'D', status: 'planned',
    blurb: 'OTel-friendly forwarder.' },
];

// ── Identity providers ───────────────────────────────────────────────
const IDENTITY: Integration[] = [
  { name: 'Auth0',                 slug: 'auth0',                 category: 'identity', tier: 'A', pattern: 'A', status: 'beta',
    blurb: 'Default dashboard IdP per ADR-0009. SSO + MFA + principal binding.' },
  { name: 'Clerk',                 slug: 'clerk',                 category: 'identity', tier: 'B', pattern: 'A', status: 'beta',
    blurb: 'Swap adapter — drop-in for Auth0.' },
  { name: 'WorkOS',                slug: 'workos',                category: 'identity', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'Enterprise SSO + SCIM provisioning.' },
  { name: 'Microsoft Entra ID',    slug: 'entra',                 category: 'identity', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'AAD principal binding for Azure-native deployments.' },
  { name: 'Okta',                  slug: 'okta',                  category: 'identity', tier: 'B', pattern: 'A', status: 'coming-soon',
    blurb: 'SAML / OIDC bridge.' },
  { name: 'Google Workspace',      slug: 'google-workspace',      category: 'identity', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Workspace SSO + admin SDK.' },
  { name: 'AWS IAM Identity Center', slug: 'aws-iam-identity',    category: 'identity', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'IAM Identity Center principal binding.' },
  { name: 'Supabase Auth',         slug: 'supabase-auth',         category: 'identity', tier: 'C', pattern: 'A', status: 'planned',
    blurb: 'Supabase user → AEGIS principal.' },
];

// ── MCP servers (covered by mcp-bridge generically; this is for marketing) ─────
const MCP_SERVERS: Integration[] = [
  { name: 'Filesystem MCP',  slug: 'mcp-filesystem',  category: 'mcp-servers', tier: 'B', pattern: 'A', status: 'available',
    blurb: 'Per-tool verification via @aegis/mcp-bridge.' },
  { name: 'GitHub MCP',      slug: 'mcp-github',      category: 'mcp-servers', tier: 'B', pattern: 'A', status: 'available',
    blurb: 'Tool-scoped verification (mcp.gh.create_issue, mcp.gh.merge_pr).' },
  { name: 'Slack MCP',       slug: 'mcp-slack',       category: 'mcp-servers', tier: 'B', pattern: 'A', status: 'available',
    blurb: 'Tool-scoped verification.' },
  { name: 'Postgres MCP',    slug: 'mcp-postgres',    category: 'mcp-servers', tier: 'B', pattern: 'A', status: 'available',
    blurb: 'Tool-scoped verification.' },
  { name: 'Notion MCP',      slug: 'mcp-notion',      category: 'mcp-servers', tier: 'C', pattern: 'A', status: 'available',
    blurb: 'Tool-scoped verification.' },
  { name: 'Linear MCP',      slug: 'mcp-linear',      category: 'mcp-servers', tier: 'C', pattern: 'A', status: 'available',
    blurb: 'Tool-scoped verification.' },
  { name: 'Brave Search MCP', slug: 'mcp-brave',      category: 'mcp-servers', tier: 'C', pattern: 'A', status: 'available',
    blurb: 'Tool-scoped verification.' },
  { name: 'Puppeteer MCP',   slug: 'mcp-puppeteer',   category: 'mcp-servers', tier: 'C', pattern: 'A', status: 'available',
    blurb: 'Browser-automation tool-scoped verification.' },
];

// ── Compliance / GRC ─────────────────────────────────────────────────
const COMPLIANCE: Integration[] = [
  { name: 'Drata',         slug: 'drata',         category: 'compliance', tier: 'B', pattern: 'D', status: 'coming-soon',
    blurb: 'Audit-chain evidence auto-collection.' },
  { name: 'Vanta',         slug: 'vanta',         category: 'compliance', tier: 'B', pattern: 'D', status: 'coming-soon',
    blurb: 'Audit-chain evidence auto-collection.' },
  { name: 'Thoropass',     slug: 'thoropass',     category: 'compliance', tier: 'C', pattern: 'D', status: 'planned',
    blurb: 'GRC evidence sink.' },
  { name: 'SecureFrame',   slug: 'secureframe',   category: 'compliance', tier: 'C', pattern: 'D', status: 'planned',
    blurb: 'GRC evidence sink.' },
  { name: 'AuditBoard',    slug: 'auditboard',    category: 'compliance', tier: 'C', pattern: 'D', status: 'planned',
    blurb: 'Enterprise GRC integration.' },
];

export const ALL_INTEGRATIONS: Integration[] = [
  ...LLM_PROVIDERS,
  ...AGENT_FRAMEWORKS,
  ...WORKFLOW_TOOLS,
  ...WORKFLOW_ORCHESTRATION,
  ...CLOUD,
  ...OBSERVABILITY,
  ...IDENTITY,
  ...MCP_SERVERS,
  ...COMPLIANCE,
];

export const BY_CATEGORY: Record<Category, Integration[]> = {
  'llm-providers':          LLM_PROVIDERS,
  'agent-frameworks':       AGENT_FRAMEWORKS,
  'workflow-tools':         WORKFLOW_TOOLS,
  'workflow-orchestration': WORKFLOW_ORCHESTRATION,
  cloud:                    CLOUD,
  observability:            OBSERVABILITY,
  identity:                 IDENTITY,
  'mcp-servers':            MCP_SERVERS,
  compliance:               COMPLIANCE,
};

/** A curated subset for the marketing-hero marquee — broad ecosystem signal in ~24 names. */
export const MARQUEE_FEATURED: Integration[] = [
  ALL_INTEGRATIONS.find((i) => i.slug === 'openai')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'anthropic')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'google')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'aws-bedrock')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'azure-openai')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'vercel-ai-sdk')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'langchain')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'claude-agent-sdk')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'openai-agents-sdk')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'llamaindex')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'crewai')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'autogen')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'mastra')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'n8n')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'zapier')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'make')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'temporal')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'inngest')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'aws')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'azure')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'gcp')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'cloudflare')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'vercel')!,
  ALL_INTEGRATIONS.find((i) => i.slug === 'supabase')!,
];

export const STATUS_LABEL: Record<Status, string> = {
  available:    'Available',
  beta:         'Beta',
  'coming-soon': 'Coming soon',
  planned:      'Planned',
};

export const TIER_LABEL: Record<Tier, string> = {
  A: 'Phase 1',
  B: 'Phase 2',
  C: 'Phase 3',
};
